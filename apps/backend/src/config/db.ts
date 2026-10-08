//MONGODb connection logic 

import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI!;

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[db] connected `);
  } catch (err) {
    console.error("[db] connection error:", err);
    process.exit(1);
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
}