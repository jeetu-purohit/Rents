# AGENTS.md: Operating rules for coding agents on RENTS

Read this file fully at the start of **every** session. Then read `SPEC.md` and `TASKS.md`. Do not start work before you have.

---

## 1. Session protocol (follow exactly)

1. Read `AGENTS.md`, `SPEC.md`, `TASKS.md`, and the last entries of `journal.md`.
2. Work on **exactly one task**: the one the human names, or if none is named, the first task in `TASKS.md` with status `TODO` or `VERIFY` whose dependencies are `DONE`.
3. State the task ID and a 3-5 line plan **before** writing code.
4. Implement only what the task lists. Touch only the files the task lists (new helper files are fine if they are essential; mention them).
5. Run the task's **verification commands** and paste the real output. Never claim success without it.
6. If green: update the task's status in `TASKS.md` to `DONE`, append a short entry to `journal.md`, and suggest a git commit message.
7. **Stop.** Do not begin the next task. Wait for the human.

If a verification fails, fix it within the task's scope. If you cannot after 3 honest attempts, stop and report: what you tried, the error, and your hypothesis. Do not thrash, and do not weaken tests to make them pass.

### Human safety gates
- Before the first agent session, the human should create a known-good Git checkpoint and a dedicated `ai-build` branch or worktree for agent changes.
- At the start of every session, inspect `git status` and do not discard, overwrite, reset, rebase, or stash uncommitted human work.
- The agent must never use `git reset --hard`, `git checkout --`, `git clean`, force-push, or equivalent rollback/destructive Git operations without explicit human approval.
- After a task passes, stop and let the human review the diff and create the commit. The agent may suggest the commit message but should not commit unless the human explicitly delegates that.
- Never run two agents against the same working tree at the same time. Parallel work is allowed only in separate Git worktrees/branches and must be reconciled by the human.

---

## 2. Hard rules

- **Never edit `SPEC.md`** or `AGENTS.md`. If either is wrong, ambiguous, or conflicts with reality, stop and ask the human.
- **`TASKS.md` is controlled workflow state.** Only update it for the current task's status/verification, or when the current task explicitly requires a task-plan correction; never reorder, delete, or mark unrelated tasks.
- **Never decide a `[OPEN Dn]` item.** Use the stated default or ask.
- **No scope creep.** No refactors, renames, dependency swaps, or "while I'm here" improvements outside the current task.
- **Task boundary is strict.** Before coding, identify the acceptance criteria and intended files. If implementation requires unrelated modules or a larger architectural change, stop and report the dependency instead of broadening scope.
- **Record unrelated improvements instead of implementing them.** Put useful but out-of-scope cleanup/refactor ideas in `journal.md` or `IMPROVEMENTS.md` and leave the code alone.
- **Do not fabricate APIs, crate versions, function signatures, or numbers.** Check `Cargo.toml`, `node_modules`, installed type definitions, or official docs. If you are unsure whether something exists, verify it before using it. For Anchor/Metaplex specifically, anchor-lang, anchor-spl and mpl-token-metadata have breaking changes between versions: match the versions in `Cargo.toml`.
- **Do not weaken security checks** (signer, ownership, PDA seeds, cap, royalty) to get a test to pass.
- **Ticket NFTs must stay frozen.** Never create a Metaplex Master Edition for ticket mints, never give any key other than TicketAuthority the freeze or mint authority, and never add a code path that transfers a ticket outside `resell_ticket`.
- **Existing code is not trusted.** Some files were written by the human and some were generated earlier; they may be incomplete or wrong. Read before building on top of them. Do not delete or rewrite working code unless the task says so.
- **No secrets in the repo.** Keypairs go in gitignored paths. Never commit `.env` or wallet JSON.
- **Do not run destructive commands** (`rm -rf`, `git reset --hard`, dropping the DB, `docker volume rm`) without explicit human approval.
- **Small diffs.** Prefer many small, reviewable changes over one big one. If a task is turning out to need >~300 lines of new code, stop and propose splitting it.

---

## 3. Repo map

```
Anchor.toml                      workspace + localnet/test validator config
programs/rents-ticketing/src/    lib.rs, state.rs, error.rs, constants.rs, instructions/*
tests/rents-ticketing.ts         ts-mocha integration tests (primary)
programs/rents-ticketing/tests/  litesvm Rust test (optional; secondary)
packages/shared/                 IDL copy + shared TS types
apps/backend/src/                config/ models/ routes/ controllers/ services/ middleware/ types/
apps/frontend/src/               Vite + React app
design/stitch_.../               UI reference (code.html + screen.png per page, DESIGN.md)
experiments/                     paper scripts (created in Phase 7)
docker-compose.yml               local MongoDB
journal.md                       running log of work done
```

## 4. Environment facts

Filled in by Task 0.2 (the agent records real values; the human verifies):

- OS / shell: `TBD`
- Rust: `TBD`  ·  Solana CLI: `TBD`  ·  Anchor CLI: `TBD`
- anchor-lang: `TBD`  ·  anchor-spl: `TBD`  ·  mpl-token-metadata: `TBD`
- Bun: `TBD`  ·  Node: `TBD`
- Package manager: Bun (`bun install`, `bun run`)

## 5. Commands (confirm in Task 0.2; correct this list if reality differs)

| Purpose | Command |
|---|---|
| Build program | `anchor build` |
| Program tests | `anchor test` |
| Start Mongo | `docker compose up -d` |
| Backend dev | `bun run --cwd apps/backend dev` |
| Frontend dev | `bun run --cwd apps/frontend dev` |
| Everything | `bun run dev` (root, `concurrently`) |
| Typecheck backend | `bunx tsc --noEmit -p apps/backend` |
| Typecheck frontend | `bunx tsc --noEmit -p apps/frontend/tsconfig.app.json` |
| Lint frontend | `bunx oxlint apps/frontend/src` |

## 6. Conventions

**Rust / Anchor**
- One instruction per file in `instructions/`; account validation via `#[derive(Accounts)]` with explicit `seeds`, `bump`, `has_one`/`constraint` checks.
- Money: `u64` lamports; bps: `u16`; intermediate math in `u128`; `checked_*` always; return `MathOverflow` on failure.
- Every failure mode has a named error in `error.rs`; every error is covered by at least one test.
- Don't leave `unwrap()`/`expect()` in program code.

**TypeScript**
- Strict mode; no `any` unless commented why. Prefer `unknown` + narrowing.
- Backend: controllers are thin; Solana/Anchor logic lives in `services/`. Errors go through `errorHandler.ts`.
- Backend never signs with user keys. Tx builders return base64 **unsigned** transactions with a fresh blockhash and the correct fee payer.
- Lamports are `bigint` or string in JSON, never JS `number` for large values. Convert to SOL only in the UI.
- The IDL is generated by `anchor build`. Copy it to `packages/shared/idl/`; never hand-edit it.

**Frontend**
- Styling is **Tailwind CSS**. For every page, read both `screen.png` and `code.html` in its `design/` folder and port the HTML faithfully (structure, classes, tokens, copy) into React components; shared tokens live in the Tailwind config, not scattered inline. `DESIGN.md` has the global rules.
- You may add animation/graphics/icon libraries (framer-motion, GSAP, lucide-react, etc.) via `bun add`; log each in `journal.md` with a reason, and keep `bun run build` green.
- Show friendly errors: map program error codes to human messages.

**Tests**
- Tests assert behaviour, including failure paths with the specific error code. No test may be deleted or skipped to get a green run.
- **A green build is not sufficient for completion.** The task is DONE only when every acceptance criterion in `TASKS.md` has been verified and the required verification output is recorded.
- **Do not mark downstream tasks DONE because an upstream task appears to work.** Verify each task independently.
- **Do not silently reinterpret the spec.** If code, task instructions, and `SPEC.md` cannot all be satisfied consistently, stop before making a broad architectural choice and report the exact conflict.

## 7. Reporting format (end of every task)

```
TASK: <id> <title>
STATUS: DONE | BLOCKED | PARTIAL
CHANGED: <files>
VERIFIED: <command(s)> → <pasted output summary>
NOTES/RISKS: <anything the human must know, incl. spec conflicts or assumptions>
SUGGESTED COMMIT: <message>
```

## 8. Model-use guidance (for the human)

- **Opus 4.6:** Phase 0 audit, Phase 1-2 (Anchor program, Metaplex CPI, royalty math), security-sensitive debugging, and stubborn cross-module/chain failures.
- **Sonnet 4.6:** Phases 3-4 and 7, plus routine implementation, tests, CRUD, API work, and straightforward frontend logic.
- **Gemini 3.1 Pro:** Phase 5 visual/frontend work where the design references are the main source of truth; use Sonnet when the task becomes logic-heavy.
- **Hermes:** fallback agent when Antigravity quota or availability becomes a blocker; it still obeys this file and works one task at a time.
- Start a **fresh session per task or per small group of tightly coupled tasks**; long sessions drift. The three docs + `journal.md` carry the context.
