import { PublicKey } from "@solana/web3.js";
import { program, programId } from "../config/solana.js";

export interface PlatformConfigResponse {
  platformFeeBps: number;
  platformWallet: string;
}

export async function getPlatformConfig(): Promise<PlatformConfigResponse> {
  const [platformConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform_config")],
    programId
  );
  const config = await program.account.platformConfig.fetchNullable(platformConfigPda);
  if (!config) {
    const error = new Error("PlatformConfig is not initialized on chain") as Error & { status: number };
    error.status = 503;
    throw error;
  }

  return {
    platformFeeBps: config.platformFeeBps,
    platformWallet: config.platformWallet.toBase58(),
  };
}
