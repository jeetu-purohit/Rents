import "dotenv/config";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { connection, program, programId } from "../config/solana";

interface UnsignedTransactionResponse {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  eventPda?: string;
  ticketPda?: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function postTransaction(
  path: string,
  body: Record<string, unknown>
): Promise<UnsignedTransactionResponse> {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  assert(typeof payload === "object" && payload !== null, `${path} returned an invalid response`);
  const result = payload as Partial<UnsignedTransactionResponse>;
  assert(typeof result.transaction === "string", `${path} omitted the base64 transaction`);
  assert(typeof result.blockhash === "string", `${path} omitted the blockhash`);
  assert(typeof result.lastValidBlockHeight === "number", `${path} omitted the block height`);
  return result as UnsignedTransactionResponse;
}

function deserializeUnsigned(response: UnsignedTransactionResponse, feePayer: PublicKey): Transaction {
  const transaction = Transaction.from(Buffer.from(response.transaction, "base64"));
  assert(transaction.feePayer?.equals(feePayer), "transaction fee payer did not match the client wallet");
  assert(
    transaction.signatures.every((signature) => signature.signature === null),
    "builder returned a transaction with an existing signature"
  );
  assert(transaction.recentBlockhash === response.blockhash, "response and transaction blockhash differ");
  return transaction;
}

async function fund(publicKey: PublicKey): Promise<void> {
  const signature = await connection.requestAirdrop(publicKey, 2 * 1_000_000_000);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

async function submit(
  transaction: Transaction,
  lastValidBlockHeight: number,
  ...signers: Keypair[]
): Promise<void> {
  transaction.partialSign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize());
  assert(typeof transaction.recentBlockhash === "string", "transaction omitted the blockhash");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: transaction.recentBlockhash,
      lastValidBlockHeight,
    },
    "confirmed"
  );
}

const organizer = Keypair.generate();
const buyer = Keypair.generate();
const platformAdmin = Keypair.generate();
const [platformConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("platform_config")],
  programId
);
const existingPlatformConfig = await program.account.platformConfig.fetchNullable(platformConfigPda);
const platformWallet = existingPlatformConfig?.platformWallet ?? Keypair.generate().publicKey;

await Promise.all([
  fund(organizer.publicKey),
  fund(buyer.publicKey),
  fund(platformAdmin.publicKey),
  ...(existingPlatformConfig ? [] : [fund(platformWallet)]),
]);

// This local-only prerequisite configures the program's fee destination; the
// initialize-event and mint instructions under test are both built by the API.
if (!existingPlatformConfig) {
  const setupConfig = await program.methods
    .initializePlatformConfig(platformWallet, 100)
    .accountsStrict({
      admin: platformAdmin.publicKey,
      platformConfig: platformConfigPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const setupBlockhash = await connection.getLatestBlockhash("confirmed");
  const setupTransaction = new Transaction({
    feePayer: platformAdmin.publicKey,
    recentBlockhash: setupBlockhash.blockhash,
  }).add(setupConfig);
  await submit(setupTransaction, setupBlockhash.lastValidBlockHeight, platformAdmin);
}

const eventId = Date.now().toString();
const initializeResponse = await postTransaction("/api/tx/initialize-event", {
  organizerPubkey: organizer.publicKey.toBase58(),
  eventId,
  maxTickets: 3,
  basePriceLamports: "10000000",
  resaleCapBps: 11_000,
  royaltyBps: 500,
});
assert(typeof initializeResponse.eventPda === "string", "initialize-event omitted eventPda");
const initializeTransaction = deserializeUnsigned(initializeResponse, organizer.publicKey);
await submit(initializeTransaction, initializeResponse.lastValidBlockHeight, organizer);

const eventPda = new PublicKey(initializeResponse.eventPda);
const eventAccount = await program.account.event.fetch(eventPda);
assert(eventAccount.organizer.equals(organizer.publicKey), "Event organizer did not match");
assert(eventAccount.eventId.toString() === eventId, "Event ID did not match");
assert(eventAccount.maxTickets === 3, "Event max ticket count did not match");
assert(eventAccount.basePrice.toString() === "10000000", "Event base price did not match");

const mint = Keypair.generate();
const mintResponse = await postTransaction("/api/tx/mint", {
  buyerPubkey: buyer.publicKey.toBase58(),
  eventPda: eventPda.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
  eventName: "Task 3.4 Builder Smoke",
  uri: "https://example.test/task-3-4-smoke.json",
});
assert(typeof mintResponse.ticketPda === "string", "mint omitted ticketPda");
const mintTransaction = deserializeUnsigned(mintResponse, buyer.publicKey);
await submit(mintTransaction, mintResponse.lastValidBlockHeight, buyer, mint);

const ticketPda = new PublicKey(mintResponse.ticketPda);
const ticket = await program.account.ticket.fetch(ticketPda);
assert(ticket.mint.equals(mint.publicKey), "Ticket mint did not match");
assert(ticket.event.equals(eventPda), "Ticket Event did not match");
assert(ticket.faceValue.toString() === "10000000", "Ticket face value did not match");

const [buyerTokenAccount] = PublicKey.findProgramAddressSync(
  [
    buyer.publicKey.toBuffer(),
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
    mint.publicKey.toBuffer(),
  ],
  new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
);
const mintAccountInfo = await connection.getAccountInfo(mint.publicKey, "confirmed");
const tokenAccountInfo = await connection.getAccountInfo(buyerTokenAccount, "confirmed");
assert(mintAccountInfo !== null && mintAccountInfo.data.readBigUInt64LE(36) === 1n, "mint supply was not 1");
assert(mintAccountInfo.data[44] === 0, "ticket mint decimals were not 0");
assert(tokenAccountInfo !== null, "buyer token account was not created");
assert(tokenAccountInfo.data.subarray(32, 64).equals(buyer.publicKey.toBuffer()), "ticket token owner did not match buyer");
assert(tokenAccountInfo.data.readBigUInt64LE(64) === 1n, "buyer token balance was not 1");

console.log(
  JSON.stringify({
    initializeEvent: "confirmed through API; organizer and event fields verified",
    mint: "confirmed through API; Ticket, supply 1, and buyer ownership verified",
    eventPda: eventPda.toBase58(),
    ticketPda: ticketPda.toBase58(),
    userTransactionsUnsignedBeforeClientSigning: true,
  })
);
