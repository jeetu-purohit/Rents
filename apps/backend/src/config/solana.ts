import { Program, type Idl, type Provider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import sharedIdlJson from "shared/idl/rents_ticketing.json";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

const rpcUrl = requiredEnv("SOLANA_RPC_URL");
const programIdValue = requiredEnv("PROGRAM_ID");

export const programId = new PublicKey(programIdValue);
export const connection = new Connection(rpcUrl, "confirmed");

// Anchor 0.32 reads the address from the IDL. Override only that field so the
// environment remains the source of truth for which deployed program is used.
const configuredIdl: Idl = { ...(sharedIdlJson as Idl), address: programId.toBase58() };
const readOnlyProvider: Provider = { connection };

export const program = new Program(configuredIdl, readOnlyProvider);
