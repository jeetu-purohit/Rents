import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import sharedIdlJson from "shared/idl/rents_ticketing.json" with { type: "json" };
import { connection, program, programId } from "../config/solana.js";

const U64_MAX = new BN("18446744073709551615", 10);
const U32_MAX = 0xffff_ffff;
const U16_MAX = 0xffff;

type RuntimeIdlAccount = { name: string; address?: string };
type RuntimeIdl = {
  instructions: Array<{ name: string; accounts: RuntimeIdlAccount[] }>;
};

const mintInstructionIdl = (sharedIdlJson as unknown as RuntimeIdl).instructions.find(
  (instruction) => instruction.name === "mint_ticket"
);

function idlProgramAddress(name: string): PublicKey {
  const address = mintInstructionIdl?.accounts.find((account) => account.name === name)?.address;
  if (!address) throw new Error(`The shared mint_ticket IDL is missing ${name}`);
  return new PublicKey(address);
}

const tokenProgramId = idlProgramAddress("token_program");
const associatedTokenProgramId = idlProgramAddress("associated_token_program");
const tokenMetadataProgramId = idlProgramAddress("token_metadata_program");

export class TransactionInputError extends Error {
  readonly status = 400;
}

export interface InitializeEventTransactionInput {
  organizerPubkey: string;
  eventId: string;
  maxTickets: number;
  basePriceLamports: string;
  resaleCapBps: number;
  royaltyBps: number;
}

export interface MintTicketTransactionInput {
  buyerPubkey: string;
  eventPda: string;
  mintPubkey: string;
  eventName: string;
  uri: string;
}

export interface HolderTransactionInput {
  holderPubkey: string;
  mintPubkey: string;
}

export interface ListTicketTransactionInput extends HolderTransactionInput {
  priceLamports: string;
}

export interface ResellTicketTransactionInput {
  buyerPubkey: string;
  sellerPubkey: string;
  mintPubkey: string;
}

export interface CheckInTicketTransactionInput {
  organizerPubkey: string;
  holderPubkey: string;
  mintPubkey: string;
}

export interface UnsignedTransactionResult {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
}

function publicKey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new TransactionInputError(`${field} must be a valid Solana public key`);
  }
}

function u64(value: string, field: string): BN {
  if (!/^\d+$/.test(value)) throw new TransactionInputError(`${field} must be a decimal integer string`);
  const parsed = new BN(value, 10);
  if (parsed.gt(U64_MAX)) throw new TransactionInputError(`${field} exceeds the u64 range`);
  return parsed;
}

function boundedInteger(value: number, field: string, maximum: number, minimum = 0): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TransactionInputError(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requiredText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TransactionInputError(`${field} is required`);
  return trimmed;
}

async function serializeUnsignedTransaction(
  instruction: TransactionInstruction,
  feePayer: PublicKey
): Promise<UnsignedTransactionResult> {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer,
    recentBlockhash: latestBlockhash.blockhash,
  }).add(instruction);

  return {
    transaction: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString("base64"),
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  };
}

export interface InitializeEventTransactionResult extends UnsignedTransactionResult {
  eventPda: string;
}

export async function buildInitializeEventTransaction(
  input: InitializeEventTransactionInput
): Promise<InitializeEventTransactionResult> {
  const organizer = publicKey(input.organizerPubkey, "organizerPubkey");
  const eventId = u64(input.eventId, "eventId");
  const maxTickets = boundedInteger(input.maxTickets, "maxTickets", U32_MAX, 1);
  const basePrice = u64(input.basePriceLamports, "basePriceLamports");
  const resaleCapBps = boundedInteger(input.resaleCapBps, "resaleCapBps", U16_MAX, 10_000);
  const royaltyBps = boundedInteger(input.royaltyBps, "royaltyBps", 2_000);

  const [eventPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("event"), organizer.toBuffer(), eventId.toArrayLike(Buffer, "le", 8)],
    programId
  );

  const instruction = await program.methods
    .initializeEvent(eventId, maxTickets, basePrice, resaleCapBps, royaltyBps)
    .accountsStrict({
      organizer,
      event: eventPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return {
    ...(await serializeUnsignedTransaction(instruction, organizer)),
    eventPda: eventPda.toBase58(),
  };
}

export interface MintTicketTransactionResult extends UnsignedTransactionResult {
  ticketPda: string;
}

export async function buildMintTicketTransaction(
  input: MintTicketTransactionInput
): Promise<MintTicketTransactionResult> {
  const buyer = publicKey(input.buyerPubkey, "buyerPubkey");
  const eventPda = publicKey(input.eventPda, "eventPda");
  const mint = publicKey(input.mintPubkey, "mintPubkey");
  const eventName = requiredText(input.eventName, "eventName");
  const uri = requiredText(input.uri, "uri");

  const eventAccount = await program.account.event.fetch(eventPda);
  const [canonicalEventPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("event"),
      eventAccount.organizer.toBuffer(),
      eventAccount.eventId.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  if (!canonicalEventPda.equals(eventPda)) {
    throw new TransactionInputError("eventPda is not the canonical Event PDA");
  }
  const metadataName = `${eventName} #${eventAccount.ticketsSold + 1}`;
  if (Buffer.byteLength(metadataName, "utf8") > 32) {
    throw new TransactionInputError("eventName is too long for the ticket metadata name");
  }
  if (Buffer.byteLength(uri, "utf8") > 200) {
    throw new TransactionInputError("uri must be 200 bytes or fewer");
  }
  if (await connection.getAccountInfo(mint, "confirmed")) {
    throw new TransactionInputError("mintPubkey must refer to a fresh mint account");
  }

  const [platformConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform_config")],
    programId
  );
  const platformConfig = await program.account.platformConfig.fetch(platformConfigPda);
  const organizer = eventAccount.organizer;
  const platformWallet = platformConfig.platformWallet;

  const [ticketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), mint.toBuffer()],
    programId
  );
  const [ticketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("authority")],
    programId
  );
  const [buyerTokenAccount] = PublicKey.findProgramAddressSync(
    [buyer.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  );
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), tokenMetadataProgramId.toBuffer(), mint.toBuffer()],
    tokenMetadataProgramId
  );

  const instruction = await program.methods
    .mintTicket(eventName, uri)
    .accountsStrict({
      buyer,
      event: eventPda,
      organizer,
      platformConfig: platformConfigPda,
      platformWallet,
      ticketAuthority,
      mint,
      ticket: ticketPda,
      buyerTokenAccount,
      metadata,
      tokenMetadataProgram: tokenMetadataProgramId,
      tokenProgram: tokenProgramId,
      associatedTokenProgram: associatedTokenProgramId,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return {
    ...(await serializeUnsignedTransaction(instruction, buyer)),
    ticketPda: ticketPda.toBase58(),
  };
}

async function loadTicketContext(mint: PublicKey) {
  const [ticketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), mint.toBuffer()],
    programId
  );
  const ticket = await program.account.ticket.fetch(ticketPda);
  if (!ticket.mint.equals(mint)) throw new TransactionInputError("Ticket mint does not match mintPubkey");
  const event = await program.account.event.fetch(ticket.event);
  const [eventPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("event"), event.organizer.toBuffer(), event.eventId.toArrayLike(Buffer, "le", 8)],
    programId
  );
  if (!eventPda.equals(ticket.event)) throw new TransactionInputError("Ticket refers to a noncanonical Event PDA");
  return { ticketPda, ticket, event, eventPda };
}

async function deriveAssociatedTokenAddress(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  );
  return address;
}

export async function buildListTicketTransaction(input: ListTicketTransactionInput) {
  const holder = publicKey(input.holderPubkey, "holderPubkey");
  const mint = publicKey(input.mintPubkey, "mintPubkey");
  const price = u64(input.priceLamports, "priceLamports");
  const { ticketPda, eventPda } = await loadTicketContext(mint);
  const tokenAccount = await deriveAssociatedTokenAddress(holder, mint);
  const instruction = await program.methods.listTicket(price).accountsStrict({
    holder,
    event: eventPda,
    ticket: ticketPda,
    tokenAccount,
  }).instruction();
  return serializeUnsignedTransaction(instruction, holder);
}

export async function buildCancelListingTransaction(input: HolderTransactionInput) {
  const holder = publicKey(input.holderPubkey, "holderPubkey");
  const mint = publicKey(input.mintPubkey, "mintPubkey");
  const { ticketPda } = await loadTicketContext(mint);
  const tokenAccount = await deriveAssociatedTokenAddress(holder, mint);
  const instruction = await program.methods.cancelListing().accountsStrict({
    holder,
    ticket: ticketPda,
    tokenAccount,
  }).instruction();
  return serializeUnsignedTransaction(instruction, holder);
}

export async function buildResellTicketTransaction(input: ResellTicketTransactionInput) {
  const buyer = publicKey(input.buyerPubkey, "buyerPubkey");
  const seller = publicKey(input.sellerPubkey, "sellerPubkey");
  const mint = publicKey(input.mintPubkey, "mintPubkey");
  const { ticketPda, eventPda, event } = await loadTicketContext(mint);
  const [platformConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform_config")],
    programId
  );
  const config = await program.account.platformConfig.fetch(platformConfig);
  const [ticketAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("authority")],
    programId
  );
  const sellerTokenAccount = await deriveAssociatedTokenAddress(seller, mint);
  const buyerTokenAccount = await deriveAssociatedTokenAddress(buyer, mint);
  const instruction = await program.methods.resellTicket().accountsStrict({
    buyer,
    event: eventPda,
    ticket: ticketPda,
    organizer: event.organizer,
    seller,
    platformConfig,
    platformWallet: config.platformWallet,
    ticketAuthority,
    mint,
    sellerTokenAccount,
    buyerTokenAccount,
    tokenProgram: tokenProgramId,
    associatedTokenProgram: associatedTokenProgramId,
    systemProgram: SystemProgram.programId,
  }).instruction();
  return serializeUnsignedTransaction(instruction, buyer);
}

export async function buildCheckInTicketTransaction(input: CheckInTicketTransactionInput) {
  const organizer = publicKey(input.organizerPubkey, "organizerPubkey");
  const holder = publicKey(input.holderPubkey, "holderPubkey");
  const mint = publicKey(input.mintPubkey, "mintPubkey");
  const { ticketPda, eventPda } = await loadTicketContext(mint);
  const tokenAccount = await deriveAssociatedTokenAddress(holder, mint);
  const instruction = await program.methods.checkInTicket().accountsStrict({
    organizer,
    event: eventPda,
    ticket: ticketPda,
    mint,
    holder,
    tokenAccount,
    tokenProgram: tokenProgramId,
  }).instruction();
  return serializeUnsignedTransaction(instruction, organizer);
}
