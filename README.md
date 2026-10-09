# RENTS

**RENTS** is a Solana ticketing prototype that represents event tickets as NFTs and enforces resale rules in an on-chain Anchor program. It is designed to make ticket ownership and resale verifiable while giving organizers a direct role in event setup and check-in.

The project explores a practical response to ticket scalping: each ticket keeps its original face value, resale price is capped against that value, and an organizer royalty is paid on resale. RENTS is a hackathon and portfolio project; it has not been presented as an audited or production-ready ticketing service.

## What it does

- Organizers create events with capacity, face price, a resale cap, and a royalty rate.
- Buyers pay in SOL and receive a one-of-one SPL token ticket with Metaplex Token Metadata.
- Holders can list or cancel a resale listing; the program checks the cap both when listing and when reselling.
- Resales split payment between the seller, event organizer, and platform wallet.
- Ticket holders can display a QR code; an organizer scans and signs the on-chain check-in. Repeated check-in is rejected.
- A React web app provides event discovery, event details, wallet connection, ticket management, organizer tools, and a scanner flow.

## Why Solana

RENTS uses Solana for programmable ownership and payment settlement. The rules for ticket supply, resale price, payment splits, and check-in are represented in a program that can be inspected and verified on the network. Wallet signing lets users authorize transactions without giving RENTS their private keys. This prototype does not include a measured comparison with other chains; that work is still planned.

## Architecture and data ownership

```text
React app + Phantom
  ├── reads event, ticket, listing, and metadata APIs ──▶ Bun/Express backend ──▶ MongoDB
  ├── requests unsigned transaction builders ◀─────────┘
  └── signs and submits transactions ────────────────────────────────────────▶ Solana
                                                                                ├─ RENTS Anchor program
                                                                                └─ Metaplex Token Metadata
```

The Solana program is authoritative for ticket ownership, event capacity, listing state, resale payments, and check-in state. MongoDB stores descriptive event data and a ticket cache used by the API and frontend. The backend polls chain state for ticket indexing when enabled. It builds unsigned transactions; the connected wallet signs and submits them. The backend does not custody user keys.

Event name, date, venue, description, and image URL are stored off-chain. The backend serves ticket metadata JSON at `/api/metadata/:mint`, and the NFT metadata URI points to that endpoint. Chain state remains the source of truth for ticket ownership and use.

## Ticket lifecycle

1. **Create event.** The organizer submits event parameters to create an on-chain Event PDA and saves descriptive metadata through the backend.
2. **Mint.** A buyer signs a purchase transaction. The program pays the event face value to the organizer, charges the platform fee separately, mints one token, creates its metadata, and records a Ticket PDA.
3. **Own.** The token account holding the ticket is frozen under the program's ticket authority. The app reads ownership from Solana-backed ticket data.
4. **Resale.** The holder sets a listing price or cancels the listing. A buyer purchases a listed ticket through the program; payment is split and token ownership changes atomically.
5. **Check-in.** The ticket QR carries the mint, owner, and event PDA. The backend verifies the ticket against chain state; the event organizer signs `check_in_ticket`. The program records it as used and rejects a duplicate check-in.

### Caps, royalties, and fees

All rates use basis points (10,000 bps = 100%). The defaults in the program are a 110% resale cap, 5% organizer royalty, and 1% platform fee. Event organizers choose the cap and royalty when creating an event; the platform fee is held in the platform configuration and is capped on-chain at 5%.

| Transaction | Payment rule |
|---|---|
| Initial purchase | Buyer pays face value to the organizer, plus the platform fee to the platform wallet. |
| Resale | Buyer pays the listing price plus the platform fee. From the listing price, the organizer receives the royalty and the seller receives the remainder. |
| Resale cap | Listing price must not exceed original face value × event cap bps ÷ 10,000. The program rechecks this during resale. |

Basis-point calculations use integer arithmetic and floor fractional lamports. The platform fee is calculated on the ticket price, is paid on top by the buyer, and does not count toward the resale cap. The mint's Metaplex metadata also records the event royalty bps; payment enforcement for this app's resale flow is performed by the RENTS program.

## On-chain and off-chain responsibilities

| On-chain: Solana / Anchor | Off-chain: backend / MongoDB |
|---|---|
| Event and Ticket PDAs; ticket supply and face value | Event descriptions, dates, venues, and image URLs |
| Minting and Metaplex metadata creation | Public metadata JSON endpoint |
| Listing, cap checks, royalty and platform fee transfers | API validation and unsigned transaction construction |
| Ticket token movement during program resale | Ticket cache and polling indexer |
| Single-use check-in state | Chain-first QR verification with cache fallback for RPC read failures |

The backend does not replace chain validation. A public-key value in an API request is not wallet-signature authentication; transaction-changing actions still require the appropriate wallet signature on-chain.

## Tech stack

- **Program:** Rust, Anchor, Anchor SPL, Metaplex Token Metadata
- **Frontend:** Vite, React, TypeScript, Tailwind CSS, Solana Web3.js, Solana Wallet Adapter (Phantom), `qrcode.react`, `@zxing/browser`
- **Backend:** Bun, Express, Mongoose, Solana Web3.js, Anchor TypeScript client
- **Database:** MongoDB
- **Tests:** Anchor/TypeScript integration tests using `ts-mocha` and a local validator with the Metaplex Token Metadata program

## Repository layout

```text
programs/rents-ticketing/src/   Anchor program, state, errors, and instructions
packages/shared/                Shared API types and generated program IDL
apps/backend/src/               Express API, models, services, and transaction builders
apps/frontend/src/              React pages, wallet flow, API client, and QR scanner
tests/rents-ticketing.ts        On-chain integration tests
Anchor.toml                     Anchor workspace and local test-validator configuration
```

## Local development

### Prerequisites

Install Bun, Rust, Solana CLI, and Anchor. The repository's recorded environment uses Bun 1.3.13, Rust 1.98.1, Solana CLI 4.2.2, and Anchor CLI 1.1.2. You will also need a MongoDB instance reachable from the backend. There is no root Docker Compose file in the current repository.

### Install and configure

From the repository root:

```bash
bun install
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env
```

Update the local backend environment as needed. `MONGO_URI` must point to your MongoDB instance. The checked-in examples use Solana Devnet and the program ID configured by this repository. Keep credentials in local ignored environment files; never commit them.

| Variable | Used by | Purpose |
|---|---|---|
| `PORT` | Backend | HTTP port (example: `4000`) |
| `FRONTEND_ORIGIN` | Backend | Allowed browser origin (example: `http://localhost:5173`) |
| `MONGO_URI` | Backend | MongoDB connection string; use your own local or hosted database URI |
| `SOLANA_RPC_URL` | Backend | Solana RPC endpoint |
| `PROGRAM_ID` | Backend | RENTS program address |
| `INDEXER_ENABLED` | Backend | Set to `true` to start the polling indexer; example defaults to `false` |
| `VITE_API_URL` | Frontend | Backend API base URL |
| `VITE_SOLANA_RPC_URL` | Frontend | Solana RPC endpoint used by the app |
| `VITE_PROGRAM_ID` | Frontend | RENTS program address |

The frontend also has defaults for API URL, Devnet RPC, and program ID in `apps/frontend/src/lib/config.ts`. The backend requires `SOLANA_RPC_URL` and `PROGRAM_ID` to be set.

### Run the app

```bash
# Frontend and backend together (MongoDB must already be available)
bun run dev

# Or start either service separately
bun run --cwd apps/frontend dev
bun run --cwd apps/backend dev
```

The frontend runs through Vite (normally `http://localhost:5173`) and the backend defaults to port `4000`. The backend health endpoint is `GET /health`.

### Build and verify

```bash
# Build the on-chain program and generated IDL
anchor build

# Run Anchor integration tests on the configured local validator
anchor test

# Build the shared package
bun run build:shared

# Frontend production build and lint
bun run --cwd apps/frontend build
bun run --cwd apps/frontend lint

# Backend type check
bunx tsc --noEmit -p apps/backend
```

`anchor test` uses the Metaplex Token Metadata program binary at `.metaplex/mpl-token-metadata.so`. If it is absent, the test script configured in `Anchor.toml` attempts to download it from Devnet using the Solana CLI. Build and test results can vary with the local Rust, Solana, Anchor, and Node toolchain versions.

The checked-in TypeScript integration suite covers event and platform configuration, minting and payment amounts, listing and cancellation, cap and resale splits, rejected direct token transfers, invalid resale conditions, capacity, and check-in behavior. The latest repository journal entries report successful checks for the implemented contract and app flows, including a user-verified Devnet scanner/check-in path. A full three-wallet end-to-end rehearsal remains an open project task; this README does not claim that every possible environment or flow has been verified.

## Backend API overview

The backend exposes JSON APIs under `/api` and validates path parameters and request fields. The main route groups are:

| Route group | Purpose |
|---|---|
| `/api/events` | Browse, retrieve, create, and update event records; query events by organizer |
| `/api/tickets` | Read tickets by owner, event, or mint; read listings; request a ticket cache sync |
| `/api/tx` | Build unsigned transactions for event initialization, mint, list, cancel, resale, and check-in |
| `/api/checkin/verify` | Verify QR ticket details against chain state, with cache fallback when RPC reads fail |
| `/api/metadata/:mint` | Serve Metaplex-compatible ticket metadata JSON |
| `/api/platform` | Read platform fee configuration from chain |

Use the route files in `apps/backend/src/routes/` as the source of truth for request and response details. The API is not a wallet-authentication layer for read or metadata requests.

## Frontend flows

The current app includes the landing page and event exploration, event details and purchase, My Stubs with ticket QR display and resale actions, an organizer dashboard/event creation flow, and a scanner page for QR verification and check-in. Phantom is the user wallet connection and transaction-signing interface. Routes and page components live in `apps/frontend/src/`.

## Program interface

The program address declared in source and configured for localnet/Devnet is `E92DmfyvMfLBWs9TqzFzN11khwxopKEvCKPoD3jY9zhw`.

| Instruction | Purpose |
|---|---|
| `initialize_platform_config` | Create platform settings with admin, platform wallet, and fee |
| `update_platform_wallet`, `update_platform_fee` | Admin-controlled platform configuration updates |
| `initialize_event` | Create an event account for its organizer and event ID |
| `mint_ticket` | Charge for and mint a ticket with metadata |
| `list_ticket`, `cancel_listing` | Set or clear the ticket's resale price |
| `resell_ticket` | Enforce resale rules, split payments, and transfer ticket ownership |
| `check_in_ticket` | Organizer records a one-time check-in |

The Event PDA uses `event`, organizer public key, and the little-endian event ID as seeds. A Ticket PDA uses `ticket` and the mint; the ticket authority PDA uses `authority`; platform config uses `platform_config`. The full account constraints and IDL are available in `programs/rents-ticketing/src/` and `packages/shared/idl/rents_ticketing.json`.

## Devnet

The source and Anchor configuration identify the program as `E92DmfyvMfLBWs9TqzFzN11khwxopKEvCKPoD3jY9zhw` for Devnet. The frontend defaults to the public Devnet RPC endpoint. For local integration testing, Anchor uses a local validator. A program ID in configuration is not, by itself, a guarantee that a deployment is currently available or maintained; check the target cluster before relying on it. Do not publish wallet keypairs or RPC credentials.

## Limitations and next steps

- The planned three-wallet Devnet end-to-end rehearsal has not been completed in the task tracker.
- The demo seed script and research experiments for measured Solana costs/speed, Ethereum comparison, and scalping simulation remain planned and are not included.
- Wallet-signature authentication for backend read/metadata requests is not implemented; those endpoints use the supplied public key as request data.
- Mainnet, fiat payments, refunds, and secondary marketplace integrations are outside the current scope.
- The frontend production build has previously emitted wallet dependency browser-externalization and bundle-size warnings, as recorded in the project journal.

## License and credits

No license file or explicit license grant is present in the repository. No license is stated here; contact the project maintainers before reusing the code. The project uses Solana, Anchor, Metaplex Token Metadata, MongoDB, React, and the libraries listed above.
