import { PublicKey } from "@solana/web3.js";
import sharedIdlJson from "shared/idl/rents_ticketing.json" with { type: "json" };
import { connection, program, programId } from "../config/solana.js";
import { Ticket } from "../models/Ticket.model.js";

const TOKEN_ACCOUNT_SIZE = 165;
const TICKET_SEED = Buffer.from("ticket");
const EVENT_SEED = Buffer.from("event");

type RuntimeIdl = {
  instructions: Array<{ name: string; accounts: Array<{ name: string; address?: string }> }>;
};

function idlAccountAddress(instructionName: string, accountName: string): PublicKey {
  const idl = sharedIdlJson as unknown as RuntimeIdl;
  const address = idl.instructions.find(({ name }) => name === instructionName)?.accounts
    .find(({ name }) => name === accountName)?.address;
  if (!address) throw new Error(`Shared IDL is missing ${instructionName}.${accountName} address`);
  return new PublicKey(address);
}

const tokenProgramId = idlAccountAddress("check_in_ticket", "token_program");

export class CheckInVerificationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

class RpcReadFailure extends Error {
  constructor(message: string, readonly originalError: unknown) {
    super(message);
  }
}

export interface CheckInVerificationInput {
  mint: string;
  owner: string;
  eventPda: string;
}

function parsePublicKey(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new CheckInVerificationError(`${field} must be a valid Solana public key`, 400);
  }
}

function deriveTicketPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([TICKET_SEED, mint.toBuffer()], programId)[0];
}

function deriveEventPda(organizer: PublicKey, eventId: { toArrayLike: (type: typeof Buffer, endian: "le", length: number) => Buffer }): PublicKey {
  return PublicKey.findProgramAddressSync(
    [EVENT_SEED, organizer.toBuffer(), eventId.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

async function readRpc<T>(label: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    throw new RpcReadFailure(`Solana ${label} read failed`, cause);
  }
}

async function getLiveOwner(mint: PublicKey): Promise<PublicKey | null> {
  const tokenAccounts = await readRpc("token account list", () =>
    connection.getTokenLargestAccounts(mint, "confirmed")
  );
  for (const tokenAccount of tokenAccounts.value) {
    if (tokenAccount.amount !== "1") continue;
    const account = await readRpc("token account", () =>
      connection.getAccountInfo(tokenAccount.address, "confirmed")
    );
    if (
      !account ||
      !account.owner.equals(tokenProgramId) ||
      account.data.length !== TOKEN_ACCOUNT_SIZE ||
      !new PublicKey(account.data.subarray(0, 32)).equals(mint) ||
      account.data.readBigUInt64LE(64) !== 1n
    ) continue;
    return new PublicKey(account.data.subarray(32, 64));
  }
  return null;
}

function rejection(status: number, reason: string): never {
  throw new CheckInVerificationError(reason, status);
}

async function verifyFromChain(mint: PublicKey, owner: PublicKey, expectedEvent: PublicKey) {
  const ticketPda = deriveTicketPda(mint);
  const ticket = await readRpc("Ticket account", () => program.account.ticket.fetchNullable(ticketPda));
  if (!ticket) rejection(404, "Ticket not found");
  if (!ticket.mint.equals(mint)) rejection(409, "Ticket mint does not match");

  const event = await readRpc("Event account", () => program.account.event.fetchNullable(ticket.event));
  if (!event) rejection(404, "Ticket Event not found");
  if (!deriveEventPda(event.organizer, event.eventId).equals(ticket.event)) {
    rejection(409, "Ticket Event is not canonical");
  }
  if (!ticket.event.equals(expectedEvent)) rejection(409, "Ticket does not belong to the expected Event");
  if (ticket.isUsed) rejection(409, "Already checked in");

  const liveOwner = await getLiveOwner(mint);
  if (!liveOwner) rejection(404, "Ticket token account not found");
  if (!liveOwner.equals(owner)) rejection(403, "QR owner does not match the current ticket holder");

  return {
    valid: true as const,
    ticket: {
      mintAddress: mint.toBase58(),
      ticketPda: ticketPda.toBase58(),
      eventPda: ticket.event.toBase58(),
      ownerPubkey: liveOwner.toBase58(),
      faceValueLamports: ticket.faceValue.toString(),
      isCheckedIn: ticket.isUsed,
      resaleCount: ticket.resaleCount,
    },
  };
}

async function verifyFromCache(mint: PublicKey, owner: PublicKey, expectedEvent: PublicKey) {
  const ticket = await Ticket.findOne({ mintAddress: mint.toBase58() });
  if (!ticket) rejection(404, "Ticket not found");
  if (ticket.eventPda !== expectedEvent.toBase58()) rejection(409, "Ticket does not belong to the expected Event");
  if (ticket.isCheckedIn) rejection(409, "Already checked in");
  if (ticket.ownerPubkey !== owner.toBase58()) rejection(403, "QR owner does not match the current ticket holder");
  return { valid: true as const, ticket };
}

export async function verifyCheckIn(input: CheckInVerificationInput) {
  const mint = parsePublicKey(input.mint, "mint");
  const owner = parsePublicKey(input.owner, "owner");
  const expectedEvent = parsePublicKey(input.eventPda, "eventPda");
  try {
    return await verifyFromChain(mint, owner, expectedEvent);
  } catch (error) {
    if (!(error instanceof RpcReadFailure)) throw error;
    console.warn("[checkin] Solana read failed; falling back to ticket cache:", error.message);
    return verifyFromCache(mint, owner, expectedEvent);
  }
}
