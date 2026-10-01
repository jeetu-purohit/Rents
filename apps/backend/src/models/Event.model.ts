//off-chain event metadata

import { Schema, model, Document } from "mongoose";

//structure of the event we are initializing 
export interface IEvent extends Document {
  onChainEventId: string;   // PDA / account pubkey of the initialized event on-chain
  organizerPubkey: string;  // wallet pubkey that owns/authored this event
  name: string;
  description: string;
  venue: string;
  date: Date;
  imageUrl?: string;
  maxTickets: number;
  basePriceLamports: number;
  resaleCapPercent: number;   // e.g. 110
  royaltyPercent: number;     // e.g. 5
  createdAt: Date;
  updatedAt: Date;
}

const EventSchema = new Schema<IEvent>(
  {
    onChainEventId: { type: String, required: true, unique: true, index: true },
    organizerPubkey: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    venue: { type: String, required: true },
    date: { type: Date, required: true },
    imageUrl: { type: String },
    maxTickets: { type: Number, required: true },
    basePriceLamports: { type: Number, required: true },
    resaleCapPercent: { type: Number, default: 110 },
    royaltyPercent: { type: Number, default: 5 },
  },
  { timestamps: true }
);

export const Event = model<IEvent>("Event", EventSchema);