//indexed/cached ticket state
import { Schema, model, Document } from "mongoose";

export interface ITicket extends Document {
  mintAddress: string;       // NFT mint pubkey — primary link to on-chain ticket
  eventOnChainId: string;    // references Event.onChainEventId
  ownerPubkey: string;       // current holder wallet
  currentPriceLamports: number;
  isCheckedIn: boolean;
  checkedInAt?: Date;
  lastSyncedAt: Date;        // last time indexer refreshed this from chain
}

const TicketSchema = new Schema<ITicket>(
  {
    mintAddress: { type: String, required: true, unique: true, index: true },
    eventOnChainId: { type: String, required: true, index: true },
    ownerPubkey: { type: String, required: true, index: true },
    currentPriceLamports: { type: Number, required: true },
    isCheckedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Ticket = model<ITicket>("Ticket", TicketSchema);