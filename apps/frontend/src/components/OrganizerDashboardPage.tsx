import { BN, BorshInstructionCoder, Program, type Idl, type Provider } from "@coral-xyz/anchor";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { CreateEventRequest, EventDto, RentsTicketing } from "shared";
import sharedIdlJson from "shared/idl/rents_ticketing.json";
import { useSendBuilderTx } from "../hooks/useSendBuilderTx";
import { ApiError, api } from "../lib/api";
import { frontendConfig } from "../lib/config";

type ChainEvent = {
  organizer: PublicKey;
  eventId: BN;
  maxTickets: number;
  ticketsSold: number;
  basePrice: BN;
  resaleCapBps: number;
  royaltyBps: number;
};
type ChainTicket = {
  publicKey: PublicKey;
  account: {
    event: PublicKey;
    mint: PublicKey;
    ticketNumber: number;
    faceValue: BN;
    isUsed: boolean;
    usedAt: BN;
    listingPrice: BN | null;
    resaleCount: number;
  };
};
type OrganizerEvent = {
  metadata: EventDto;
  chain: ChainEvent;
  tickets: ChainTicket[];
  primaryRevenue: bigint;
  royalties: bigint;
};
type DashboardState =
  | { status: "disconnected" }
  | { status: "loading"; owner: string }
  | { status: "error"; owner: string; message: string }
  | { status: "ready"; owner: string; events: OrganizerEvent[] };
type Draft = {
  name: string;
  description: string;
  venue: string;
  date: string;
  imageUrl: string;
  maxTickets: string;
  basePriceSol: string;
  resaleCapBps: string;
  royaltyBps: string;
};
type PendingMetadata = { eventPda: string; eventId: string; request: CreateEventRequest };

const configuredIdl: Idl = {
  ...(sharedIdlJson as Idl),
  address: frontendConfig.programId.toBase58(),
};
const instructionCoder = new BorshInstructionCoder(configuredIdl);
const U64_MAX = 18_446_744_073_709_551_615n;
const LAMPORTS = 1_000_000_000n;
const emptyDraft: Draft = {
  name: "",
  description: "",
  venue: "",
  date: "",
  imageUrl: "",
  maxTickets: "",
  basePriceSol: "",
  resaleCapBps: "11000",
  royaltyBps: "500",
};

function formatSol(value: bigint): string {
  const whole = value / LAMPORTS;
  const fraction = (value % LAMPORTS).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} SOL`;
}
function parseSol(value: string): bigint | undefined {
  const match = value.trim().match(/^(\d+)(?:\.(\d{0,9}))?$/);
  if (!match) return undefined;
  const amount = BigInt(match[1]) * LAMPORTS + BigInt((match[2] ?? "").padEnd(9, "0") || "0");
  return amount > 0n && amount <= U64_MAX ? amount : undefined;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

async function currentHolderForMint(
  connection: ReturnType<typeof useConnection>["connection"],
  mint: PublicKey,
): Promise<string | null> {
  // Every RENTS ticket mint has supply 1. The token account holding that unit
  // identifies the current holder, including after an on-chain resale.
  const largestAccounts = await connection.getTokenLargestAccounts(mint, "confirmed");
  const holderTokenAccount = largestAccounts.value.find((account) => account.amount === "1");
  if (!holderTokenAccount) return null;

  const tokenAccountInfo = await connection.getParsedAccountInfo(
    holderTokenAccount.address,
    "confirmed",
  );
  const data = tokenAccountInfo.value?.data as unknown as
    | { parsed?: { info?: { owner?: unknown } } }
    | undefined;
  const ownerAddress = data?.parsed?.info?.owner;
  return typeof ownerAddress === "string" ? ownerAddress : null;
}
function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? `${error.message} (${error.code})`
    : error instanceof Error
      ? error.message
      : "The request could not be completed.";
}
function sameMetadata(left: EventDto, right: CreateEventRequest): boolean {
  return (
    left.eventPda === right.eventPda &&
    left.onChainEventId === right.onChainEventId &&
    left.organizerPubkey === right.organizerPubkey &&
    left.name === right.name &&
    left.description === right.description &&
    left.venue === right.venue &&
    new Date(left.date).toISOString() === right.date &&
    (left.imageUrl ?? "") === (right.imageUrl ?? "") &&
    left.maxTickets === right.maxTickets &&
    left.basePriceLamports === right.basePriceLamports &&
    left.resaleCapBps === right.resaleCapBps &&
    left.royaltyBps === right.royaltyBps
  );
}
function transferLamports(instruction: unknown): bigint | undefined {
  if (typeof instruction !== "object" || instruction === null || !("parsed" in instruction))
    return undefined;
  const parsed = instruction.parsed;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("type" in parsed) ||
    parsed.type !== "transfer" ||
    !("info" in parsed)
  )
    return undefined;
  const info = parsed.info;
  if (
    typeof info !== "object" ||
    info === null ||
    !("destination" in info) ||
    typeof info.destination !== "string" ||
    !("lamports" in info)
  )
    return undefined;
  const amount = info.lamports;
  if (typeof amount === "string" && /^\d+$/.test(amount)) return BigInt(amount);
  if (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0)
    return BigInt(amount);
  return undefined;
}

async function royaltiesForEvent(
  connection: ReturnType<typeof useConnection>["connection"],
  eventPda: string,
  organizer: string,
  expectedResales: number,
  royaltyBps: number,
): Promise<bigint> {
  if (expectedResales === 0 || royaltyBps === 0) return 0n;
  let total = 0n;
  let found = 0;
  let before: string | undefined;
  const eventKey = new PublicKey(eventPda);
  while (found < expectedResales) {
    const page = await connection.getSignaturesForAddress(
      eventKey,
      { limit: 1000, ...(before ? { before } : {}) },
      "confirmed",
    );
    if (!page.length) break;
    const signatures = page.filter((item) => item.err === null).map((item) => item.signature);
    for (let offset = 0; offset < signatures.length; offset += 8) {
      const transactions = await Promise.all(
        signatures
          .slice(offset, offset + 8)
          .map((signature) =>
            connection.getParsedTransaction(signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            }),
          ),
      );
      for (const transaction of transactions) {
        if (!transaction?.meta || transaction.meta.err) continue;
        const instructions = transaction.transaction.message.instructions;
        for (const [index, instruction] of instructions.entries()) {
          if (
            !("data" in instruction) ||
            !("accounts" in instruction) ||
            !instruction.programId.equals(frontendConfig.programId)
          )
            continue;
          if (
            instructionCoder.decode(instruction.data, "base58")?.name !== "resell_ticket" ||
            !instruction.accounts[1]?.equals(eventKey)
          )
            continue;
          const group = transaction.meta.innerInstructions?.find((item) => item.index === index);
          const transfers = group?.instructions.map(transferLamports) ?? [];
          const organizerRoyalty = transfers.find(
            (amount, i) =>
              amount !== undefined &&
              group?.instructions[i] &&
              "parsed" in group.instructions[i] &&
              group.instructions[i].parsed.type === "transfer" &&
              "info" in group.instructions[i].parsed &&
              typeof group.instructions[i].parsed.info === "object" &&
              group.instructions[i].parsed.info !== null &&
              "destination" in group.instructions[i].parsed.info &&
              group.instructions[i].parsed.info.destination === organizer,
          );
          if (organizerRoyalty === undefined)
            throw new Error(
              "A confirmed resale transaction did not expose its organizer royalty transfer.",
            );
          total += organizerRoyalty;
          found += 1;
          if (found >= expectedResales) break;
        }
        if (found >= expectedResales) break;
      }
    }
    before = page.at(-1)?.signature;
    if (page.length < 1000) break;
  }
  if (found !== expectedResales)
    throw new Error(
      `Could verify ${found} of ${expectedResales} indexed resales. Royalties are not shown as a partial total.`,
    );
  return total;
}

function StatCard({
  label,
  value,
  suffix,
  amber = false,
}: {
  label: string;
  value: string;
  suffix?: string;
  amber?: boolean;
}) {
  return (
    <article
      className={`relative overflow-hidden border border-outline-variant p-5 shadow-marquee-soft sm:p-stub-padding ${amber ? "bg-surface-container text-primary" : "bg-inverse-surface text-inverse-on-surface"}`}
    >
      <span
        className="absolute right-4 top-4 material-symbols-outlined text-4xl opacity-20"
        aria-hidden="true"
      >
        {label.includes("TICKET")
          ? "confirmation_number"
          : label.includes("INVENTORY")
            ? "inventory_2"
            : label.includes("CHECK-IN")
              ? "how_to_reg"
              : label.includes("RESALE")
                ? "sync_alt"
                : label.includes("REVENUE")
                  ? "payments"
                  : "bolt"}
      </span>
      <h2
        className={`mb-4 font-section-label text-section-label uppercase tracking-widest ${amber ? "text-primary" : "text-inverse-on-surface/70"}`}
      >
        {label}
      </h2>
      <p className="break-words font-mono text-3xl sm:text-4xl">
        {value} {suffix && <span className="text-utility-sm">{suffix}</span>}
      </p>
    </article>
  );
}

export function OrganizerDashboardPage() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58();
  const provider: Provider = useMemo(() => ({ connection }), [connection]);
  const program = useMemo(() => new Program<RentsTicketing>(configuredIdl, provider), [provider]);
  const tx = useSendBuilderTx();
  const resetTx = tx.reset;
  const [dashboard, setDashboard] = useState<DashboardState>({ status: "disconnected" });
  const [retry, setRetry] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState("");
  const [flowMessage, setFlowMessage] = useState("");
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [pendingMetadata, setPendingMetadata] = useState<PendingMetadata>();
  const [transactionOwner, setTransactionOwner] = useState<string>();
  const [selectedEventPda, setSelectedEventPda] = useState<string | null>(null);
  const [ticketOwners, setTicketOwners] = useState<Record<string, string | null>>({});
  const [ticketOwnersLoading, setTicketOwnersLoading] = useState(false);
  const [ticketOwnersError, setTicketOwnersError] = useState<string | null>(null);

  const loadDashboard = useCallback(
    async (organizer: string, active: () => boolean) => {
      if (active()) setDashboard({ status: "loading", owner: organizer });
      try {
        const metadataEvents = await api.getEventsByOrganizer(organizer);
        const ticketAccounts = metadataEvents.length ? await program.account.ticket.all() : [];
        const rows = await Promise.all(
          metadataEvents.map(async (metadata) => {
            const chain = (await program.account.event.fetch(
              new PublicKey(metadata.eventPda),
            )) as ChainEvent;
            if (
              !chain.organizer.equals(new PublicKey(organizer)) ||
              chain.eventId.toString() !== metadata.onChainEventId ||
              chain.maxTickets !== metadata.maxTickets ||
              chain.basePrice.toString() !== metadata.basePriceLamports ||
              chain.resaleCapBps !== metadata.resaleCapBps ||
              chain.royaltyBps !== metadata.royaltyBps
            )
              throw new Error(`Event metadata does not match chain state for ${metadata.name}.`);
            const eventTickets = ticketAccounts.filter(({ account }) =>
              account.event.equals(new PublicKey(metadata.eventPda)),
            );
            const resales = eventTickets.reduce((sum, item) => sum + item.account.resaleCount, 0);
            const royalties = await royaltiesForEvent(
              connection,
              metadata.eventPda,
              organizer,
              resales,
              chain.royaltyBps,
            );
            return {
              metadata,
              chain,
              tickets: eventTickets as unknown as ChainTicket[],
              primaryRevenue: BigInt(chain.basePrice.toString()) * BigInt(chain.ticketsSold),
              royalties,
            };
          }),
        );
        if (active()) setDashboard({ status: "ready", owner: organizer, events: rows });
      } catch (error) {
        if (active())
          setDashboard({ status: "error", owner: organizer, message: errorMessage(error) });
      }
    },
    [connection, program],
  );

  useEffect(() => {
    resetTx();
    setTransactionOwner(undefined);
    setPendingMetadata(undefined);
    setFlowMessage("");
    setSelectedEventPda(null);
    setTicketOwners({});
    setTicketOwnersError(null);
    setTicketOwnersLoading(false);
  }, [owner, resetTx]);

  useEffect(() => {
    if (!owner) {
      setDashboard({ status: "disconnected" });
      return;
    }
    let active = true;
    void loadDashboard(owner, () => active);
    return () => {
      active = false;
    };
  }, [owner, retry, loadDashboard]);

  const view =
    owner &&
      dashboard.status !== "disconnected" &&
      dashboard.status !== "loading" &&
      dashboard.owner === owner
      ? dashboard
      : owner
        ? { status: "loading" as const, owner }
        : { status: "disconnected" as const };
  const readyEvents = view.status === "ready" ? view.events : [];
  const selectedEvent = selectedEventPda
    ? readyEvents.find((event) => event.metadata.eventPda === selectedEventPda)
    : undefined;
  const selectedTickets = selectedEvent?.tickets;

  useEffect(() => {
    if (!selectedTickets) return;
    let active = true;
    const tickets = selectedTickets;
    setTicketOwners({});
    setTicketOwnersError(null);
    setTicketOwnersLoading(tickets.length > 0);

    async function loadTicketOwners() {
      const owners: Record<string, string | null> = {};
      try {
        // Keep RPC concurrency modest for larger events and public Devnet RPCs.
        for (let start = 0; start < tickets.length; start += 6) {
          const batch = tickets.slice(start, start + 6);
          const results = await Promise.all(
            batch.map(async (ticket) => {
              const mint = ticket.account.mint.toBase58();
              try {
                return [mint, await currentHolderForMint(connection, ticket.account.mint)] as const;
              } catch {
                return [mint, null] as const;
              }
            }),
          );
          for (const [mint, holder] of results) owners[mint] = holder;
          if (active) setTicketOwners({ ...owners });
        }
        if (active && Object.values(owners).some((holder) => holder === null)) {
          setTicketOwnersError(
            "Some current holders could not be resolved from Devnet. Refresh the dashboard and try again.",
          );
        }
      } catch {
        if (active) {
          setTicketOwnersError("Current ticket owners could not be loaded from Devnet.");
        }
      } finally {
        if (active) setTicketOwnersLoading(false);
      }
    }

    void loadTicketOwners();
    return () => {
      active = false;
    };
  }, [connection, selectedTickets]);

  useEffect(() => {
    if (!selectedEventPda) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEventPda(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedEventPda]);

  const totalSold = readyEvents.reduce((sum, item) => sum + item.chain.ticketsSold, 0);
  const totalRevenue = readyEvents.reduce((sum, item) => sum + item.primaryRevenue, 0n);
  const totalRoyalties = readyEvents.reduce((sum, item) => sum + item.royalties, 0n);

  function setField(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFormError("");
  }

  async function verifyAndSave(pending: PendingMetadata) {
    setMetadataBusy(true);
    try {
      if (!publicKey || publicKey.toBase58() !== pending.request.organizerPubkey)
        throw new Error(
          "The connected organizer wallet changed. Reconnect it before saving metadata.",
        );
      const eventPda = new PublicKey(pending.eventPda);
      const expected = PublicKey.findProgramAddressSync(
        [
          Buffer.from("event"),
          publicKey.toBuffer(),
          new BN(pending.eventId).toArrayLike(Buffer, "le", 8),
        ],
        frontendConfig.programId,
      )[0];
      if (!eventPda.equals(expected))
        throw new Error(
          "The returned Event PDA does not match the connected organizer and event ID.",
        );
      const chain = (await program.account.event.fetch(eventPda)) as ChainEvent;
      if (
        !chain.organizer.equals(publicKey) ||
        chain.eventId.toString() !== pending.eventId ||
        chain.maxTickets !== pending.request.maxTickets ||
        chain.basePrice.toString() !== pending.request.basePriceLamports ||
        chain.resaleCapBps !== pending.request.resaleCapBps ||
        chain.royaltyBps !== pending.request.royaltyBps
      )
        throw new Error("The confirmed Event account does not match the submitted metadata.");
      setFlowMessage("Event confirmed on Devnet. Saving matching Event metadata…");
      const existing = await api.getEventsByOrganizer(publicKey.toBase58());
      const alreadySaved = existing.find((item) => item.eventPda === pending.eventPda);
      if (alreadySaved && !sameMetadata(alreadySaved, pending.request))
        throw new Error(
          "An Event with this PDA already has different Mongo metadata; it was not overwritten.",
        );
      if (!alreadySaved) await api.createEvent(pending.request);
      const verified = (await api.getEventsByOrganizer(publicKey.toBase58())).find(
        (item) => item.eventPda === pending.eventPda,
      );
      if (!verified || !sameMetadata(verified, pending.request))
        throw new Error("Mongo did not return metadata matching the confirmed Event account.");
      setPendingMetadata(undefined);
      setFlowMessage(
        "Event is live on Devnet and its Mongo metadata matches the canonical Event PDA.",
      );
      setDraft(emptyDraft);
      setShowCreate(false);
      setRetry((value) => value + 1);
    } finally {
      setMetadataBusy(false);
    }
  }

  async function prepareCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setFlowMessage("");
    if (!publicKey) {
      setFormError("Connect Phantom to create an Event for this wallet.");
      return;
    }
    const name = draft.name.trim(),
      description = draft.description.trim(),
      venue = draft.venue.trim();
    const price = parseSol(draft.basePriceSol);
    const maxTickets = Number(draft.maxTickets),
      resaleCapBps = Number(draft.resaleCapBps),
      royaltyBps = Number(draft.royaltyBps);
    const eventDate = new Date(draft.date);
    if (!name || !description || !venue) {
      setFormError("Name, description, and venue are required.");
      return;
    }
    if (!draft.date || Number.isNaN(eventDate.getTime())) {
      setFormError("Enter a valid event date and time.");
      return;
    }
    if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 0xffff_ffff) {
      setFormError("Ticket count must be a positive 32-bit integer.");
      return;
    }
    if (price === undefined) {
      setFormError("Enter a price greater than zero with at most 9 decimal places.");
      return;
    }
    if (!Number.isInteger(resaleCapBps) || resaleCapBps < 10_000 || resaleCapBps > 0xffff) {
      setFormError("Resale cap must be at least 10,000 bps and fit the on-chain u16 field.");
      return;
    }
    if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 2_000) {
      setFormError("Royalty must be between 0 and 2,000 bps.");
      return;
    }
    const imageUrl = draft.imageUrl.trim();
    if (imageUrl) {
      try {
        const image = new URL(imageUrl);
        if (image.protocol !== "http:" && image.protocol !== "https:") throw new Error();
      } catch {
        setFormError("Image URL must use http or https.");
        return;
      }
    }
    const eventId = `${Date.now()}`;
    try {
      const review = await tx.prepare({
        kind: "initialize-event",
        input: {
          eventId,
          maxTickets,
          basePriceLamports: price.toString(),
          resaleCapBps,
          royaltyBps,
        },
      });
      const expected = PublicKey.findProgramAddressSync(
        [Buffer.from("event"), publicKey.toBuffer(), new BN(eventId).toArrayLike(Buffer, "le", 8)],
        frontendConfig.programId,
      )[0];
      if (review.eventPda !== expected.toBase58()) {
        tx.reset();
        throw new Error(
          "The transaction builder PDA did not match the canonical organizer + event ID derivation.",
        );
      }
      const request: CreateEventRequest = {
        onChainEventId: eventId,
        organizerPubkey: publicKey.toBase58(),
        eventPda: expected.toBase58(),
        name,
        description,
        venue,
        date: eventDate.toISOString(),
        ...(imageUrl ? { imageUrl } : {}),
        maxTickets,
        basePriceLamports: price.toString(),
        resaleCapBps,
        royaltyBps,
      };
      setPendingMetadata({ eventPda: expected.toBase58(), eventId, request });
      setTransactionOwner(publicKey.toBase58());
      setShowCreate(false);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function signAndSave() {
    if (!pendingMetadata) return;
    setFormError("");
    try {
      const result = await tx.send();
      if (result.eventPda !== pendingMetadata.eventPda)
        throw new Error("Confirmed transaction PDA differs from the prepared Event.");
      setFlowMessage(
        "Event transaction confirmed. Verifying the on-chain account before saving Event metadata…",
      );
      await verifyAndSave(pendingMetadata);
    } catch (error) {
      setFlowMessage(
        `Event was not fully saved: ${errorMessage(error)}. No Mongo Event is created until chain verification succeeds.`,
      );
    }
  }

  async function retryMetadataSave() {
    if (!pendingMetadata) return;
    setFormError("");
    try {
      await verifyAndSave(pendingMetadata);
    } catch (error) {
      setFlowMessage(`Metadata save is still pending: ${errorMessage(error)}`);
    }
  }

  async function recoverInitialization() {
    if (!pendingMetadata) return;
    try {
      const eventPda = new PublicKey(pendingMetadata.eventPda);
      const account = (await program.account.event.fetchNullable(eventPda)) as ChainEvent | null;
      if (account) {
        await verifyAndSave(pendingMetadata);
        return;
      }
      if (tx.state.signature) {
        const [status, blockHeight] = await Promise.all([
          connection.getSignatureStatus(tx.state.signature, { searchTransactionHistory: true }),
          connection.getBlockHeight("confirmed"),
        ]);
        if (status.value && !status.value.err) {
          setFlowMessage(
            "The confirmed signature is visible. Refreshing the Event account before saving metadata…",
          );
          await verifyAndSave(pendingMetadata);
          return;
        }
        if (
          !status.value &&
          tx.state.review &&
          blockHeight <= tx.state.review.lastValidBlockHeight
        ) {
          setFlowMessage(
            "The transaction is not finalized or expired yet. Wait briefly, then check again.",
          );
          return;
        }
      }
      setPendingMetadata(undefined);
      setTransactionOwner(undefined);
      tx.reset();
      setFlowMessage(
        "No initialized Event account exists, so no Mongo metadata was written. Review the form and prepare a new transaction.",
      );
      setShowCreate(true);
    } catch (error) {
      setFlowMessage(`Initialization recovery could not verify the Event: ${errorMessage(error)}`);
    }
  }

  return (
    <section className="relative mx-auto w-full max-w-[1440px] overflow-hidden px-4 pb-16 sm:px-6 lg:px-8">
      {/* Decorative editorial grid / registration marks. Presentation-only. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-32 top-[28rem] h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div
          className="absolute inset-x-0 top-0 h-full opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <header className="relative mb-8 overflow-hidden border border-outline-variant bg-surface-container shadow-marquee-soft">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
        <div className="flex flex-col gap-7 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between lg:p-9">
          <div className="max-w-3xl">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Organizer Console
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">
                RENTS / DEVNET
              </span>
            </div>
            <p className="mb-1 font-section-label text-section-label uppercase tracking-[0.22em] text-primary">
              Your events. Your box office.
            </p>
            <h1 className="font-display text-5xl uppercase leading-[0.88] tracking-tight text-on-surface sm:text-6xl lg:text-8xl">
              Box Office
            </h1>
            {owner && (
              <p className="mt-5 flex max-w-full items-center gap-2 break-all font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                <span className="material-symbols-outlined text-sm text-primary" aria-hidden="true">
                  account_balance_wallet
                </span>
                {owner.slice(0, 7)}…{owner.slice(-7)}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
            <span className="inline-flex items-center justify-center gap-2 border border-outline-variant bg-background/60 px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface-variant">
              <span className="h-2 w-2 animate-pulse rounded-full bg-tertiary shadow-[0_0_12px_currentColor]" />
              Network online
            </span>
            <button
              type="button"
              disabled={
                !owner ||
                view.status === "loading" ||
                tx.busy ||
                metadataBusy ||
                Boolean(pendingMetadata)
              }
              onClick={() => {
                setShowCreate(true);
                setFormError("");
              }}
              className="group flex items-center justify-center gap-3 bg-primary-container px-5 py-3.5 font-section-label text-section-label uppercase tracking-wider text-on-primary-container shadow-marquee transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>New Event</span>
              <span className="material-symbols-outlined text-base transition-transform group-hover:rotate-90" aria-hidden="true">
                add
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-dashed border-outline-variant sm:grid-cols-4">
          {[
            ["01", "CREATE", "Launch an event"],
            ["02", "MINT", "Issue tickets"],
            ["03", "RESALE", "Keep it moving"],
            ["04", "CHECK-IN", "Verify entry"],
          ].map(([number, title, caption]) => (
            <div
              key={number}
              className="border-r border-dashed border-outline-variant px-4 py-3 last:border-r-0 sm:px-5"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-primary">{number}</span>
                <span className="font-section-label text-[9px] font-bold uppercase tracking-[0.16em] text-on-surface">
                  {title}
                </span>
              </div>
              <p className="mt-1 hidden font-mono text-[9px] uppercase text-on-surface-variant sm:block">
                {caption}
              </p>
            </div>
          ))}
        </div>
      </header>

      {view.status === "disconnected" && (
        <div className="relative overflow-hidden border border-dashed border-outline-variant bg-surface-container p-8 sm:p-12">
          <div className="absolute right-0 top-0 h-full w-1/3 bg-primary/5" aria-hidden="true" />
          <div className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
            <div className="mb-6 flex h-20 w-20 items-center justify-center border border-primary/30 bg-primary/10">
              <span className="material-symbols-outlined text-4xl text-primary" aria-hidden="true">
                account_balance_wallet
              </span>
            </div>
            <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
              Organizer access required
            </p>
            <h2 className="font-display text-3xl uppercase leading-none text-on-surface sm:text-5xl">
              Connect your wallet
            </h2>
            <p className="mt-4 max-w-xl font-body text-body-md leading-relaxed text-on-surface-variant">
              Connect Phantom to open your RENTS box office, monitor ticket sales, and manage events created by this organizer wallet.
            </p>
            <div className="mt-7 flex items-center gap-3 border border-outline-variant bg-background px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
              <span className="h-1.5 w-1.5 bg-primary" />
              Waiting for wallet connection
            </div>
          </div>
        </div>
      )}

      {view.status === "loading" && (
        <div role="status" aria-label="Loading organizer data" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="h-40 animate-pulse border border-outline-variant bg-surface-container" />
            ))}
          </div>
          <div className="h-72 animate-pulse border border-outline-variant bg-surface-container" />
        </div>
      )}

      {view.status === "error" && (
        <div role="alert" className="status-message status-error p-6">
          <div className="flex items-start gap-4">
            <span className="material-symbols-outlined text-2xl text-error" aria-hidden="true">
              error
            </span>
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-error">
                System error
              </p>
              <h2 className="mt-1 font-display text-3xl uppercase text-on-surface">
                Dashboard unavailable
              </h2>
              <p className="mt-2 break-words font-body text-body-md text-on-surface-variant">
                {view.message}
              </p>
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                className="mt-5 inline-flex items-center gap-2 border border-current px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-error transition-colors hover:bg-error-container/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Try again
                <span className="material-symbols-outlined text-sm" aria-hidden="true">refresh</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {view.status === "ready" && (
        <>
          <section className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Box office totals">
            <StatCard label="TICKETS SOLD" value={totalSold.toLocaleString()} suffix="ACROSS EVENTS" />
            <StatCard label="PRIMARY SALES REVENUE" value={formatSol(totalRevenue)} amber />
            <StatCard label="RESALE ROYALTIES EARNED" value={formatSol(totalRoyalties)} amber />
          </section>

          <section aria-labelledby="manifest-title">
            <header className="mb-4 flex flex-col gap-3 border-b border-dashed border-outline-variant pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-primary" />
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
                    Live inventory
                  </p>
                </div>
                <h2 id="manifest-title" className="mt-1 font-display text-3xl uppercase text-on-surface sm:text-4xl">
                  Active Manifest
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                className="group flex items-center gap-2 self-start font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-primary sm:self-auto"
              >
                Refresh
                <span className="material-symbols-outlined text-sm transition-transform group-hover:rotate-180" aria-hidden="true">
                  refresh
                </span>
              </button>
            </header>

            {readyEvents.length === 0 ? (
              <div className="relative overflow-hidden border border-dashed border-outline-variant bg-surface-container p-10 text-center sm:p-16">
                <div className="absolute left-1/2 top-0 h-1 w-24 -translate-x-1/2 bg-primary" />
                <span className="material-symbols-outlined text-5xl text-outline" aria-hidden="true">
                  confirmation_number
                </span>
                <p className="mt-4 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  Manifest empty
                </p>
                <h3 className="mt-2 font-display text-3xl uppercase text-on-surface sm:text-4xl">
                  No Events yet
                </h3>
                <p className="mx-auto mt-2 max-w-md font-body text-body-md text-on-surface-variant">
                  Create your first Event and open the box office.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="marquee-glow mt-6 bg-primary-container px-6 py-3.5 font-section-label text-section-label uppercase tracking-wider text-on-primary-container transition-transform hover:-translate-y-0.5"
                >
                  Create Event
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {readyEvents.map(({ metadata, chain }) => {
                  const pct = chain.maxTickets
                    ? Math.min(100, (chain.ticketsSold / chain.maxTickets) * 100)
                    : 0;
                  const status =
                    chain.ticketsSold >= chain.maxTickets
                      ? "SOLD OUT"
                      : new Date(metadata.date).getTime() < Date.now()
                        ? "PAST"
                        : "LIVE";

                  return (
                    <article
                      key={metadata.eventPda}
                      role="button"
                      tabIndex={0}
                      aria-haspopup="dialog"
                      aria-label={`Open analytics for ${metadata.name}`}
                      onClick={() => setSelectedEventPda(metadata.eventPda)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedEventPda(metadata.eventPda);
                        }
                      }}
                      className="group relative cursor-pointer overflow-hidden border border-outline-variant bg-surface-container text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-marquee-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                    >
                      <div className="absolute inset-y-0 left-0 w-1 bg-primary/30 transition-colors group-hover:bg-primary" />
                      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(220px,0.75fr)_minmax(180px,0.6fr)_auto]">
                        <div className="min-w-0 p-5 pl-7 sm:p-6 sm:pl-8">
                          <div className="mb-4 flex items-center gap-3">
                            <span className="border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-primary">
                              Event · {metadata.onChainEventId}
                            </span>
                            <span className={`px-2 py-1 font-mono text-[9px] font-bold tracking-wider ${status === "LIVE"
                                ? "bg-primary-container text-on-primary-container shadow-marquee"
                                : "border border-outline-variant text-on-surface-variant"
                              }`}>
                              {status}
                            </span>
                          </div>
                          <h3 className="truncate font-display text-3xl uppercase leading-none text-on-surface sm:text-4xl">
                            {metadata.name}
                          </h3>
                          <p className="mt-3 line-clamp-2 max-w-2xl font-body text-sm leading-relaxed text-on-surface-variant">
                            {metadata.description}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 border-t border-dashed border-outline-variant p-5 sm:p-6 lg:border-l lg:border-t-0">
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Date</p>
                            <p className="mt-1 font-mono text-xs text-on-surface">
                              {new Date(metadata.date).toLocaleDateString()}
                            </p>
                          </div>
                          <div>
                            <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Venue</p>
                            <p className="mt-1 truncate font-mono text-xs text-on-surface">
                              {metadata.venue}
                            </p>
                          </div>
                        </div>

                        <div className="border-t border-dashed border-outline-variant p-5 sm:p-6 lg:border-l lg:border-t-0">
                          <div className="flex items-end justify-between gap-3">
                            <div>
                              <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">
                                Tickets
                              </p>
                              <p className="mt-1 font-mono text-xl text-on-surface">
                                <strong className="text-primary">{chain.ticketsSold.toLocaleString()}</strong>
                                <span className="text-sm text-on-surface-variant"> / {chain.maxTickets.toLocaleString()}</span>
                              </p>
                            </div>
                            <span className="font-mono text-[9px] text-on-surface-variant">{Math.round(pct)}%</span>
                          </div>
                          <div className="mt-4 h-2 overflow-hidden bg-surface-variant">
                            <span
                              className="block h-full bg-primary transition-[width] duration-700"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-end border-t border-dashed border-outline-variant p-5 sm:p-6 lg:border-l lg:border-t-0">
                          <span className="inline-flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-wider text-on-surface-variant transition-colors group-hover:text-primary">
                            <span className="hidden sm:inline">View analytics</span>
                            <span className="material-symbols-outlined text-outline transition-transform duration-200 group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true">
                              arrow_forward
                            </span>
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/80 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedEventPda(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-analytics-title"
            className="mx-auto my-3 w-full max-w-6xl overflow-hidden border border-outline-variant bg-background shadow-2xl sm:my-6"
          >
            <header className="relative border-b border-dashed border-outline-variant bg-surface-container p-5 sm:p-8">
              <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
              <div className="flex items-start justify-between gap-4 pl-2">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-primary">
                      Event analytics
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">
                      Event · {selectedEvent.metadata.onChainEventId}
                    </span>
                  </div>
                  <h2
                    id="event-analytics-title"
                    className="break-words font-display text-4xl uppercase leading-none text-on-surface sm:text-6xl"
                  >
                    {selectedEvent.metadata.name}
                  </h2>
                  <p className="mt-3 max-w-3xl font-body text-sm leading-relaxed text-on-surface-variant">
                    {selectedEvent.metadata.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEventPda(null)}
                  aria-label="Close event analytics"
                  className="flex h-10 w-10 shrink-0 items-center justify-center border border-outline-variant text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>
              <div className="mt-6 grid gap-3 border-t border-dashed border-outline-variant pt-5 sm:grid-cols-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">Event date</p>
                  <p className="mt-1 font-mono text-sm text-on-surface">
                    {new Date(selectedEvent.metadata.date).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">Venue</p>
                  <p className="mt-1 break-words font-mono text-sm text-on-surface">{selectedEvent.metadata.venue}</p>
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">Canonical Event PDA</p>
                  <a
                    href={`https://explorer.solana.com/address/${selectedEvent.metadata.eventPda}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all font-mono text-xs text-primary underline decoration-dashed underline-offset-4 hover:opacity-80"
                  >
                    {shortAddress(selectedEvent.metadata.eventPda)} · View on Explorer
                  </a>
                </div>
              </div>
            </header>

            <div className="space-y-8 p-4 sm:p-8">
              {(() => {
                const tickets = selectedEvent.tickets;
                const minted = selectedEvent.chain.ticketsSold;
                const capacity = selectedEvent.chain.maxTickets;
                const progress = capacity > 0 ? Math.min(100, (minted / capacity) * 100) : 0;
                const checkIns = tickets.filter((ticket) => ticket.account.isUsed).length;
                const resaleCount = tickets.reduce((sum, ticket) => sum + ticket.account.resaleCount, 0);
                const listedCount = tickets.filter((ticket) => ticket.account.listingPrice != null).length;
                const remaining = Math.max(0, capacity - minted);
                const basePrice = BigInt(selectedEvent.chain.basePrice.toString());

                return (
                  <>
                    <section aria-label="Event performance">
                      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">Performance overview</p>
                          <h3 className="mt-1 font-display text-3xl uppercase text-on-surface sm:text-4xl">The numbers</h3>
                        </div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                          {Math.round(progress)}% of available tickets minted
                        </span>
                      </div>
                      <div className="mb-5 h-2 overflow-hidden bg-surface-variant">
                        <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <StatCard label="TICKETS MINTED" value={minted.toLocaleString()} suffix={`OF ${capacity.toLocaleString()}`} />
                        <StatCard label="INVENTORY LEFT" value={remaining.toLocaleString()} suffix="AVAILABLE" amber />
                        <StatCard label="CHECK-INS" value={checkIns.toLocaleString()} suffix={`OF ${minted.toLocaleString()}`} />
                        <StatCard label="RESALES" value={resaleCount.toLocaleString()} suffix="COMPLETED" />
                      </div>
                    </section>

                    <section aria-label="Event revenue and rules" className="grid gap-4 lg:grid-cols-2">
                      <article className="border border-outline-variant bg-inverse-surface p-5 text-inverse-on-surface sm:p-6">
                        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-inverse-on-surface/65">Primary sales revenue</p>
                        <p className="mt-3 break-words font-mono text-3xl sm:text-4xl">{formatSol(selectedEvent.primaryRevenue)}</p>
                        <p className="mt-3 font-body text-sm leading-relaxed text-inverse-on-surface/70">
                          {minted.toLocaleString()} minted tickets × {formatSol(basePrice)} face value. This is the recorded primary-sale amount before any separate off-chain costs.
                        </p>
                      </article>
                      <article className="border border-primary/40 bg-primary/10 p-5 sm:p-6">
                        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-primary">Resale royalties earned</p>
                        <p className="mt-3 break-words font-mono text-3xl text-primary sm:text-4xl">{formatSol(selectedEvent.royalties)}</p>
                        <p className="mt-3 font-body text-sm leading-relaxed text-on-surface-variant">
                          Total organizer royalty transfers verified from confirmed resale transactions for this Event.
                        </p>
                      </article>
                      <div className="grid grid-cols-2 gap-3 lg:col-span-2 xl:grid-cols-4">
                        <div className="border border-outline-variant p-4">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Face value</p>
                          <p className="mt-2 font-mono text-lg text-on-surface">{formatSol(basePrice)}</p>
                        </div>
                        <div className="border border-outline-variant p-4">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Resale cap</p>
                          <p className="mt-2 font-mono text-lg text-on-surface">{(selectedEvent.chain.resaleCapBps / 100).toLocaleString()}%</p>
                        </div>
                        <div className="border border-outline-variant p-4">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Organizer royalty</p>
                          <p className="mt-2 font-mono text-lg text-on-surface">{(selectedEvent.chain.royaltyBps / 100).toLocaleString()}%</p>
                        </div>
                        <div className="border border-outline-variant p-4">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Currently listed</p>
                          <p className="mt-2 font-mono text-lg text-on-surface">{listedCount.toLocaleString()} tickets</p>
                        </div>
                      </div>
                    </section>

                    <section aria-labelledby="ticket-holders-title">
                      <header className="mb-4 flex flex-col gap-3 border-b border-dashed border-outline-variant pb-4 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">On-chain ticket accounts</p>
                          <h3 id="ticket-holders-title" className="mt-1 font-display text-3xl uppercase text-on-surface sm:text-4xl">Ticket holders</h3>
                          <p className="mt-2 max-w-2xl font-body text-sm text-on-surface-variant">
                            Current holders are resolved from the token account that owns each one-of-one ticket NFT. The list reflects current ownership, not the original buyer.
                          </p>
                        </div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                          {tickets.length.toLocaleString()} ticket accounts
                        </span>
                      </header>

                      {ticketOwnersLoading && Object.keys(ticketOwners).length === 0 && (
                        <div role="status" className="border border-dashed border-outline-variant p-6 font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                          <span className="mr-2 inline-block h-2 w-2 animate-pulse bg-primary" /> Resolving current holders from Devnet…
                        </div>
                      )}
                      {ticketOwnersError && (
                        <p role="status" className="mb-4 border border-outline-variant bg-surface-container p-3 font-mono text-[10px] leading-relaxed text-on-surface-variant">
                          {ticketOwnersError}
                        </p>
                      )}
                      {tickets.length === 0 ? (
                        <div className="border border-dashed border-outline-variant p-8 text-center font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                          No ticket accounts have been indexed for this Event yet.
                        </div>
                      ) : (
                        <div className="overflow-x-auto border border-outline-variant">
                          <table className="w-full min-w-[720px] border-collapse text-left">
                            <thead className="bg-surface-container">
                              <tr className="border-b border-dashed border-outline-variant">
                                {['Ticket', 'Current holder', 'State', 'Resales', 'Listing price', 'Mint'].map((heading) => (
                                  <th key={heading} scope="col" className="px-4 py-3 font-mono text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">{heading}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {tickets
                                .slice()
                                .sort((left, right) => left.account.ticketNumber - right.account.ticketNumber)
                                .map((ticket) => {
                                  const mint = ticket.account.mint.toBase58();
                                  const holder = ticketOwners[mint];
                                  const listing = ticket.account.listingPrice;
                                  return (
                                    <tr key={mint} className="border-b border-dashed border-outline-variant/70 last:border-b-0 hover:bg-surface-container/60">
                                      <td className="px-4 py-3 font-mono text-xs text-primary">#{ticket.account.ticketNumber.toLocaleString()}</td>
                                      <td className="px-4 py-3 font-mono text-xs">
                                        {holder ? (
                                          <a href={`https://explorer.solana.com/address/${holder}?cluster=devnet`} target="_blank" rel="noreferrer" className="text-on-surface underline decoration-dashed underline-offset-4 transition-colors hover:text-primary">{shortAddress(holder)}</a>
                                        ) : (
                                          <span className="text-on-surface-variant">{ticketOwnersLoading ? 'Resolving…' : 'Unavailable'}</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className={`inline-flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-wider ${ticket.account.isUsed ? 'text-tertiary' : 'text-on-surface-variant'}`}>
                                          <span className={`h-1.5 w-1.5 ${ticket.account.isUsed ? 'bg-tertiary' : 'bg-outline'}`} />
                                          {ticket.account.isUsed ? 'Checked in' : 'Unused'}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 font-mono text-xs text-on-surface">{ticket.account.resaleCount.toLocaleString()}</td>
                                      <td className="px-4 py-3 font-mono text-xs text-on-surface">{listing != null ? formatSol(BigInt(listing.toString())) : '—'}</td>
                                      <td className="px-4 py-3 font-mono text-xs">
                                        <a href={`https://explorer.solana.com/address/${mint}?cluster=devnet`} target="_blank" rel="noreferrer" className="text-primary underline decoration-dashed underline-offset-4 hover:opacity-80">{shortAddress(mint)}</a>
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </>
                );
              })()}
            </div>
            <footer className="flex flex-col gap-3 border-t border-dashed border-outline-variant bg-surface-container px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <span className="font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">Analytics sourced from Solana Devnet</span>
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                className="inline-flex items-center justify-center gap-2 border border-outline-variant px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-wider text-on-surface transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Refresh analytics
                <span className="material-symbols-outlined text-sm" aria-hidden="true">refresh</span>
              </button>
            </footer>
          </section>
        </div>
      )}

      {transactionOwner === owner && (tx.state.message || flowMessage) && (
        <div
          role={tx.state.status === "error" || formError ? "alert" : "status"}
          className={`status-message mt-8 overflow-hidden p-0 ${tx.state.status === "error" || formError
              ? "status-error"
              : pendingMetadata
                ? "status-warning"
                : tx.state.status === "success"
                  ? "status-success"
                  : "status-info"
            }`}
        >
          <div className="flex items-start gap-4 p-5">
            <span
              className={`material-symbols-outlined text-2xl ${tx.state.status === "error" || formError ? "text-error" : "text-primary"
                }`}
              aria-hidden="true"
            >
              {tx.state.status === "error" || formError ? "error" : tx.state.status === "success" ? "check_circle" : "sync"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-body text-body-md text-on-surface">
                {flowMessage || tx.state.message}
              </p>
              {formError && <p className="mt-2 font-body text-body-md text-error">{formError}</p>}
              {tx.state.errorCode && (
                <p className="mt-2 font-mono text-[10px] uppercase text-on-surface-variant">{tx.state.errorCode}</p>
              )}
              {tx.state.signature && (
                <a
                  className="mt-3 block break-all font-mono text-[10px] text-primary underline underline-offset-4"
                  href={`https://explorer.solana.com/tx/${tx.state.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Devnet transaction · {tx.state.signature}
                </a>
              )}
              {tx.state.status === "ready" && (
                <button
                  type="button"
                  disabled={tx.busy}
                  onClick={() => void signAndSave()}
                  className="mt-5 w-full bg-primary-container px-4 py-3.5 font-mono text-[10px] font-bold uppercase tracking-wider text-on-primary-container"
                >
                  Approve Event initialization in Phantom
                </button>
              )}
              {pendingMetadata && tx.state.status === "success" && (
                <button
                  type="button"
                  disabled={metadataBusy}
                  onClick={() => void retryMetadataSave()}
                  className="mt-5 w-full border border-primary-container px-4 py-3.5 font-mono text-[10px] font-bold uppercase tracking-wider text-primary disabled:opacity-50"
                >
                  {metadataBusy ? "Verifying and saving…" : "Retry metadata verification / save"}
                </button>
              )}
              {pendingMetadata && tx.state.status === "error" && (
                <button
                  type="button"
                  disabled={metadataBusy}
                  onClick={() => void recoverInitialization()}
                  className="mt-5 w-full border border-outline-variant px-4 py-3.5 font-mono text-[10px] uppercase tracking-wider text-on-surface disabled:opacity-50"
                >
                  {metadataBusy ? "Checking chain…" : "Check chain result and safely continue"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/75 p-4 py-8 backdrop-blur-sm sm:p-8">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-event-title"
            className="my-auto w-full max-w-4xl overflow-hidden border border-outline-variant bg-surface-container shadow-2xl"
          >
            <header className="relative flex items-center justify-between border-b border-dashed border-outline-variant bg-surface-container-high p-5 sm:p-7">
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-primary" />
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
                    Organizer · Devnet
                  </p>
                </div>
                <h2 id="create-event-title" className="mt-2 font-display text-4xl uppercase leading-none text-on-surface sm:text-5xl">
                  Create Event
                </h2>
                <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-on-surface-variant">
                  Configure the canonical Event account and its metadata
                </p>
              </div>
              <button
                type="button"
                aria-label="Close form"
                onClick={() => setShowCreate(false)}
                className="flex h-10 w-10 items-center justify-center border border-outline-variant text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
              >
                <span className="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            </header>

            <form onSubmit={(event) => void prepareCreate(event)} className="grid gap-5 p-5 sm:grid-cols-2 sm:p-7">
              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Event name
                <input
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(event) => setField("name", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-body text-body-md normal-case text-on-surface outline-none transition-colors focus:border-primary"
                />
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Venue
                <input
                  required
                  maxLength={200}
                  value={draft.venue}
                  onChange={(event) => setField("venue", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-body text-body-md normal-case text-on-surface outline-none transition-colors focus:border-primary"
                />
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant sm:col-span-2">
                Description
                <textarea
                  required
                  maxLength={2000}
                  rows={4}
                  value={draft.description}
                  onChange={(event) => setField("description", event.target.value)}
                  className="mt-2 block w-full resize-y border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-body text-body-md normal-case text-on-surface outline-none transition-colors focus:border-primary"
                />
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Date &amp; time
                <input
                  required
                  type="datetime-local"
                  value={draft.date}
                  onChange={(event) => setField("date", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-mono text-utility-sm text-on-surface outline-none focus:border-primary"
                />
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Image URL · optional
                <input
                  type="url"
                  value={draft.imageUrl}
                  onChange={(event) => setField("imageUrl", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-mono text-utility-sm text-on-surface outline-none focus:border-primary"
                />
                <span className="mt-1 block font-body text-utility-sm text-on-surface-variant">
                  Optional. You can create this Event without an image.
                </span>
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Ticket count
                <input
                  required
                  type="number"
                  min="1"
                  max="4294967295"
                  step="1"
                  value={draft.maxTickets}
                  onChange={(event) => setField("maxTickets", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-mono text-utility-sm text-on-surface outline-none focus:border-primary"
                />
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Ticket price · SOL
                <input
                  required
                  type="number"
                  min="0.000000001"
                  step="0.000000001"
                  inputMode="decimal"
                  value={draft.basePriceSol}
                  onChange={(event) => setField("basePriceSol", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-mono text-utility-sm text-on-surface outline-none focus:border-primary"
                />
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Resale cap · bps
                <input
                  required
                  type="number"
                  min="10000"
                  max="65535"
                  step="1"
                  value={draft.resaleCapBps}
                  onChange={(event) => setField("resaleCapBps", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-mono text-utility-sm text-on-surface outline-none focus:border-primary"
                />
                <span className="mt-1 block font-mono text-[10px] text-on-surface-variant">
                  10000 bps = 100%; default 11000 bps
                </span>
              </label>

              <label className="font-section-label text-section-label uppercase text-on-surface-variant">
                Royalty · bps
                <input
                  required
                  type="number"
                  min="0"
                  max="2000"
                  step="1"
                  value={draft.royaltyBps}
                  onChange={(event) => setField("royaltyBps", event.target.value)}
                  className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3.5 font-mono text-utility-sm text-on-surface outline-none focus:border-primary"
                />
                <span className="mt-1 block font-mono text-[10px] text-on-surface-variant">
                  Maximum 2000 bps (20%)
                </span>
              </label>

              <div className="border-t border-dashed border-outline-variant pt-5 sm:col-span-2">
                <div className="mb-5 flex gap-3 border border-outline-variant bg-background/50 p-4">
                  <span className="material-symbols-outlined text-primary" aria-hidden="true">verified_user</span>
                  <p className="font-mono text-[10px] leading-relaxed text-on-surface-variant">
                    The connected Phantom wallet is the organizer and fee payer. Chain initialization completes before Event metadata is saved.
                  </p>
                </div>

                {formError && (
                  <p role="alert" className="status-message status-error mb-4 font-body text-utility-sm">
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!owner || tx.busy || Boolean(pendingMetadata)}
                  className="marquee-glow group flex w-full items-center justify-center gap-3 bg-primary-container px-5 py-4 font-section-label text-section-label uppercase tracking-wider text-on-primary-container transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  <span>
                    {tx.state.status === "preparing"
                      ? "Preparing & simulating…"
                      : "Prepare Event initialization"}
                  </span>
                  <span className="material-symbols-outlined text-base transition-transform group-hover:translate-x-1" aria-hidden="true">
                    arrow_forward
                  </span>
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
