import "dotenv/config";
import { connection, program } from "../config/solana.ts";

const accountInfo = await connection.getAccountInfo(program.programId);
if (!accountInfo?.executable) {
  throw new Error(`Program account ${program.programId.toBase58()} was not found or is not executable`);
}

console.log(
  `Program ${program.programId.toBase58()} is accessible (owner ${accountInfo.owner.toBase58()}, ${accountInfo.data.length} bytes)`
);
