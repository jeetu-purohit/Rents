import { Schema, model, Document } from "mongoose";

export interface IEvent extends Document {
  onChainEventId: string;
  organizerPubkey: string;
  eventPda: string;
  name: string;
  description: string;
  venue: string;
  date: Date;
  imageUrl?: string;
  maxTickets: number;
  basePriceLamports: string;
  resaleCapBps: number;
  royaltyBps: number;
  createdAt: Date;
  updatedAt: Date;
}

const EventSchema = new Schema<IEvent>(
  {
    onChainEventId: { type: String, required: true, unique: true, index: true },
    organizerPubkey: { type: String, required: true, index: true },
    eventPda: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    venue: { type: String, required: true },
    date: { type: Date, required: true },
    imageUrl: { type: String },
    maxTickets: { type: Number, required: true },
    basePriceLamports: { type: String, required: true },
    resaleCapBps: { type: Number, default: 11_000 },
    royaltyBps: { type: Number, default: 500 },
  },
  { timestamps: true }
);

export const Event = model<IEvent>("Event", EventSchema);
