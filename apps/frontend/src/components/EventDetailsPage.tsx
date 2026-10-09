import { Program, type Idl, type Provider } from "@coral-xyz/anchor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { EventDto, PlatformConfigDto, RentsTicketing, TicketDto } from "shared";
import sharedIdlJson from "shared/idl/rents_ticketing.json";
import { useSendBuilderTx } from "../hooks/useSendBuilderTx";
import { ApiError, api } from "../lib/api";
import { frontendConfig } from "../lib/config";

type ChainEvent = {
  ticketsSold: number;
  maxTickets: number;
  basePriceLamports: string;
  resaleCapBps: number;
  royaltyBps: number;
};
type PageData = {
  event: EventDto;
  platform?: PlatformConfigDto;
  listings?: TicketDto[];
  chain?: ChainEvent;
  platformError?: string;
  listingsError?: string;
  chainError?: string;
};
type PageState =
  | { status: "loading" }
  | { status: "not-found"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; data: PageData };

const configuredIdl: Idl = {
  ...(sharedIdlJson as Idl),
  address: frontendConfig.programId.toBase58(),
};

function formatSol(lamports: string): string {
  const amount = BigInt(lamports);
  const whole = amount / 1_000_000_000n;
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} SOL`;
}

function formatEventDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "This information could not be loaded right now.";
}

function shortAddress(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function percent(bps: number): string {
  return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

/* Display only: how a listing compares with face value, e.g. "110% of face". */
function ofFace(priceLamports: string, faceLamports: string): string | undefined {
  const face = BigInt(faceLamports);
  if (face === 0n) return undefined;
  return `${percent(Number((BigInt(priceLamports) * 10_000n) / face))} of face`;
}

function Notches() {
  return (
    <>
      <span aria-hidden="true" className="absolute -left-3 -top-3 z-10 h-6 w-6 rounded-full bg-background" />
      <span aria-hidden="true" className="absolute -right-3 -top-3 z-10 h-6 w-6 rounded-full bg-background lg:-bottom-3 lg:left-[-0.75rem] lg:right-auto lg:top-auto" />
    </>
  );
}

function EventSkeleton() {
  return (
    <div role="status" aria-label="Loading event details" className="mx-auto w-full max-w-6xl animate-pulse overflow-hidden rounded lg:flex">
      <div className="min-h-[32rem] flex-1 space-y-6 bg-surface-container p-6 sm:p-stub-padding lg:p-12">
        <div className="h-48 bg-surface-container-high" />
        <div className="h-10 w-2/3 bg-surface-container-high" />
        <div className="h-4 w-full bg-surface-container-high" />
        <div className="h-4 w-4/5 bg-surface-container-high" />
      </div>
      <div className="min-h-[24rem] bg-surface-container-high lg:w-[22rem]" />
    </div>
  );
}

function TransactionPanel({
  state,
  onSend,
  onReset,
}: {
  state: ReturnType<typeof useSendBuilderTx>["state"];
  onSend: () => void;
  onReset: () => void;
}) {
  if (!state.message) return null;
  const confirmed = state.status === "success";
  return (
    <div
      role={state.status === "error" ? "alert" : "status"}
      className={`status-message mt-5 ${confirmed ? "status-success" : state.status === "error" ? "status-error" : "status-info"}`}
    >
      <p className="font-body text-body-md">{state.message}</p>
      {state.errorCode && <p className="mt-2 font-mono text-utility-sm">{state.errorCode}</p>}
      {state.review && (
        <dl className="mt-3 grid gap-x-3 gap-y-1 border-t border-current/20 pt-3 font-mono text-utility-sm sm:grid-cols-[10rem_1fr]">
          <dt>Network</dt>
          <dd>Solana Devnet</dd>
          <dt>Estimated network fee</dt>
          <dd>{state.review.networkFeeLamports.toLocaleString()} lamports</dd>
          {state.review.ticketFaceLamports && (
            <>
              <dt>Ticket face price</dt>
              <dd>{formatSol(state.review.ticketFaceLamports)}</dd>
            </>
          )}
          {state.review.platformFeeLamports && (
            <>
              <dt>Platform fee</dt>
              <dd>{formatSol(state.review.platformFeeLamports)}</dd>
            </>
          )}
        </dl>
      )}
      {state.status === "ready" && (
        <button
          type="button"
          onClick={onSend}
          className="mt-4 w-full bg-primary-container px-4 py-3 font-mono text-utility-mono font-bold text-on-primary-container hover:brightness-110"
        >
          SIGN &amp; SEND WITH PHANTOM
        </button>
      )}
      {state.signature && (
        <a
          className="mt-3 block break-all font-mono text-utility-sm underline"
          target="_blank"
          rel="noreferrer"
          href={`https://explorer.solana.com/tx/${state.signature}?cluster=devnet`}
        >
          {confirmed ? "Confirmed transaction" : "Transaction"}: {state.signature}
        </a>
      )}
      {state.result?.ticketPda && (
        <p className="mt-2 break-all font-mono text-utility-sm">Ticket account: {state.result.ticketPda}</p>
      )}
      {state.result?.syncError && (
        <p role="status" className="status-message status-warning mt-3 font-body text-utility-sm">
          The transaction is confirmed on-chain. Ticket cache sync did not complete: {state.result.syncError}
        </p>
      )}
      {(confirmed || state.status === "error") && (
        <button type="button" onClick={onReset} className="mt-3 font-section-label text-section-label uppercase underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

function ResaleListing({
  listing,
  royaltyBps,
  feeBps,
  disabled,
  busy,
  onBuy,
}: {
  listing: TicketDto;
  royaltyBps: number;
  feeBps: number;
  disabled: boolean;
  busy: boolean;
  onBuy: (listing: TicketDto) => void;
}) {
  if (!listing.listingPriceLamports) return null;
  const price = BigInt(listing.listingPriceLamports);
  const fee = (price * BigInt(feeBps)) / 10_000n;
  const royalty = (price * BigInt(royaltyBps)) / 10_000n;
  const vsFace = ofFace(listing.listingPriceLamports, listing.faceValueLamports);
  return (
    <article className="grid gap-4 border-b border-dashed border-outline-variant py-5 text-background transition-colors last:border-b-0 hover:bg-black/[0.03] sm:grid-cols-[1fr_auto] sm:items-center">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-section-label text-section-label uppercase text-outline-variant">
            Ticket · {shortAddress(listing.mintAddress)}
          </p>
          {vsFace && (
            <span className="bg-primary-container px-2 py-0.5 font-mono text-utility-sm font-bold text-on-primary-container">
              {vsFace}
            </span>
          )}
        </div>
        <p className="mt-2 font-display text-headline-lg-mobile leading-none">{formatSol(listing.listingPriceLamports)}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 font-mono text-utility-sm">
          <dt>Original face value</dt>
          <dd>{formatSol(listing.faceValueLamports)}</dd>
          <dt>Platform fee ({percent(feeBps)})</dt>
          <dd>{formatSol(fee.toString())}</dd>
          <dt>Organizer royalty ({percent(royaltyBps)})</dt>
          <dd>{formatSol(royalty.toString())}</dd>
          <dt>Current holder</dt>
          <dd title={listing.ownerPubkey}>{shortAddress(listing.ownerPubkey)}</dd>
          <dt>Buyer total*</dt>
          <dd className="font-bold">{formatSol((price + fee).toString())}</dd>
        </dl>
      </div>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => onBuy(listing)}
        className="bg-background px-5 py-3 font-mono text-utility-sm font-bold text-inverse-surface transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "PREPARING…" : "BUY LISTING"}
      </button>
    </article>
  );
}

export function EventDetailsPage({ id }: { id: string }) {
  const { connection } = useConnection();
  const provider: Provider = useMemo(() => ({ connection }), [connection]);
  const program = useMemo(() => new Program<RentsTicketing>(configuredIdl, provider), [provider]);
  const tx = useSendBuilderTx();
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState<PageState>({ status: "loading" });

  const load = useCallback(async () => {
    setPage({ status: "loading" });
    try {
      const event = await api.getEvent(id);
      const [platformResult, listingsResult, chainResult] = await Promise.allSettled([
        api.getPlatform(),
        api.getListings(),
        program.account.event.fetch(new PublicKey(event.eventPda)),
      ]);
      const data: PageData = { event };
      if (platformResult.status === "fulfilled") data.platform = platformResult.value;
      else data.platformError = errorMessage(platformResult.reason);
      if (listingsResult.status === "fulfilled") {
        data.listings = listingsResult.value.filter(
          (listing) => listing.eventPda === event.eventPda && listing.listingPriceLamports !== undefined,
        );
      } else data.listingsError = errorMessage(listingsResult.reason);
      if (chainResult.status === "fulfilled") {
        const account = chainResult.value;
        if (
          !account.organizer.equals(new PublicKey(event.organizerPubkey)) ||
          account.eventId.toString() !== event.onChainEventId
        ) {
          data.chainError = "The Event metadata does not match the on-chain Event account.";
        } else
          data.chain = {
            ticketsSold: account.ticketsSold,
            maxTickets: account.maxTickets,
            basePriceLamports: account.basePrice.toString(),
            resaleCapBps: account.resaleCapBps,
            royaltyBps: account.royaltyBps,
          };
      } else data.chainError = errorMessage(chainResult.reason);
      setPage({ status: "ready", data });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setPage({ status: "not-found", message: error.message });
      else setPage({ status: "error", message: errorMessage(error) });
    }
  }, [id, program]);

  useEffect(() => {
    void load();
  }, [load, retry]);

  async function preparePrimary() {
    if (page.status !== "ready") return;
    try {
      await tx.prepare({
        kind: "mint",
        input: { eventPda: page.data.event.eventPda, eventName: page.data.event.name },
      });
    } catch {
      /* detailed state is shown below */
    }
  }

  async function prepareResale(listing: TicketDto) {
    try {
      await tx.prepare({
        kind: "resell",
        input: { mintPubkey: listing.mintAddress, sellerPubkey: listing.ownerPubkey },
      });
    } catch {
      /* detailed state is shown below */
    }
  }

  async function signAndSend() {
    try {
      await tx.send();
    } catch {
      /* detailed state is shown below */
    }
  }

  if (page.status === "loading") return <EventSkeleton />;
  if (page.status === "not-found" || page.status === "error")
    return (
      <section
        role="alert"
        className="ticket-paper mx-auto flex min-h-72 w-full max-w-3xl flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-stub-padding text-center text-background"
      >
        <span className="material-symbols-outlined text-5xl text-outline" aria-hidden="true">
          event_busy
        </span>
        <h1 className="font-display text-headline-lg uppercase">
          {page.status === "not-found" ? "Event not found" : "Event unavailable"}
        </h1>
        <p className="max-w-xl font-body text-body-md">{page.message}</p>
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="bg-background px-5 py-3 font-section-label text-section-label uppercase text-inverse-surface"
        >
          Try again
        </button>
      </section>
    );

  const { event } = page.data;
  const remaining = page.data.chain ? Math.max(0, page.data.chain.maxTickets - page.data.chain.ticketsSold) : undefined;
  const facePriceLamports = page.data.chain?.basePriceLamports;
  const resaleCapBps = page.data.chain?.resaleCapBps;
  const royaltyBps = page.data.chain?.royaltyBps;
  const primaryFee =
    page.data.platform && facePriceLamports
      ? (BigInt(facePriceLamports) * BigInt(page.data.platform.platformFeeBps)) / 10_000n
      : undefined;
  const listings = [...(page.data.listings ?? [])].sort((a, b) => {
    const diff = BigInt(a.listingPriceLamports ?? "0") - BigInt(b.listingPriceLamports ?? "0");
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  });
  const canBuy = Boolean(page.data.platform && remaining !== undefined && remaining > 0 && !tx.busy);

  /* Display-only derived values */
  const maxResale =
    facePriceLamports && resaleCapBps !== undefined
      ? ((BigInt(facePriceLamports) * BigInt(resaleCapBps)) / 10_000n).toString()
      : undefined;
  const total = primaryFee !== undefined && facePriceLamports ? (BigInt(facePriceLamports) + primaryFee).toString() : undefined;
  const maxTickets = page.data.chain?.maxTickets ?? 0;
  const soldPct = page.data.chain && maxTickets > 0 ? Math.min(100, (page.data.chain.ticketsSold / maxTickets) * 100) : undefined;

  return (
    <section className="mx-auto w-full max-w-6xl">
      <style>{`
        @keyframes rents-detail-in { from { opacity: 0; transform: translateY(-32px) rotate(-1.5deg); } to { opacity: 1; transform: none; } }
        .rents-detail-in { animation: rents-detail-in .8s cubic-bezier(.2,.9,.25,1) both; }
        @media (prefers-reduced-motion: reduce) { .rents-detail-in { animation: none; } }
      `}</style>

      <div className="rents-detail-in ticket-paper overflow-hidden rounded border border-outline-variant text-background shadow-2xl lg:flex">
        <article className="min-w-0 flex-1 p-6 sm:p-stub-padding lg:p-12">
          <div className="relative -mx-6 -mt-6 mb-8 flex h-52 items-center justify-center overflow-hidden bg-outline-variant/10 sm:-mx-stub-padding sm:-mt-stub-padding sm:h-72 lg:-mx-12 lg:-mt-12 lg:h-80">
            <span className="material-symbols-outlined absolute text-6xl text-outline/40" aria-hidden="true">
              confirmation_number
            </span>
            {event.imageUrl && (
              <img
                className="relative h-full w-full object-cover mix-blend-multiply opacity-90"
                src={event.imageUrl}
                alt={`${event.name} event artwork`}
                onError={(image) => {
                  image.currentTarget.hidden = true;
                }}
              />
            )}
            {resaleCapBps !== undefined && (
              <span className="absolute right-4 top-4 rounded bg-primary-container px-2 py-1 font-mono text-utility-sm font-bold text-on-primary-container shadow-sm">
                {percent(resaleCapBps)} CAP
              </span>
            )}
          </div>

          <header className="mb-8">
            <p className="mb-2 font-section-label text-section-label uppercase tracking-widest text-outline-variant">
              Featured Event · {event.onChainEventId}
            </p>
            <h1 className="mb-4 break-words font-display text-[clamp(2.5rem,6vw,4.5rem)] uppercase leading-[0.92]">
              {event.name}
            </h1>
            <p className="max-w-3xl whitespace-pre-line font-body text-body-md text-surface-variant">{event.description}</p>
          </header>

          <div className="grid grid-cols-1 gap-5 border-y border-dashed border-outline-variant py-6 sm:grid-cols-2 sm:gap-8">
            <div>
              <p className="mb-1 flex items-center gap-1 font-section-label text-section-label uppercase text-outline-variant">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">calendar_month</span>
                Date &amp; time
              </p>
              <p className="font-mono text-utility-mono">{formatEventDate(event.date)}</p>
            </div>
            <div>
              <p className="mb-1 flex items-center gap-1 font-section-label text-section-label uppercase text-outline-variant">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">location_on</span>
                Venue
              </p>
              <p className="font-mono text-utility-mono">{event.venue}</p>
            </div>
            <div>
              <p className="mb-1 font-section-label text-section-label uppercase text-outline-variant">Availability · on-chain</p>
              <p className="font-mono text-utility-mono">
                {remaining === undefined
                  ? "UNAVAILABLE"
                  : `${remaining.toLocaleString()} / ${maxTickets.toLocaleString()} REMAINING`}
              </p>
              {soldPct !== undefined && (
                <div
                  role="progressbar"
                  aria-label="Tickets sold"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(soldPct)}
                  className="mt-2 h-2 w-full border border-outline-variant bg-[#e6e2d7]"
                >
                  <div className="h-full bg-primary-container transition-all duration-700" style={{ width: `${soldPct}%` }} />
                </div>
              )}
              {page.data.chainError && (
                <p role="status" className="status-message status-warning mt-2 font-body text-utility-sm">
                  Chain availability could not be verified: {page.data.chainError}
                </p>
              )}
            </div>
            <div>
              <p className="mb-1 font-section-label text-section-label uppercase text-outline-variant">Organizer</p>
              <p className="font-mono text-utility-mono" title={event.organizerPubkey}>
                {shortAddress(event.organizerPubkey)}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="font-section-label text-section-label uppercase text-outline-variant">On-chain resale cap</p>
              <p className="mt-1 font-mono text-utility-mono">
                {resaleCapBps === undefined ? "UNAVAILABLE" : `${percent(resaleCapBps)} of face value`}
              </p>
            </div>
            <div>
              <p className="font-section-label text-section-label uppercase text-outline-variant">Organizer royalty</p>
              <p className="mt-1 font-mono text-utility-mono">
                {royaltyBps === undefined ? "UNAVAILABLE" : `${percent(royaltyBps)} on resale`}
              </p>
            </div>
          </div>

          {facePriceLamports && maxResale && (
            <div className="mt-6 flex items-center gap-3 border border-dashed border-outline-variant p-4 font-mono text-utility-sm" aria-label="Price ladder from face value to maximum resale price">
              <div>
                <p className="font-section-label text-section-label uppercase text-outline-variant">Face</p>
                <p className="font-bold">{formatSol(facePriceLamports)}</p>
              </div>
              <div className="relative h-px flex-1 border-t-2 border-dashed border-outline-variant" aria-hidden="true">
                <span className="material-symbols-outlined absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#f4ebd0] px-1 text-base">lock</span>
              </div>
              <div className="text-right">
                <p className="font-section-label text-section-label uppercase text-outline-variant">Highest resale</p>
                <p className="font-bold">{formatSol(maxResale)}</p>
              </div>
            </div>
          )}
        </article>

        <aside className="relative flex w-full flex-col justify-between border-t-2 border-dashed border-outline-variant bg-[#f0ebd9] p-6 sm:p-stub-padding lg:w-[22rem] lg:border-l-2 lg:border-t-0">
          <Notches />
          <div>
            <div className="mb-8 flex items-start justify-between gap-3">
              <span className="font-section-label text-section-label uppercase tracking-widest text-outline-variant">Admit one</span>
              <span className="flex items-center gap-1 rounded bg-tertiary/20 px-2 py-1 font-mono text-utility-sm font-bold text-on-tertiary-container">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">verified</span>
                ON-CHAIN
              </span>
            </div>
            <p className="mb-2 font-section-label text-section-label uppercase text-outline-variant">General admission</p>
            <div className="space-y-3 border border-outline-variant p-3 font-mono text-utility-sm">
              <div className="flex justify-between gap-4">
                <span>Face price</span>
                <span>{facePriceLamports ? formatSol(facePriceLamports) : "Unavailable"}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>Platform fee {page.data.platform ? `(${percent(page.data.platform.platformFeeBps)})` : ""}</span>
                <span>{primaryFee === undefined ? "Unavailable" : formatSol(primaryFee.toString())}</span>
              </div>
            </div>
            {page.data.platformError && (
              <p role="alert" className="status-message status-error mt-2 font-body text-utility-sm">
                Platform fee unavailable: {page.data.platformError}
              </p>
            )}
            <div className="mt-6 flex items-start gap-3 border border-primary-container bg-primary-container/20 p-3 text-on-primary-container">
              <span className="material-symbols-outlined mt-0.5" aria-hidden="true">info</span>
              <div>
                <p className="font-section-label text-section-label uppercase">Resale capped</p>
                <p className="mt-1 font-mono text-utility-sm">
                  {resaleCapBps === undefined || royaltyBps === undefined
                    ? "On-chain resale terms are unavailable."
                    : `Secondary price is capped at ${percent(resaleCapBps)}. The organizer receives ${percent(royaltyBps)} royalty on resale.`}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-dashed border-outline-variant pt-6">
            <div className="mb-5 flex items-end justify-between gap-3">
              <span className="font-section-label text-section-label uppercase text-outline-variant">Total before network costs</span>
              <span className="font-display text-headline-lg-mobile leading-none">{total === undefined ? "—" : formatSol(total)}</span>
            </div>
            <button
              type="button"
              disabled={!canBuy}
              onClick={() => void preparePrimary()}
              className="marquee-glow w-full bg-primary-container px-4 py-4 font-mono text-utility-mono font-bold text-on-primary-container transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {tx.busy ? "TRANSACTION IN PROGRESS…" : remaining === 0 ? "SOLD OUT" : "GET TICKET"}
            </button>
            <p className="mt-3 text-center font-mono text-utility-sm text-outline-variant">
              Face price + platform fee. Network and rent costs may also apply; approve in Phantom.
            </p>
            {page.data.platform && (
              <p className="mt-2 break-all text-center font-mono text-[10px] text-outline-variant">
                Fee wallet · {shortAddress(page.data.platform.platformWallet)}
              </p>
            )}
            {page.data.listingsError && (
              <p role="status" className="status-message status-warning mt-3 font-body text-utility-sm">
                Resale listings could not load: {page.data.listingsError}
              </p>
            )}
            <TransactionPanel state={tx.state} onSend={() => void signAndSend()} onReset={tx.reset} />
          </div>
        </aside>
      </div>

      <section className="mt-12" aria-labelledby="listings-heading">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-dashed border-outline-variant pb-4">
          <div>
            <p className="font-section-label text-section-label uppercase tracking-widest text-primary">Secondary market</p>
            <h2 id="listings-heading" className="mt-1 font-display text-headline-lg uppercase text-on-surface">
              Active resale listings
            </h2>
          </div>
          <span className="font-mono text-utility-sm text-on-surface-variant">
            {page.data.listingsError ? "UNAVAILABLE" : `${listings.length} ${listings.length === 1 ? "LISTING" : "LISTINGS"} · CHEAPEST FIRST`}
          </span>
        </header>
        <div className="ticket-paper rounded border border-outline-variant px-5 text-background sm:px-8">
          {page.data.listingsError && (
            <p role="status" className="status-message status-warning my-3 font-body text-body-md">
              Resale listings could not load: {page.data.listingsError}
            </p>
          )}
          {!page.data.listingsError && listings.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <span className="material-symbols-outlined text-4xl text-outline" aria-hidden="true">sell</span>
              <p className="font-body text-body-md">No active resale listings for this event.</p>
            </div>
          )}
          {listings.map((listing) => (
            <ResaleListing
              key={listing.mintAddress}
              listing={listing}
              royaltyBps={royaltyBps ?? 0}
              feeBps={page.data.platform?.platformFeeBps ?? 0}
              disabled={!page.data.platform || royaltyBps === undefined}
              busy={tx.busy}
              onBuy={(selected) => void prepareResale(selected)}
            />
          ))}
          {page.data.listings && listings.length > 0 && (
            <p className="border-t border-dashed border-outline-variant py-3 font-mono text-[10px] text-outline-variant">
              * Platform fee is shown separately. Final debits are shown in Phantom. Listings reflect the current backend ticket index.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
