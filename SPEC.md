# RENTS: SPEC.md

Royalty-Enforced NFT Ticketing System on Solana.
This file is the **single source of truth**. Agents must not change it. If code and spec conflict, or the spec is ambiguous, the agent stops and asks the human.

Items tagged **[OPEN Dn]** are undecided. The agent must NOT pick an answer on its own; use the "default until decided" noted there, or ask.

---

## 1. What we are building

A web ticketing app where tickets are NFTs on Solana. The smart contract enforces two rules regular platforms cannot:

1. **Price cap:** a ticket can never be resold above `resale_cap_bps` of its original face value (default 110%).
2. **Royalty:** every resale automatically pays `royalty_bps` of the resale price (default 5%) to the event organizer.

Plus two supporting properties:

- **Closed transfers:** a ticket NFT can only change hands through `resell_ticket`. Any other transfer (wallet-to-wallet, via another program or marketplace) must be **rejected by the chain**. Without this, the cap and royalty could be bypassed.
- **Platform fee:** a small fee on each purchase (initial mint and resale) goes to the platform wallet. It is paid by the buyer on top of the ticket price, so organizers and sellers never lose money to it.

Result: scalping is pointless (no markup room) and organizers earn on resales.

**Audience:** non-technical students. Blockchain is hidden behind a normal-feeling web UI. The only crypto touchpoint is Phantom wallet connect/sign.

**Paired research paper:** "Royalty-Enforced NFT Ticketing on Solana: A Low-Cost Blockchain Approach to Mitigating Event Ticket Scalping." Needs (a) a Solana vs Ethereum cost/speed comparison and (b) a capped vs uncapped scalping simulation. See section 9.

---

## 2. Scope

### In scope (MVP, must work in demo)
- Organizer creates an event (on-chain + off-chain metadata)
- Buyer buys a ticket (mints NFT to their wallet; payment goes to organizer)
- Ticket holder lists a ticket for resale at a price, with the cap enforced
- Another user buys the listed ticket: price cap enforced, 5% royalty auto-split, ticket transfers
- Organizer/staff scans a QR to check a ticket in; duplicates rejected
- "My tickets" and "Organizer dashboard" views
- Platform fee collected on every mint and resale
- Direct (non-program) transfers of ticket NFTs are rejected on-chain
- Paper experiments (section 9)

### Deferred / cut (do NOT build unless a TASK says so)
- Refundable stake/deposit anti-spam mechanism (decided earlier, deferred; forfeited stakes would go to the platform wallet)
- Websocket indexer (`onAccountChange`); use polling only
- `mongo-express`
- Wallet-signature auth (nonce flow). MVP backend trusts the pubkey in the request for read/metadata endpoints; **all real security is enforced on-chain**. Stretch only.
- Mainnet, fiat payments, secondary marketplaces, refunds, multi-tier tickets

---

## 3. Tech stack (fixed)

| Layer | Choice |
|---|---|
| Program | Rust + Anchor |
| NFT | Metaplex Token Metadata (CPI) |
| Network | Local validator (dev), Devnet (demo) |
| Frontend | Vite + React + TypeScript, **Tailwind CSS**, `@solana/web3.js`, `@solana/wallet-adapter` (Phantom), `qrcode.react`, a JS QR scanner lib. Free to add animation/graphics/icon libraries (e.g. framer-motion, GSAP, lucide-react) where they improve the UI; see the rule below. |
| Backend | Bun + Express + Mongoose + `@solana/web3.js` + `@coral-xyz/anchor` |
| DB | MongoDB 7 via root `docker-compose.yml` |
| Tests | `ts-mocha` in `tests/rents-ticketing.ts` (primary, since it needs the Metaplex program) |
| Lint | oxlint (frontend) |

**Frontend library rule:** agents may add UI libraries (animation, icons, graphics, 3D/shader backgrounds) without asking, provided each is (a) installed with `bun add`, (b) mentioned in `journal.md` with a one-line reason, (c) not breaking `bun run build`, and (d) not replacing Tailwind, wallet-adapter, or the API client. Prefer small, well-maintained packages.

**Version rule:** Task 0.2 records the exact installed versions (anchor, solana, rust, bun, node) and the exact `anchor-lang`, `anchor-spl`, `mpl-token-metadata` crate versions in `AGENTS.md`. Agents must never guess crate/API versions; check `Cargo.toml` and the crate docs.

---

## 4. Architecture

```
Browser (React + Phantom)
   │  1. GET data                      ┌───────────────┐
   ├──────────────────────────────────▶│ Backend (API) │──▶ MongoDB (metadata + ticket cache)
   │  2. POST "build tx"               │               │
   │◀──────── unsigned tx ─────────────│  tx builder   │
   │  3. sign in Phantom               └───────┬───────┘
   │  4. submit tx directly                    │ indexer polls chain
   ▼                                           ▼
Solana (rents-ticketing program + Metaplex)  ◀─┘
```

Rules:
- **Chain is the source of truth** for ownership, price, listing, check-in. Mongo `Ticket` is a cache.
- Backend never holds or signs with user keys. It builds **unsigned** txs; the frontend signs and submits.
- Event descriptive data (name, date, venue, image, description) lives only in Mongo. NFT metadata JSON is served by the backend at a public URL (`/api/metadata/:mint`) and referenced as the NFT URI.

---

## 5. On-chain program (`programs/rents-ticketing`)

All percentages are **basis points** (bps): 11000 = 110%, 500 = 5%. All money is `u64` lamports. Use `u128` for intermediate math and `checked_*` ops everywhere. No floats. Division floors.

### 5.1 Accounts (PDAs)

**PlatformConfig** (seeds: `["platform_config"]`): `admin: Pubkey`, `platform_wallet: Pubkey`, `platform_fee_bps: u16`, `bump`.
**[RESOLVED D3]** The platform wallet receives (a) the platform fee on every purchase and (b) later, any forfeited organizer stakes (deferred feature; not built now).
Fee rules: `fee = price * platform_fee_bps / 10000` (floor), charged to the **buyer on top of the price** at both mint and resale. It is never deducted from the organizer's or seller's proceeds and never affects the cap check (the cap applies to the ticket price only). Hard max `platform_fee_bps = 500` enforced on-chain (`InvalidFee`). **[D5] Default = 100 bps (1%)**, set at `initialize_platform_config`; the human can change it any time via `update_platform_fee`.
Files `initialize_platform_config.rs` and `update_platform_wallet.rs` already exist; extend them for the fee field and add `update_platform_fee.rs`. All admin instructions require `admin` as signer.

**TicketAuthority** (PDA, seeds: `["authority"]`, no data, signs via `invoke_signed`): the freeze authority and delegate for every ticket mint. This is what makes transfers "closed" (see 5.4).

**Event** (seeds: `["event", organizer, event_id.to_le_bytes()]`):
`organizer: Pubkey`, `event_id: u64`, `max_tickets: u32`, `tickets_sold: u32`, `base_price: u64`, `resale_cap_bps: u16` (default 11000), `royalty_bps: u16` (default 500), `bump`.
Validation: `resale_cap_bps >= 10000`, `royalty_bps <= 2000`, `max_tickets > 0`.

**Ticket** (seeds: `["ticket", mint]`):
`event: Pubkey`, `mint: Pubkey`, `ticket_number: u32`, `face_value: u64` (copy of event.base_price at mint; the cap always uses this), `is_used: bool`, `used_at: i64`, `listing_price: Option<u64>`, `resale_count: u16`, `bump`.

### 5.2 Instructions

**Admin:** `initialize_platform_config(platform_wallet, platform_fee_bps)`, `update_platform_wallet(new_wallet)`, `update_platform_fee(new_fee_bps)`.

1. **`initialize_event(event_id, max_tickets, base_price, resale_cap_bps, royalty_bps)`**: organizer signs; creates Event PDA.

2. **`mint_ticket(event_name , uri)`**: buyer signs and pays.
   - Checks `tickets_sold < max_tickets`.
   - Payments from buyer: `base_price` → organizer; `fee` → `platform_wallet`.
   - Creates the mint (decimals 0) with **freeze authority = TicketAuthority**, creates the buyer's ATA, mints exactly 1 token.
   - Creates Metaplex metadata via CPI (name `"<event> #<n>"`, symbol `RENTS`, `uri`, `seller_fee_basis_points` = event royalty bps, creator = organizer).
   - **Does NOT create a Master Edition** (creating one hands mint and freeze authority to the edition PDA, which would remove our freeze control).
   - **Revokes the mint authority** (set to None) so supply is permanently 1.
   - Buyer approves TicketAuthority as delegate (amount 1) on their token account.
   - **Freezes** the buyer's token account (TicketAuthority signs as freeze authority).
   - Creates the Ticket PDA; increments `tickets_sold`.

3. **`list_ticket(price)`**: current holder signs (must own the token account holding the 1 token). Checks: ticket not used; `0 < price <= face_value * resale_cap_bps / 10000`. Sets `listing_price = Some(price)`. No token movement (the account stays frozen). Calling again on a listed ticket updates the price.

4. **`cancel_listing()`**: holder signs; clears `listing_price`.

5. **`resell_ticket()`**: **buyer signs and pays**; ticket must be listed.
   - Checks: not used; `listing_price = Some(p)`; **re-checks `p <= cap` on-chain**; buyer != seller (`SelfPurchase`); seller token account holds the token and its owner is the seller.
   - Computes `royalty = p * royalty_bps / 10000`, `fee = p * platform_fee_bps / 10000`, `seller_proceeds = p - royalty`.
   - Buyer pays `p + fee` in total, split: `royalty` → organizer, `seller_proceeds` → seller, `fee` → platform wallet.
   - **Thaws** the seller's token account (TicketAuthority signs), transfers the token to the buyer's ATA (`init_if_needed`, buyer pays rent) using TicketAuthority as delegate, buyer approves TicketAuthority as delegate, **freezes** the buyer's account. The seller's now-empty account is left thawed so they can close it and reclaim rent.
   - Clears `listing_price`; `resale_count += 1`.
   - Atomic: if any step fails, nothing changes.

6. **`check_in_ticket()`**: organizer (the only authorized scanner in MVP) signs. Checks: ticket belongs to the event (`WrongEvent`), the presented holder owns the token account (`NotTicketHolder`), `is_used == false`. Sets `is_used = true`, `used_at = clock.unix_timestamp`. Duplicate → `TicketAlreadyUsed`. No token movement, so it works on the frozen account.

### 5.3 Errors (`error.rs`)
`SoldOut`, `PriceExceedsCap`, `InvalidBps`, `InvalidFee`, `InvalidPrice`, `NotListed`, `TicketAlreadyUsed`, `NotTicketHolder`, `NotEventOrganizer`, `NotAdmin`, `SelfPurchase`, `MathOverflow`, `WrongEvent`.

### 5.4 Design decisions
**[RESOLVED D1] Resale flow:** list → buy. `list_ticket` and `cancel_listing` are added (6 ticket instructions + 3 admin).

**[RESOLVED D2] Closed transfers:** the NFT may only move via `resell_ticket`. Mechanism: every ticket token account is **frozen** at all times except inside `resell_ticket`. SPL Token rejects transfer, approve, revoke, burn and close on a frozen account, so the holder cannot move, burn, or re-delegate the NFT by any route; only TicketAuthority (a PDA only this program can sign for) can thaw it. Required tests (Tasks 2.2 and 2.4) must prove a plain SPL `transfer` by the owner fails, a transfer by a third party fails, and the same holds for the buyer after a resale.
- Verify against the installed `anchor-spl` / `mpl-token-metadata` versions that metadata can be created without a Master Edition and that Phantom still displays the token with its image and name on devnet.
- **If the mechanism doesn't work** (Metaplex CPI rejects it, wallet doesn't render, etc.), stop and report. The fallback options are Metaplex pNFT with a rule set or Token-2022 with a transfer hook. The human decides; the agent must not switch on its own.

**[D4]** The metadata URI is passed as an argument to `mint_ticket` by default.

---

## 6. Backend (`apps/backend`)

### 6.1 Mongo models (already exist; verify, don't rewrite)
- **Event**: `onChainEventId`, `organizerPubkey`, `eventPda`, `name`, `description`, `venue`, `date`, `imageUrl`, `maxTickets`, `basePriceLamports`, `resaleCapBps`, `royaltyBps`
- **Ticket** (cache): `mintAddress`, `ticketPda`, `eventPda`, `ownerPubkey`, `faceValueLamports`, `listingPriceLamports?`, `isCheckedIn`, `checkedInAt`, `resaleCount`, `lastSyncedAt`
- **User**: `pubkey`, `isOrganizer`, `displayName`

Note: older code uses `%` fields (`resaleCapPercent`, `royaltyPercent`). Migrate to bps to match the chain (Task 3.1).

### 6.2 Endpoints
Read (exist): `GET /api/events`, `GET /api/events/:id`, `GET /api/events/organizer/:pubkey`, `GET /api/tickets/owner/:pubkey`, `GET /api/tickets/event/:eventId`, `GET /api/tickets/:mint`, `GET /api/tickets/listings` *(new, all active listings)*, `GET /api/platform` *(new: fee bps + platform wallet, read from chain)*
Write-metadata: `POST /api/events`, `PATCH /api/events/:id`
Metadata for NFT URI: `GET /api/metadata/:mint` → Metaplex-standard JSON
Tx builders (return base64 **unsigned** tx): `POST /api/tx/initialize-event`, `/api/tx/mint`, `/api/tx/list`, `/api/tx/cancel-listing`, `/api/tx/resell`, `/api/tx/check-in`
Verify: `POST /api/checkin/verify` → reads **chain first**, falls back to cache only on RPC failure
Route files currently under `/api/tickets/mint|resell` and `/api/checkin` (501 stubs) get replaced by the `/api/tx/*` routes.

### 6.3 Services
- `solanaTx.service.ts`: builds txs from the IDL
- `indexer.service.ts`: polls `program.account.ticket.all()` every ~10 s, upserts the Mongo cache; also exposes `syncTicket(mint)` for immediate refresh after a tx
- `metadata.service.ts`: builds the NFT metadata JSON

---

## 7. Frontend (`apps/frontend`)

Visual reference: `design/stitch_rents_web3_ticketing_platform/`. Each page folder has **both** `screen.png` (the visual target) and `code.html` (the implementation reference: exact layout, Tailwind classes, colour tokens, fonts, copy). Global style rules are in `solana_ticket_stub_system/DESIGN.md`.

**How agents use them:** open the `screen.png` and read the matching `code.html` before building each page. Port the HTML faithfully into React + Tailwind components: keep the structure, classes, spacing and copy; move any inline/CDN Tailwind config (colours, fonts, extend) into the project's Tailwind config once, and split repeated markup into shared components (navbar, footer, ticket card, buttons). Replace placeholder data with real data and hook up the real actions. If `code.html` and `screen.png` disagree, `screen.png` wins visually. Agents may add animations and graphics beyond the mockups where they improve the feel, as long as the layout stays recognisable.

| Page | Route | Design folder |
|---|---|---|
| Landing | `/` | `landing_page_rents` |
| Explore events | `/events` | `explore_events_rents` |
| Event details + Buy | `/events/:id` | `event_details_rents` |
| My Stubs (owned tickets + QR) | `/my-tickets` | `my_stubs_rents` |
| List for resale | `/my-tickets/:mint/resell` | `list_for_resale_rents` |
| Organizer dashboard + create event | `/organizer` | `organizer_dashboard_rents` |
| Scanner (no design exists) | `/organizer/scan` | none; keep it minimal and match DESIGN.md |

UX rules: show prices in SOL with 2-3 decimals (convert from lamports); never show raw pubkeys without truncation; wallet-connect only when an action needs it; friendly error messages mapped from program errors (e.g. `PriceExceedsCap` → "Max resale price is X SOL"); loading and tx-confirmation states on every action.

---

## 8. QR check-in

- QR content (JSON): `{ "mint": "<mint>", "owner": "<holder pubkey>" }`, rendered with `qrcode.react` on My Stubs.
- Scanner flow: scan → `POST /api/checkin/verify` (chain read: owner matches, event matches organizer, not used) → on OK, builds `check-in` tx → organizer signs in Phantom → tx confirms → UI shows ✅; a used ticket shows ❌ "Already used".
- Known limitation (document in paper): a screenshot of a QR can be shown by someone else. Stretch: QR includes a short-lived holder-signed timestamp.

---

## 9. Research experiments (`/experiments`)

Agents must **never invent numbers**. Every figure is either measured by a script or sourced with a citation the human can verify.

1. **Cost/speed comparison**
   - Solana: script runs each instruction N times on localnet/devnet and records fee (lamports → SOL → USD at a stated price), compute units, and confirmation time. Output CSV.
   - Ethereum: equivalent operations' gas must come from a cited source or the human supplies figures. Output a comparison table with an explicit "source" column.
2. **Scalping simulation** (Python or TS, seeded RNG, parameters in a config file)
   - N buyers, M tickets, a fraction of "scalper" agents who buy then relist at a markup chosen to maximize profit.
   - Scenario A: uncapped. Scenario B: capped at 110% + 5% royalty.
   - Metrics: scalper profit, average price paid by genuine buyers, % tickets held by scalpers, organizer revenue incl. royalties, platform fee revenue.
   - Output: CSV + charts (PNG) + a short README of parameters.

---

## 10. Definition of done (whole project)

- `anchor test` passes all program tests (happy paths + every error path above)
- Full demo on devnet: create event → buy (fee visible in platform wallet) → list at ≤110% → resale buy (royalty visible in organizer balance) → list at >110% rejected → check-in → second check-in rejected
- A plain SPL transfer of a ticket NFT, by the holder or anyone else, is rejected by the chain
- Frontend usable end-to-end with Phantom on devnet
- `/experiments` produce CSVs and charts reproducibly with one command each
