import { PublicKey } from "@solana/web3.js";
import sharedIdlJson from "shared/idl/rents_ticketing.json" with { type: "json" };
import { connection, program, programId } from "../config/solana.js";
import { Ticket } from "../models/Ticket.model.js";

const TICKET_SEED = Buffer.from("ticket");
const EVENT_SEED = Buffer.from("event");
const TOKEN_ACCOUNT_SIZE = 165;

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

export class TicketSyncError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function parseMint(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new TicketSyncError("mint must be a valid Solana public key", 400);
  }
}

function deriveTicketPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([TICKET_SEED, mint.toBuffer()], programId)[0];
}

function canonicalEventPda(organizer: PublicKey, eventId: { toArrayLike: (type: typeof Buffer, endian: "le", length: number) => Buffer }): PublicKey {
  return PublicKey.findProgramAddressSync(
    [EVENT_SEED, organizer.toBuffer(), eventId.toArrayLike(Buffer, "le", 8)],
    programId
  )[0];
}

async function currentOwner(mint: PublicKey): Promise<string> {
  const largest = await connection.getTokenLargestAccounts(mint, "confirmed");
  for (const tokenAccount of largest.value) {
    if (tokenAccount.amount !== "1") continue;
    const account = await connection.getAccountInfo(tokenAccount.address, "confirmed");
    if (!account || !account.owner.equals(tokenProgramId) || account.data.length !== TOKEN_ACCOUNT_SIZE) continue;
    if (!new PublicKey(account.data.subarray(0, 32)).equals(mint)) continue;
    if (account.data.readBigUInt64LE(64) !== 1n) continue;
    return new PublicKey(account.data.subarray(32, 64)).toBase58();
  }
  throw new TicketSyncError("No current token account holding this ticket was found", 422);
}

async function upsertTicket(mint: PublicKey, ticketPda: PublicKey, ticket: Awaited<ReturnType<typeof program.account.ticket.fetch>>) {
  if (!ticket.mint.equals(mint)) throw new TicketSyncError("Ticket account mint does not match requested mint", 422);
  if (!deriveTicketPda(mint).equals(ticketPda)) throw new TicketSyncError("Ticket account is not the canonical Ticket PDA", 422);

  const event = await program.account.event.fetchNullable(ticket.event);
  if (!event) throw new TicketSyncError("Ticket's Event account does not exist", 422);
  if (!canonicalEventPda(event.organizer, event.eventId).equals(ticket.event)) {
    throw new TicketSyncError("Ticket's Event account is not the canonical Event PDA", 422);
  }

  const ownerPubkey = await currentOwner(mint);
  const syncedAt = new Date();
  const fields = {
    mintAddress: mint.toBase58(),
    ticketPda: ticketPda.toBase58(),
    eventPda: ticket.event.toBase58(),
    ownerPubkey,
    faceValueLamports: ticket.faceValue.toString(),
    isCheckedIn: ticket.isUsed,
    resaleCount: ticket.resaleCount,
    lastSyncedAt: syncedAt,
  };
  const update: Record<string, unknown> = { $set: fields };
  if (ticket.listingPrice === null) {
    update.$unset = { listingPriceLamports: 1 };
  } else {
    (update.$set as Record<string, unknown>).listingPriceLamports = ticket.listingPrice.toString();
  }
  if (ticket.isUsed) {
    (update.$set as Record<string, unknown>).checkedInAt = new Date(Number(ticket.usedAt.toString()) * 1000);
  } else {
    update.$unset = { ...(update.$unset as Record<string, unknown> | undefined), checkedInAt: 1 };
  }

  await Ticket.updateOne({ mintAddress: mint.toBase58() }, update, { upsert: true });
  const synced = await Ticket.findOne({ mintAddress: mint.toBase58() });
  if (!synced) throw new Error("Ticket cache upsert completed without a readable document");
  return synced;
}

export async function syncTicket(mintValue: string) {
  const mint = parseMint(mintValue);
  const ticketPda = deriveTicketPda(mint);
  const ticket = await program.account.ticket.fetchNullable(ticketPda);
  if (!ticket) throw new TicketSyncError("Ticket account was not found for mint", 404);
  return upsertTicket(mint, ticketPda, ticket);
}

let pollTimer: ReturnType<typeof setInterval> | undefined;
let pollInProgress = false;

export function startIndexer(intervalMs = 10_000): boolean {
  if (pollTimer) return false;
  const poll = async () => {
    if (pollInProgress) return;
    pollInProgress = true;
    try {
      const tickets = await program.account.ticket.all();
      for (const { publicKey, account } of tickets) {
        try {
          await upsertTicket(account.mint, publicKey, account);
        } catch (error) {
          console.warn(`[indexer] skipped Ticket ${publicKey.toBase58()}:`, error);
        }
      }
    } catch (error) {
      console.error("[indexer] polling failed:", error);
    } finally {
      pollInProgress = false;
    }
  };

  console.log(`[indexer] polling enabled (${intervalMs} ms)`);
  void poll();
  pollTimer = setInterval(() => void poll(), intervalMs);
  return true;
}

export function stopIndexer(): void {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = undefined;
}
