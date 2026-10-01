//optional: wallet -> profile mapping

import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
  pubkey: string;         // wallet address, primary identifier
  isOrganizer: boolean;   // true => frontend shows organizer dashboard
  displayName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    pubkey: { type: String, required: true, unique: true, index: true },
    isOrganizer: { type: Boolean, default: false },
    displayName: { type: String },
  },
  { timestamps: true }
);

export const User = model<IUser>("User", UserSchema);