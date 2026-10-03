import { PublicKey } from "@solana/web3.js";
import { program, programId } from "../config/solana";
import { Event } from "../models/Event.model";
import { Ticket } from "../models/Ticket.model";

export interface TicketMetadata {
  name: string;
  symbol: "RENTS";
  description: string;
  image: string;
  attributes: Array<{ trait_type: string; value: string }>;
}

export class MetadataError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function parseMint(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new MetadataError("mint must be a valid Solana public key", 400);
  }
}

export async function getTicketMetadata(mintValue: string): Promise<TicketMetadata> {
  const mint = parseMint(mintValue);
  const cachedTicket = await Ticket.findOne({ mintAddress: mint.toBase58() });
  if (!cachedTicket) throw new MetadataError("Ticket metadata is not available for this mint", 404);

  let ticketPda: PublicKey;
  try {
    ticketPda = new PublicKey(cachedTicket.ticketPda);
  } catch {
    throw new MetadataError("Ticket cache contains an invalid Ticket PDA", 409);
  }
  const [canonicalTicketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), mint.toBuffer()],
    programId
  );
  if (!ticketPda.equals(canonicalTicketPda)) {
    throw new MetadataError("Ticket cache identity does not match the requested mint", 409);
  }

  const ticket = await program.account.ticket.fetchNullable(ticketPda);
  if (!ticket) throw new MetadataError("On-chain Ticket account was not found", 404);
  if (!ticket.mint.equals(mint) || ticket.event.toBase58() !== cachedTicket.eventPda) {
    throw new MetadataError("Ticket cache identity does not match the on-chain Ticket", 409);
  }

  const event = await Event.findOne({ eventPda: ticket.event.toBase58() });
  if (!event) throw new MetadataError("Event metadata is not available for this Ticket", 404);
  const image = event.imageUrl?.trim();
  if (!image) throw new MetadataError("Event metadata is missing an image URL", 422);

  return {
    name: `${event.name} #${ticket.ticketNumber}`,
    symbol: "RENTS",
    description: event.description,
    image,
    attributes: [
      { trait_type: "event", value: event.name },
      { trait_type: "venue", value: event.venue },
      { trait_type: "date", value: event.date.toISOString() },
      { trait_type: "ticket #", value: String(ticket.ticketNumber) },
    ],
  };
}
