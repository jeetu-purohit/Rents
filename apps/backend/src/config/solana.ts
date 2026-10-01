//Connection, program IDL loader, provider 


import { Connection, clusterApiUrl } from "@solana/web3.js";

// NOTE: swap between "localnet" and "devnet" via env var during dev vs demo
const SOLANA_CLUSTER = process.env.SOLANA_CLUSTER || "localnet";

function resolveEndpoint(): string {
  if (SOLANA_CLUSTER === "localnet") return "http://127.0.0.1:8899";
  if (SOLANA_CLUSTER === "devnet") return clusterApiUrl("devnet");
  return SOLANA_CLUSTER; // allow passing a raw RPC URL directly
}

export const connection = new Connection(resolveEndpoint(), "confirmed");

// TODO (next step): load the Anchor IDL + program ID here once the program
// is built, and export a `getProgram()` helper using an AnchorProvider.
// We'll wire this up when we get to solanaTx.service.ts / indexer.service.ts.

export const PROGRAM_ID_PLACEHOLDER = process.env.PROGRAM_ID || "";