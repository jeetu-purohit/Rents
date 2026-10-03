import { Schema, model, Document } from "mongoose";

export interface ITicket extends Document {
  mintAddress: string;
  ticketPda: string;
  eventPda: string;
  ownerPubkey: string;
  faceValueLamports: string;
  listingPriceLamports?: string;
  isCheckedIn: boolean;
  checkedInAt?: Date;
  resaleCount: number;
  lastSyncedAt: Date;
}

const TicketSchema = new Schema<ITicket>(
  {
    mintAddress: { type: String, required: true, unique: true, index: true },
    ticketPda: { type: String, required: true, unique: true, index: true },
    eventPda: { type: String, required: true, index: true },
    ownerPubkey: { type: String, required: true, index: true },
    faceValueLamports: { type: String, required: true },
    listingPriceLamports: { type: String },
    isCheckedIn: { type: Boolean, default: false },
    checkedInAt: { type: Date },
    resaleCount: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Ticket = model<ITicket>("Ticket", TicketSchema);
