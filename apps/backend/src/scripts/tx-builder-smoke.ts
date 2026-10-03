import "dotenv/config";
import mongoose from "mongoose";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { connection, program, programId } from "../config/solana";
import { Event } from "../models/Event.model";
import { Ticket } from "../models/Ticket.model";

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

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}${path}`);
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function postJson(path: string, body: Record<string, unknown>, port = process.env.PORT ?? "4000"): Promise<{ status: number; payload: unknown }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() as unknown };
}

async function startRpcFailureBackend(): Promise<ReturnType<typeof Bun.spawn>> {
  const child = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      MONGO_URI: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/rents",
      SOLANA_RPC_URL: "http://127.0.0.1:1",
      PROGRAM_ID: programId.toBase58(),
      PORT: "4001",
      INDEXER_ENABLED: "false",
    },
    stdout: "ignore",
    stderr: "ignore",
  });
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`RPC-failure backend exited with ${child.exitCode}`);
    try {
      const response = await fetch("http://127.0.0.1:4001/health");
      if (response.ok) return child;
    } catch {
      // Wait for Express and Mongo to finish startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error("RPC-failure backend did not become healthy");
}

function objectRecord(value: unknown, context: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), `${context} was not an object`);
  return value as Record<string, unknown>;
}

function assertIndexedTicket(value: unknown, expected: {
  mint: string;
  eventPda: string;
  ticketPda: string;
  owner: string;
  faceValue: string;
  usedAt: Date;
}): Record<string, unknown> {
  const ticket = objectRecord(value, "synced ticket");
  assert(ticket.mintAddress === expected.mint, "indexed mintAddress did not match");
  assert(ticket.eventPda === expected.eventPda, "indexed eventPda did not match");
  assert(ticket.ticketPda === expected.ticketPda, "indexed ticketPda did not match");
  assert(ticket.ownerPubkey === expected.owner, "indexed ownerPubkey did not match");
  assert(ticket.faceValueLamports === expected.faceValue, "indexed face value did not match");
  assert(ticket.listingPriceLamports === undefined || ticket.listingPriceLamports === null, "resold listing was not cleared in cache");
  assert(ticket.isCheckedIn === true, "indexed ticket was not marked checked in");
  assert(ticket.resaleCount === 1, "indexed resale count did not match");
  assert(typeof ticket.lastSyncedAt === "string" && Number.isFinite(Date.parse(ticket.lastSyncedAt)), "lastSyncedAt was missing");
  assert(typeof ticket.checkedInAt === "string", "checkedInAt was missing");
  assert(Math.abs(Date.parse(ticket.checkedInAt) - expected.usedAt.getTime()) < 1000, "checkedInAt did not match on-chain used_at");
  return ticket;
}

function assertOnlyListedTickets(payload: unknown, expectedMint: string, shouldContainExpected: boolean): void {
  assert(Array.isArray(payload), "active listings response was not an array");
  const listings = payload.map((value) => objectRecord(value, "active listing"));
  assert(listings.every((ticket) => typeof ticket.listingPriceLamports === "string"), "listings endpoint returned a ticket without a listing price");
  assert(listings.some((ticket) => ticket.mintAddress === expectedMint) === shouldContainExpected, "active listings did not reflect this ticket's chain state");
}

async function waitForIndexedTicket(mint: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await getJson(`/api/tickets/${mint}`);
      if (typeof response === "object" && response !== null && !Array.isArray(response)) {
        const ticket = response as Record<string, unknown>;
        if (ticket.isCheckedIn === true) return ticket;
      }
    } catch {
      // The chain ticket may not have reached the cache yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("indexer did not publish the checked-in Ticket before timeout");
}

async function waitForNewPoll(mint: string, since: number, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ticket = await Ticket.findOne({ mintAddress: mint });
    if (ticket && ticket.lastSyncedAt.getTime() > since) return ticket.toObject() as unknown as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("indexer did not refresh the same Mongo Ticket on a later poll");
}

async function waitForListingCache(mint: string, shouldBeListed: boolean, observedAfter: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const ticket = await Ticket.findOne({ mintAddress: mint });
    const isListed = ticket?.listingPriceLamports !== undefined && ticket.listingPriceLamports !== null;
    if (ticket && ticket.lastSyncedAt.getTime() >= observedAfter && isListed === shouldBeListed) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`indexer did not cache listing=${shouldBeListed} for ${mint}`);
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
const seller = Keypair.generate();
const buyer = Keypair.generate();
await mongoose.connect(process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/rents");
const platformAdmin = Keypair.generate();
const [platformConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("platform_config")],
  programId
);
const existingPlatformConfig = await program.account.platformConfig.fetchNullable(platformConfigPda);
const platformWallet = existingPlatformConfig?.platformWallet ?? Keypair.generate().publicKey;

await Promise.all([
  fund(organizer.publicKey),
  fund(seller.publicKey),
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

const eventName = "Task 3.7 Metadata Smoke";
const eventDescription = "Metadata endpoint integration fixture";
const eventVenue = "Rents Test Hall";
const eventDate = "2030-01-02T03:04:05.000Z";
const eventImage = "https://example.test/rents-ticket.png";
const savedEvent = await postJson("/api/events", {
  onChainEventId: eventId,
  organizerPubkey: organizer.publicKey.toBase58(),
  eventPda: eventPda.toBase58(),
  name: eventName,
  description: eventDescription,
  venue: eventVenue,
  date: eventDate,
  imageUrl: eventImage,
  maxTickets: 3,
  basePriceLamports: "10000000",
  resaleCapBps: 11_000,
  royaltyBps: 500,
});
assert(savedEvent.status === 201, `Event metadata creation returned ${savedEvent.status}`);
assert(objectRecord(savedEvent.payload, "created event").eventPda === eventPda.toBase58(), "saved Event metadata was linked to the wrong Event PDA");

const mint = Keypair.generate();
const mintResponse = await postTransaction("/api/tx/mint", {
  buyerPubkey: seller.publicKey.toBase58(),
  eventPda: eventPda.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
  eventName,
  uri: `http://127.0.0.1:${process.env.PORT ?? "4000"}/api/metadata/${mint.publicKey.toBase58()}`,
});
assert(typeof mintResponse.ticketPda === "string", "mint omitted ticketPda");
const mintTransaction = deserializeUnsigned(mintResponse, seller.publicKey);
await submit(mintTransaction, mintResponse.lastValidBlockHeight, seller, mint);

const ticketPda = new PublicKey(mintResponse.ticketPda);
const ticket = await program.account.ticket.fetch(ticketPda);
assert(ticket.mint.equals(mint.publicKey), "Ticket mint did not match");
assert(ticket.event.equals(eventPda), "Ticket Event did not match");
assert(ticket.faceValue.toString() === "10000000", "Ticket face value did not match");

const [buyerTokenAccount] = PublicKey.findProgramAddressSync(
  [
    seller.publicKey.toBuffer(),
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
assert(tokenAccountInfo.data.subarray(32, 64).equals(seller.publicKey.toBuffer()), "ticket token owner did not match seller");
assert(tokenAccountInfo.data.readBigUInt64LE(64) === 1n, "seller token balance was not 1");

const listResponse = await postTransaction("/api/tx/list", {
  holderPubkey: seller.publicKey.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
  priceLamports: "11000000",
});
const listTransaction = deserializeUnsigned(listResponse, seller.publicKey);
await submit(listTransaction, listResponse.lastValidBlockHeight, seller);
assert((await program.account.ticket.fetch(ticketPda)).listingPrice?.toString() === "11000000", "listing price was not stored");

const cancelResponse = await postTransaction("/api/tx/cancel-listing", {
  holderPubkey: seller.publicKey.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
});
const cancelTransaction = deserializeUnsigned(cancelResponse, seller.publicKey);
await submit(cancelTransaction, cancelResponse.lastValidBlockHeight, seller);
assert((await program.account.ticket.fetch(ticketPda)).listingPrice === null, "cancel-listing did not clear the listing");

const relistResponse = await postTransaction("/api/tx/list", {
  holderPubkey: seller.publicKey.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
  priceLamports: "11000000",
});
const relistTransaction = deserializeUnsigned(relistResponse, seller.publicKey);
const relistedAt = Date.now();
await submit(relistTransaction, relistResponse.lastValidBlockHeight, seller);
await waitForListingCache(mint.publicKey.toBase58(), true, relistedAt);
assertOnlyListedTickets(await getJson("/api/tickets/listings"), mint.publicKey.toBase58(), true);

const resellResponse = await postTransaction("/api/tx/resell", {
  buyerPubkey: buyer.publicKey.toBase58(),
  sellerPubkey: seller.publicKey.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
});
const resellTransaction = deserializeUnsigned(resellResponse, buyer.publicKey);
const resoldAt = Date.now();
await submit(resellTransaction, resellResponse.lastValidBlockHeight, buyer);
await waitForListingCache(mint.publicKey.toBase58(), false, resoldAt);

const resoldTicket = await program.account.ticket.fetch(ticketPda);
assert(resoldTicket.mint.equals(mint.publicKey), "resold Ticket was not found");
assert(resoldTicket.listingPrice === null, "listing was not cleared after resale");
assert(resoldTicket.resaleCount === 1, "resale count did not increase");
const [sellerTokenAccount] = PublicKey.findProgramAddressSync(
  [seller.publicKey.toBuffer(), new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(), mint.publicKey.toBuffer()],
  new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
);
const [resoldBuyerTokenAccount] = PublicKey.findProgramAddressSync(
  [buyer.publicKey.toBuffer(), new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(), mint.publicKey.toBuffer()],
  new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
);
const [actualSellerTokenAccount, actualBuyerTokenAccount] = await Promise.all([
  connection.getAccountInfo(sellerTokenAccount, "confirmed"),
  connection.getAccountInfo(resoldBuyerTokenAccount, "confirmed"),
]);
assert(actualSellerTokenAccount !== null && actualSellerTokenAccount.data.readBigUInt64LE(64) === 0n, "seller no longer owns the ticket");
assert(actualBuyerTokenAccount !== null, "buyer's token account was not created");
assert(actualBuyerTokenAccount.data.subarray(32, 64).equals(buyer.publicKey.toBuffer()), "buyer does not own the ticket");
assert(actualBuyerTokenAccount.data.readBigUInt64LE(64) === 1n, "buyer token balance was not 1");
assert(actualBuyerTokenAccount.data[108] === 2, "resold buyer token account is not frozen");
assertOnlyListedTickets(await getJson("/api/tickets/listings"), mint.publicKey.toBase58(), false);

const verifyBody = {
  mint: mint.publicKey.toBase58(),
  owner: buyer.publicKey.toBase58(),
  eventPda: eventPda.toBase58(),
};
const validVerification = await postJson("/api/checkin/verify", verifyBody);
assert(validVerification.status === 200, `valid chain verification returned ${validVerification.status}`);
const validVerificationBody = objectRecord(validVerification.payload, "valid verification response");
assert(validVerificationBody.valid === true, "valid ticket was not accepted");
assert(objectRecord(validVerificationBody.ticket, "verified chain Ticket").ownerPubkey === buyer.publicKey.toBase58(), "success response did not use the live owner");

const spoofedOwner = Keypair.generate().publicKey.toBase58();
await Ticket.updateOne({ mintAddress: mint.publicKey.toBase58() }, {
  $set: { ownerPubkey: spoofedOwner, isCheckedIn: false },
});
const staleCacheVerification = await postJson("/api/checkin/verify", verifyBody);
assert(staleCacheVerification.status === 200, "healthy chain verification did not override a stale cached owner");
assert(
  objectRecord(objectRecord(staleCacheVerification.payload, "stale-cache verification").ticket, "chain Ticket").ownerPubkey === buyer.publicKey.toBase58(),
  "stale Mongo owner leaked into the successful chain response"
);
const spoofedVerification = await postJson("/api/checkin/verify", {
  ...verifyBody,
  owner: spoofedOwner,
});
assert(spoofedVerification.status === 403, `spoofed QR owner returned ${spoofedVerification.status}, expected 403`);

const wrongEventVerification = await postJson("/api/checkin/verify", {
  ...verifyBody,
  eventPda: Keypair.generate().publicKey.toBase58(),
});
assert(wrongEventVerification.status === 409, `wrong Event returned ${wrongEventVerification.status}, expected 409`);

const unknownVerifyMint = Keypair.generate().publicKey;
const [unknownVerifyTicketPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("ticket"), unknownVerifyMint.toBuffer()],
  programId
);
await Ticket.create({
  mintAddress: unknownVerifyMint.toBase58(),
  ticketPda: unknownVerifyTicketPda.toBase58(),
  eventPda: eventPda.toBase58(),
  ownerPubkey: buyer.publicKey.toBase58(),
  faceValueLamports: "10000000",
  isCheckedIn: false,
  resaleCount: 0,
  lastSyncedAt: new Date(),
});
const chainMissingTicketVerification = await postJson("/api/checkin/verify", {
  mint: unknownVerifyMint.toBase58(),
  owner: buyer.publicKey.toBase58(),
  eventPda: eventPda.toBase58(),
});
assert(chainMissingTicketVerification.status === 404, "Mongo cache overrode a healthy chain response showing no Ticket");
await Ticket.deleteOne({ mintAddress: unknownVerifyMint.toBase58() });

await Ticket.updateOne({ mintAddress: mint.publicKey.toBase58() }, {
  $set: { ownerPubkey: buyer.publicKey.toBase58(), isCheckedIn: false },
});
const rpcFailureBackend = await startRpcFailureBackend();
try {
  const cacheFallback = await postJson("/api/checkin/verify", verifyBody, "4001");
  assert(cacheFallback.status === 200, `RPC-failure cache fallback returned ${cacheFallback.status}`);
  assert(objectRecord(cacheFallback.payload, "cache fallback response").valid === true, "valid cached ticket was not accepted after RPC failure");
} finally {
  rpcFailureBackend.kill();
  await rpcFailureBackend.exited;
}

const checkInResponse = await postTransaction("/api/tx/check-in", {
  organizerPubkey: organizer.publicKey.toBase58(),
  holderPubkey: buyer.publicKey.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
});
const checkInTransaction = deserializeUnsigned(checkInResponse, organizer.publicKey);
await submit(checkInTransaction, checkInResponse.lastValidBlockHeight, organizer);
const checkedInTicket = await program.account.ticket.fetch(ticketPda);
assert(checkedInTicket.isUsed, "Ticket was not marked used");
await Ticket.updateOne({ mintAddress: mint.publicKey.toBase58() }, { $set: { isCheckedIn: false } });
const usedTicketVerification = await postJson("/api/checkin/verify", verifyBody);
assert(usedTicketVerification.status === 409, "healthy chain acceptance did not reject the used Ticket despite stale cache");
assert(objectRecord(usedTicketVerification.payload, "used Ticket rejection").valid === false, "used Ticket response was not rejected");

const expectedCache = {
  mint: mint.publicKey.toBase58(),
  eventPda: eventPda.toBase58(),
  ticketPda: ticketPda.toBase58(),
  owner: buyer.publicKey.toBase58(),
  faceValue: "10000000",
  usedAt: new Date(Number(checkedInTicket.usedAt.toString()) * 1000),
};
const firstIndexedTicket = assertIndexedTicket(
  await waitForIndexedTicket(expectedCache.mint, 20_000),
  expectedCache
);
const malformedSync = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}/api/tickets/not-a-public-key/sync`, {
  method: "POST",
});
assert(malformedSync.status === 400, `malformed mint sync returned ${malformedSync.status}, expected 400`);
const missingMint = Keypair.generate().publicKey.toBase58();
const missingSync = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}/api/tickets/${missingMint}/sync`, {
  method: "POST",
});
assert(missingSync.status === 404, `nonexistent ticket sync returned ${missingSync.status}, expected 404`);
assert(await Ticket.countDocuments({ mintAddress: missingMint }) === 0, "nonexistent sync created a Mongo cache row");

const explicitSyncResponse = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}/api/tickets/${expectedCache.mint}/sync`, {
  method: "POST",
});
const explicitSync: unknown = await explicitSyncResponse.json();
assert(explicitSyncResponse.ok, `explicit sync returned ${explicitSyncResponse.status}: ${JSON.stringify(explicitSync)}`);
const explicitlySyncedTicket = assertIndexedTicket(explicitSync, expectedCache);

const metadata = objectRecord(await getJson(`/api/metadata/${expectedCache.mint}`), "NFT metadata");
assert(metadata.name === `${eventName} #${checkedInTicket.ticketNumber}`, "metadata name did not match mint naming convention and authoritative ticket number");
assert(metadata.symbol === "RENTS", "metadata symbol did not match");
assert(metadata.description === eventDescription, "metadata description did not come from the matching Event");
assert(metadata.image === eventImage, "metadata image did not come from the matching Event");
assert(Array.isArray(metadata.attributes), "metadata attributes were not an array");
const attributes = metadata.attributes.map((value) => objectRecord(value, "metadata attribute"));
const attributeValues = new Map(attributes.map((attribute) => [attribute.trait_type, attribute.value]));
assert(attributeValues.get("event") === eventName, "event attribute was incorrect");
assert(attributeValues.get("venue") === eventVenue, "venue attribute was incorrect");
assert(attributeValues.get("date") === eventDate, "date attribute was incorrect");
assert(attributeValues.get("ticket #") === String(checkedInTicket.ticketNumber), "ticket number attribute was not authoritative");
const serializedMetadata = JSON.stringify(metadata);
assert(typeof serializedMetadata === "string", "metadata was not JSON serializable");
objectRecord(JSON.parse(serializedMetadata) as unknown, "serialized NFT metadata");

const removedEventCache = await Event.findOneAndDelete({ eventPda: expectedCache.eventPda });
assert(removedEventCache !== null, "metadata Event cache fixture was missing before the missing-Event test");
const missingEventMetadata = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}/api/metadata/${expectedCache.mint}`);
assert(missingEventMetadata.status === 404, `missing Event metadata returned ${missingEventMetadata.status}, expected 404`);
await Event.create({
  onChainEventId: eventId,
  organizerPubkey: organizer.publicKey.toBase58(),
  eventPda: eventPda.toBase58(),
  name: eventName,
  description: eventDescription,
  venue: eventVenue,
  date: eventDate,
  imageUrl: eventImage,
  maxTickets: 3,
  basePriceLamports: "10000000",
  resaleCapBps: 11_000,
  royaltyBps: 500,
});

const badMetadataResponse = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}/api/metadata/not-a-public-key`);
assert(badMetadataResponse.status === 400, `invalid metadata mint returned ${badMetadataResponse.status}, expected 400`);
const unknownMint = Keypair.generate().publicKey.toBase58();
const unknownMetadataResponse = await fetch(`http://127.0.0.1:${process.env.PORT ?? "4000"}/api/metadata/${unknownMint}`);
assert(unknownMetadataResponse.status === 404, `unknown metadata mint returned ${unknownMetadataResponse.status}, expected 404`);

const duplicateDocumentCount = await Ticket.countDocuments({ mintAddress: expectedCache.mint });
assert(duplicateDocumentCount === 1, `expected one Mongo cache document, found ${duplicateDocumentCount}`);
await waitForNewPoll(expectedCache.mint, Date.parse(String(explicitlySyncedTicket.lastSyncedAt)), 15_000);
const repeatedPollCount = await Ticket.countDocuments({ mintAddress: expectedCache.mint });
assert(repeatedPollCount === 1, `repeated polling created duplicate Mongo cache rows: ${repeatedPollCount}`);

const duplicateResponse = await postTransaction("/api/tx/check-in", {
  organizerPubkey: organizer.publicKey.toBase58(),
  holderPubkey: buyer.publicKey.toBase58(),
  mintPubkey: mint.publicKey.toBase58(),
});
const duplicateTransaction = deserializeUnsigned(duplicateResponse, organizer.publicKey);
duplicateTransaction.partialSign(organizer);
let duplicateFailure: unknown;
try {
  const signature = await connection.sendRawTransaction(duplicateTransaction.serialize());
  assert(typeof duplicateTransaction.recentBlockhash === "string", "duplicate check-in omitted the blockhash");
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: duplicateTransaction.recentBlockhash,
    lastValidBlockHeight: duplicateResponse.lastValidBlockHeight,
  }, "confirmed");
  duplicateFailure = confirmation.value.err;
} catch (error) {
  duplicateFailure = error;
}
assert(duplicateFailure !== undefined && duplicateFailure !== null, "second check-in unexpectedly succeeded");
assert(/6012|0x177c|TicketAlreadyUsed/.test(String(duplicateFailure)), `second check-in failed unexpectedly: ${String(duplicateFailure)}`);

console.log(
  JSON.stringify({
    initializeEvent: "confirmed through API; organizer and event fields verified",
    mint: "confirmed through API; Ticket, supply 1, and seller ownership verified",
    list: "confirmed through API; listing price verified",
    cancelListing: "confirmed through API; listing cleared, then relisted",
    resell: "confirmed through API; buyer ownership, cleared listing, resale count, and frozen ATA verified",
    checkIn: "confirmed through API; is_used verified; duplicate rejected with TicketAlreadyUsed (6012)",
    indexer: "Mongo cache verified through polling and POST sync; repeated polling kept one document",
    listings: "GET listings included the ticket while listed and excluded it after resale",
    metadata: "GET metadata returned Metaplex-compatible JSON from the matching Event and authoritative Ticket number; invalid mint, unknown mint, and missing Event returned 400/404",
    checkInVerify: "chain accepted the live holder; rejected used, wrong-Event, spoofed-owner, and chain-missing tickets despite stale Mongo; unreachable-RPC fallback accepted the valid cached Ticket",
    eventPda: eventPda.toBase58(),
    ticketPda: ticketPda.toBase58(),
    userTransactionsUnsignedBeforeClientSigning: true,
  })
);
await mongoose.disconnect();
