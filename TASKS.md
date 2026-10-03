# TASKS.md

**Status legend:** `TODO` not started · `VERIFY` files exist, but correctness unknown → read/test them, fix or mark DONE · `DONE` verified · `BLOCKED` waiting on human

**Rules:** one task per session · do tasks in order unless dependencies allow otherwise · each task ends with verification output pasted · see `AGENTS.md` §1.

**Human precondition:** before Task 0.1, create a known-good Git checkpoint and a dedicated `ai-build` branch or worktree. Never run two agents against the same working tree. After each green task, the human reviews the diff and creates the commit.


Existing scaffolding (from the folder tree) is marked `VERIFY`, not `DONE`, because its contents have not been audited.

---

## Phase 0: Audit and environment *(Opus 4.6)*

### 0.1 `DONE`: Repo audit (read-only, no code changes)
- **Do:** Read every file under `programs/`, `tests/`, `apps/backend/src`, `apps/frontend/src`, `packages/shared`, `Anchor.toml`, `Cargo.toml`, `docker-compose.yml`, root `package.json`, `journal.md`. For each file report: empty / stub / partial / complete, and anything that contradicts `SPEC.md`.
- **Output:** a table appended to `journal.md`. Pay special attention to `initialize_platform_config.rs`, `update_platform_wallet.rs` and `state.rs` (what do they actually do vs SPEC §5.1? D3 is resolved: platform fee + future forfeited stakes), and the `%` vs `bps` fields in the Mongo models.
- **Done when:** the report exists. **Update the statuses below based on the findings** (e.g. flip `VERIFY` to `DONE` or `TODO`).

### 0.2 `DONE`: Toolchain and commands check
- **Do:** Run and record versions: `rustc -V`, `solana -V`, `anchor -V`, `bun -v`, `node -v`, `docker -v`. Read `Cargo.toml` for anchor-lang / anchor-spl / mpl-token-metadata versions. Try each command in `AGENTS.md` §5 and correct the table where reality differs. Fill in `AGENTS.md` §4.
- **Done when:** `anchor build` succeeds on the current code (or the failures are listed), `docker compose up -d` brings up Mongo, and §4 has no `TBD`.
- **Depends on:** 0.1

### 0.3 `DONE`: Configure Metaplex on the local test validator
- **Do:** Make `anchor test` start a validator with the Metaplex Token Metadata program available (via `[test.validator]` `[[test.genesis]]` using a dumped `.so`, or `[[test.validator.clone]]` from devnet; pick whichever works and document it).
- **Done when:** a trivial test can read the Metaplex program account (`getAccountInfo` is executable).
- **Depends on:** 0.2

---

## Phase 1: Program state and event creation *(Opus 4.6)*

### 1.1 `DONE`: Platform config instructions (with fee)
- **Do:** Review `initialize_platform_config.rs` / `update_platform_wallet.rs` against SPEC §5.1. Add `platform_fee_bps` to the PlatformConfig state and to `initialize_platform_config`; add `update_platform_fee.rs` (admin only, max 500 bps → `InvalidFee`). Register all in `instructions.rs` / `lib.rs`. Don't wire the fee into mint/resell yet (that is Tasks 2.1/2.4).
- **Tests:** init succeeds with fee 100; init with fee 501 fails `InvalidFee`; double-init fails; non-admin `update_platform_wallet` and `update_platform_fee` fail `NotAdmin`; admin updates succeed and are readable.
- **Done when:** these tests pass under `anchor test`.
- 
### 1.2 `DONE`: State, errors, constants
- **Do:** Align `state.rs`, `error.rs`, `constants.rs` with SPEC §5.1 and §5.3 (Event, Ticket structs with `InitSpace`; all error variants; seed constants; bps constants).
- **Done when:** `anchor build` is green; no unused-field warnings left unexplained.
- **Depends on:** 0.2

### 1.3 `DONE`: `initialize_event`
- **Do:** Implement / fix per SPEC §5.2.1 with validation (`resale_cap_bps >= 10000`, `royalty_bps <= 2000`, `max_tickets > 0`).
- **Tests (in `tests/rents-ticketing.ts`):** valid event created and fields stored; defaults honoured when 11000/500 passed; invalid bps rejected (`InvalidBps`); zero tickets rejected; same organizer+event_id twice fails.
- **Done when:** all pass.
- **Depends on:** 1.2

---

## Phase 2: Core ticket lifecycle *(Opus 4.6)*

> This phase is the critical path. One instruction per session. Commit after each.

### 2.1 `DONE`: `mint_ticket` part 1: payments and counters (no Metaplex yet)
- **Do:** Implement the payments (buyer → organizer `base_price`; buyer → platform wallet `fee`, read from PlatformConfig), `tickets_sold` increment with the `SoldOut` check, Ticket PDA creation (`face_value` copy, `ticket_number`). Use a plain SPL mint (decimals 0) with the ATA and mint-1 flow; no metadata, no freeze yet.
- **Tests:** organizer balance rises by exactly `base_price`; platform wallet by exactly `base_price * fee_bps / 10000`; buyer is debited price + fee (+ rent); Ticket PDA correct; selling past `max_tickets` fails `SoldOut`; wrong organizer/platform-wallet accounts fail.
- **Depends on:** 1.1, 1.3

### 2.2 `DONE`: `mint_ticket` part 2: Metaplex metadata, authority lockdown, freeze
- **Do:** Accept the off-chain event name and URI in `mint_ticket(event_name, uri)`; add, in this order: Metaplex metadata CPI (SPEC §5.2.2); mint authority → None; buyer approves TicketAuthority as delegate; freeze the buyer's token account with TicketAuthority. Mint is created with freeze authority = TicketAuthority from the start. Keep the Event account layout unchanged. **No Master Edition.** Match the installed `mpl-token-metadata` API. The metadata JSON endpoint is Task 3.7.
- **Tests:** metadata decodes with correct name/symbol/URI/royalty bps; mint supply 1, mint authority None, freeze authority = TicketAuthority PDA; token account state is Frozen; **direct SPL `transfer` by the owner fails**; transfer by an unrelated signer fails; owner `revoke`/`approve`/`burn`/`close_account` all fail.
- **Also check and report:** that metadata creation works without a Master Edition on this version (SPEC §5.4 D2). If it doesn't, STOP and report; don't pick a fallback.
- **Depends on:** 2.1, 0.3

### 2.3 `DONE`: `list_ticket` + `cancel_listing`
- **Do:** Implement per SPEC §5.2.3-4 (price/cap/ownership checks only; no token movement).
- **Tests:** list at ≤ cap works; list at exactly cap works; list at cap+1 lamport fails `PriceExceedsCap`; price 0 fails `InvalidPrice`; non-holder fails `NotTicketHolder`; used ticket cannot be listed; relisting updates the price; cancel clears the listing; cancel by a non-holder fails.
- **Depends on:** 2.2

### 2.4 `DONE`: `resell_ticket`: cap, royalty, platform fee, locked transfer
- **Do:** Implement per SPEC §5.2.5 with all arithmetic via `u128` + `checked_*`. Thaw → transfer via delegate → buyer approves delegate → freeze buyer.
- **Tests (the paper-critical set):**
  - face 1 SOL, cap 110%, royalty 5%, fee 1%, listing at 1.10 SOL → buyer pays exactly 1.111; organizer gets exactly 0.055; seller gets exactly 1.045; platform wallet gets exactly 0.011; NFT owned by the buyer
  - after the resale the buyer's account is **frozen**; a direct SPL transfer by the buyer fails; the seller's old account is empty and can be closed
  - resale below face value works, with royalty and fee on the lower price
  - resale above cap is impossible (`list_ticket` rejects it; a direct-manipulation attempt on `resell` fails `PriceExceedsCap`)
  - not listed → `NotListed`; used ticket → `TicketAlreadyUsed`; self-purchase → `SelfPurchase`
  - `resale_count` increments; listing cleared; the new owner can list again and resell again (two-hop chain)
  - buyer with insufficient funds → clean failure, no state change
  - rounding: pick a price where `p*royalty_bps/10000` has a remainder; assert `royalty + seller_proceeds == p` exactly
- **Depends on:** 2.3

### 2.5 `DONE`: `check_in_ticket`
- **Do:** Implement per SPEC §5.2.6.
- **Tests:** organizer check-in succeeds on the frozen account and sets `is_used`/`used_at`; second check-in fails `TicketAlreadyUsed`; non-organizer signer fails `NotEventOrganizer`; ticket from a different event fails `WrongEvent`; wrong presented holder fails `NotTicketHolder`; a resold ticket can be checked in under its new owner.
- **Depends on:** 2.2

### 2.6 `DONE`: Program hardening pass
- **Do:** Review every instruction's account constraints: signer checks, PDA seed/bump validation, owner checks, missing `has_one`. Specifically confirm no instruction lets a caller make TicketAuthority sign for an unrelated mint or token account, and that thaw only happens inside `resell_ticket`. List findings; fix only clear bugs; add a regression test per fix.
- **Done when:** `anchor test` fully green; findings written to `journal.md`.
- **Depends on:** 2.4, 2.5

### 2.7 `DONE`: Deploy to devnet + export IDL
- **Do:** Set cluster in `Anchor.toml`, deploy (human provides funded keypair; agent never touches key material), copy IDL + types to `packages/shared/idl/` and `packages/shared/src/`. Record the program ID in `journal.md` and env examples.
- **Done when:** the program ID resolves on devnet; IDL file exists in `packages/shared`.
- **Depends on:** 2.6
- **Milestone: the program interface is frozen. Backend and frontend may now be developed in parallel only in separate Git worktrees/branches. Otherwise keep the sessions sequential.**

---

## Phase 3: Backend foundation *(Sonnet 4.6)*

### 3.1 `DONE`: Models migrated to SPEC
- **Do:** Update `Event`, `Ticket`, `User` models to SPEC §6.1 (bps fields, `eventPda`, `ticketPda`, listing fields). Update controllers that referenced old field names.
- **Done when:** `bunx tsc --noEmit` clean; backend boots and connects to Mongo; a quick script/cURL creates and reads an Event.
- **Verified:** `bunx tsc --noEmit -p apps/backend`; backend connected to Mongo and started on port 4000; local create/read smoke test returned 201/200 with bps fields and no legacy percentage fields.

### 3.2 `TODO`: `config/solana.ts`
- **Do:** Connection from env (`SOLANA_RPC_URL`), program ID from env, Anchor `Program` instance from the IDL in `packages/shared`. Add `.env.example`.
- **Done when:** a smoke script fetches an Event or the program account without error.
- **Depends on:** 2.7

### 3.3 `TODO`: Wire `packages/shared` into backend and frontend
- **Do:** Export IDL, generated types, and shared API DTO types (Event, Ticket, request/response shapes). Configure workspace imports so both apps import from `@rents/shared` (or whatever the package name is).
- **Done when:** both apps typecheck while importing a shared type.

### 3.4 `TODO`: `solanaTx.service.ts`: `initialize-event` and `mint` builders
- **Do:** Build base64 **unsigned** txs with the correct accounts (derive PDAs, include PlatformConfig and the platform wallet). For `mint`, the client generates the fresh mint keypair and sends its public key to the backend; the backend uses that public key when constructing the transaction, and the frontend/script adds the mint-keypair signature plus the user's wallet signature before submission. The backend must never sign the transaction. Routes `POST /api/tx/initialize-event`, `/api/tx/mint`.
- **Done when:** a script takes the returned unsigned tx, signs it with the test wallet(s) plus the fresh mint keypair where required, sends to localnet/devnet, and confirms; the ticket exists on-chain.
- **Depends on:** 3.2

### 3.5 `TODO`: Builders for `list`, `cancel-listing`, `resell`, `check-in`
- **Do:** Same pattern as 3.4. Replace the old 501 stubs and route names.
- **Done when:** an end-to-end script (separate keypairs for organizer / seller / buyer) runs create → mint → list → resell → check-in through the API builders and succeeds.
- **Depends on:** 3.4

### 3.6 `TODO`: Indexer (polling)
- **Do:** `indexer.service.ts`: on an interval, `program.account.ticket.all()` + event accounts → upsert Mongo. Add `syncTicket(mint)` and `POST /api/tickets/:mint/sync`. Start the indexer from `index.ts` behind an env flag. Add `GET /api/tickets/listings`.
- **Done when:** after the 3.5 script, Mongo reflects the correct owner, listing, and `isCheckedIn` without manual edits.
- **Depends on:** 3.5

### 3.7 `TODO`: Metadata endpoint
- **Do:** `GET /api/metadata/:mint` returns Metaplex-standard JSON (name, symbol, description, image, attributes: event, venue, date, ticket #). `metadata.service.ts` builds it from Event + Ticket.
- **Done when:** a minted ticket's URI resolves and the JSON validates against the standard fields.
- **Depends on:** 3.1

### 3.8 `TODO`: `/api/checkin/verify` reads the chain first
- **Do:** Per SPEC §6.2/§8: fetch Ticket + token account owner from chain; compare to QR payload; cache only on RPC failure.
- **Done when:** manual tests: valid ticket OK; used ticket rejected; wrong event rejected; spoofed owner rejected.
- **Depends on:** 3.6

### 3.9 `TODO`: `GET /api/platform`
- **Do:** Read PlatformConfig from chain and return `{ platformFeeBps, platformWallet }` (short in-memory cache OK). The frontend uses it to show the fee as a separate line before purchase.
- **Done when:** the endpoint returns the on-chain values after a fee update.
- **Depends on:** 3.2

---

## Phase 4: Backend hardening (small) *(Sonnet 4.6)*

### 4.1 `TODO`: Input validation and error shape
- **Do:** Validate pubkeys / ids / numeric strings on every route (e.g. `zod` if already present, else minimal manual validation). Consistent JSON error shape through `errorHandler.ts`. CORS for the frontend origin.
- **Done when:** malformed inputs return 400 with a clear message, with a few cURL examples pasted.

### 4.2 `STRETCH`: `validateWallet.ts` (wallet-signature auth)
- Only if time remains **and** the human asks. Do not start otherwise.

---

## Phase 5: Frontend *(Gemini 3.1 Pro; Sonnet 4.6 for logic-heavy tasks)*

> **Design rule for every page task:** open the matching `screen.png` **and** read the matching `code.html` before writing code (SPEC §7). Port the HTML into React + Tailwind components faithfully (structure, classes, tokens, copy); wire in real data and actions. Extra animations/graphics libraries are allowed per the SPEC §3 frontend library rule.

### 5.1 `TODO`: App shell and Tailwind setup
- **Do:** Install and configure Tailwind CSS. Read all six `code.html` files and `DESIGN.md`; consolidate their Tailwind config (colours, fonts, radii, shadows) into the project Tailwind config and fonts/icon setup in one place. Build shared layout (navbar, footer), router, `WalletProvider` + wallet button (Phantom), env config (API URL / RPC / program ID), typed API client in `src/lib/api.ts`.
- **Done when:** app runs, navigation works between placeholder pages that already use the shared layout, Phantom connects on devnet, lint, typecheck and `bun run build` are clean.

### 5.2 `TODO`: Transaction helper
- **Do:** `useSendBuilderTx()` hook: calls a `/api/tx/*` endpoint, deserializes the tx, signs with the wallet adapter, sends, confirms, calls the sync endpoint, and maps errors (including program error codes) to friendly messages. Toast/loader state.
- **Done when:** a throwaway button successfully completes a mint on devnet.
- **Depends on:** 3.4

### 5.3 `TODO`: Landing + Explore Events
- **Design:** `landing_page_rents`, `explore_events_rents`. Data from `GET /api/events`. Loading/empty/error states.

### 5.4 `TODO`: Event Details + Buy
- **Design:** `event_details_rents`. Buy button → 5.2 hook; shows remaining tickets, price in SOL with the platform fee as a separate line (from `/api/platform`), resale-cap/royalty explainer; list of active resale listings for this event with Buy buttons (calls `resell`).
- **Depends on:** 5.2, 3.5, 3.6

### 5.5 `TODO`: My Stubs + QR
- **Design:** `my_stubs_rents`. Tickets from `/api/tickets/owner/:pubkey`; QR per SPEC §8 via `qrcode.react`; status chips (valid / listed / used).

### 5.6 `TODO`: List for Resale
- **Design:** `list_for_resale_rents`. Price input with live cap calculation ("max X SOL"), disabled submit above cap, royalty/proceeds preview; cancel listing action.
- **Depends on:** 5.5

### 5.7 `TODO`: Organizer Dashboard + Create Event
- **Design:** `organizer_dashboard_rents`. Create-event form → `POST /api/events` (metadata) + `initialize-event` tx (order and failure handling documented: no orphan Mongo rows if the chain tx fails); dashboard stats (tickets sold, revenue, royalties earned from resales).

### 5.8 `TODO`: Scanner page
- **No design.** Camera QR scan → verify API → show result → organizer-signs check-in tx. Large clear ✅/❌ states.
- **Depends on:** 3.8

### 5.9 `TODO`: Frontend polish pass
- **Do:** responsive check at mobile width, empty states, consistent loading, remove debug UI. No new features.

---

## Phase 6: Integration and demo *(you + Sonnet 4.6)*

### 6.1 `TODO`: Devnet end-to-end rehearsal
- **Do:** follow SPEC §10 demo script with three real Phantom wallets. Write every bug found to `journal.md`; fix in separate small tasks.

### 6.2 `TODO`: Seed script
- **Do:** `scripts/seed.ts` creates 2-3 demo events with metadata/images so the demo isn't empty.

### 6.3 `TODO`: README
- **Do:** root `README.md`: what it is, setup steps, env vars, commands, demo script, known limitations (QR screenshot and any D2 caveat that is actually confirmed by tests/documented behavior). Do not describe direct transfer as a bypass if the chain tests prove it is rejected.

---

## Phase 7: Paper experiments *(Sonnet 4.6)*

### 7.1 `TODO`: Solana cost/speed measurement script
- **Do:** `experiments/solana-costs/`: run each instruction N times (N=30 default), record fee, compute units, confirmation latency. Output `results.csv` + summary table (mean / median / p95).
- **Done when:** one command reproduces the CSV.
- **Depends on:** 2.7

### 7.2 `TODO`: Ethereum comparison table
- **Do:** produce a table template with columns operation / Solana measured / Ethereum figure / **source**. Fill Ethereum figures **only** from sources the human provides or from cited public data; otherwise leave `TBD (needs source)`. Never estimate silently.

### 7.3 `TODO`: Scalping simulation
- **Do:** `experiments/scalping-sim/` per SPEC §9.2: seeded, parameterised via a config file, both scenarios, CSV + PNG charts, README with parameters.
- **Done when:** one command reproduces identical outputs for the same seed.

### 7.4 `TODO`: Align the simulation with the real contract
- **Do:** confirm the simulation's cap and royalty logic matches the on-chain math (same bps, same rounding); add a test or a doc note linking to the program tests from 2.4.
- **Depends on:** 7.3, 2.4

---

## Human milestone gates

These are deliberate stop points. The agent stops after the task; the human reviews and commits before the next task/session.

- **Gate A — after 0.3:** the repository/toolchain audit is trustworthy and Metaplex is available to tests.
- **Gate B — after 2.6:** the on-chain ticket lifecycle is green, including closed-transfer regression tests. Do not start backend/frontend integration against a moving contract.
- **Gate C — after 3.9:** backend reads and all required transaction builders have a verified contract interface.
- **Gate D — after 5.8:** the complete demo path works through Phantom on devnet.
- **Gate E — after 6.1:** record the demo as the MVP release candidate. Phase 7 experiments can proceed afterward without destabilising the demo.

At each gate, the human should inspect `git diff`, run the relevant top-level smoke check, and commit a known-good state.

---

## Suggested one-day rhythm

| Block | Tasks |
|---|---|
| Hour 0-1 | 0.1 → 0.3 |
| Hours 1-5 | 1.x, 2.1 → 2.7 (Opus, strictly sequential) |
| Hours 5-9 | Two parallel sessions: backend (3.x, 4.1) and frontend shell (5.1, 5.3, 5.5 design-only parts) |
| Hours 9-12 | 5.2, 5.4, 5.6, 5.7, 5.8 |
| Hours 12-14 | 6.x, 7.x in parallel if you have a second session free |

If you fall behind, protect the demo critical path first: 0.1-0.3 → 1.x → 2.1-2.6 → 3.1-3.9 → 5.1-5.8 → 6.1. Defer 4.1 extras, 5.9, 3.8's cache fallback, 6.2, and Phase 7 until the end. Do not weaken or delete the paper-critical contract tests in 2.4 to save time.
