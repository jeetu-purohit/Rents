import { PublicKey } from '@solana/web3.js'

const programId = import.meta.env.VITE_PROGRAM_ID?.trim() || 'E92DmfyvMfLBWs9TqzFzN11khwxopKEvCKPoD3jY9zhw'
const apiBaseUrl = import.meta.env.VITE_API_URL?.trim() || 'http://localhost:4000/api'
const rpcUrl = import.meta.env.VITE_SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com'

export const frontendConfig = {
  apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
  rpcUrl,
  programId: new PublicKey(programId),
  network: 'devnet' as const,
}
