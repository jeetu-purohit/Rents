import { useEffect, useState } from "react";
import type { EventDto } from "shared";
import { ApiError, api } from "../lib/api";

type EventsState =
  | { status: "loading" }
  | { status: "success"; events: EventDto[] }
  | { status: "error"; message: string };

function formatPrice(lamports: string): string {
  const amount = BigInt(lamports);
  const whole = amount / 1_000_000_000n;
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} SOL`;
}

function formatEventDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.toUpperCase();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(date)
    .toUpperCase();
}

function capLabel(resaleCapBps: number): string {
  const percentage = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    resaleCapBps / 100,
  );
  return `${percentage}% CAP`;
}

function EventCard({ event, index }: { event: EventDto; index: number }) {
  return (
    <a
      href={`/events/${encodeURIComponent(event._id)}`}
      aria-label={`View details for ${event.name}`}
      className="group relative block min-h-[500px] overflow-hidden border border-outline-variant bg-inverse-surface text-background shadow-marquee-soft transition-all duration-500 hover:-translate-y-2 hover:border-primary/60 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {/* Ticket side notches */}
      <span
        className="absolute -left-2 top-[56%] z-20 h-5 w-5 rounded-full border border-outline-variant bg-background"
        aria-hidden="true"
      />
      <span
        className="absolute -right-2 top-[56%] z-20 h-5 w-5 rounded-full border border-outline-variant bg-background"
        aria-hidden="true"
      />

      <article className="ticket-stub relative flex h-full flex-col">
        {/* Image / poster */}
        <div className="relative h-64 shrink-0 overflow-hidden border-b-2 border-dashed border-outline-variant bg-background">
          <div
            className="absolute inset-0 flex items-center justify-center bg-surface-container-high text-outline"
            aria-hidden="true"
          >
            <span className="material-symbols-outlined text-6xl opacity-70">
              confirmation_number
            </span>
          </div>

          {event.imageUrl && (
            <img
              className="relative h-full w-full object-cover grayscale transition-all duration-700 group-hover:scale-[1.04] group-hover:grayscale-0"
              src={event.imageUrl}
              alt=""
              loading="lazy"
              onError={(image) => {
                image.currentTarget.hidden = true;
              }}
            />
          )}

          <div
            className="pointer-events-none absolute inset-0 opacity-80 mix-blend-multiply"
            style={{
              backgroundImage:
                "linear-gradient(180deg, transparent 30%, rgba(0,0,0,.72) 100%), repeating-linear-gradient(0deg, transparent 0, transparent 3px, rgba(255,255,255,.045) 4px)",
            }}
            aria-hidden="true"
          />

          <div className="absolute left-4 top-4 flex items-center gap-2">
            <span className="border border-background/30 bg-black/55 px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-background backdrop-blur-sm">
              RENTS / EVENT
            </span>
          </div>

          <span className="absolute right-4 top-4 border border-primary/40 bg-primary-container px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-on-primary-container shadow-marquee">
            {capLabel(event.resaleCapBps)}
          </span>

          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4">
            <div className="max-w-[75%]">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-background/65">
                Admit One · Digital Ticket
              </span>
              <div className="mt-2 h-px w-16 bg-primary" />
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-background/60">
              {String(index + 1).padStart(2, "0")}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="flex flex-1 flex-col p-5 sm:p-6">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="h-1.5 w-1.5 bg-primary" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.19em] text-primary">
                Verified listing
              </span>
            </div>

            <h2 className="mb-5 line-clamp-2 font-display text-3xl uppercase leading-[0.92] tracking-tight text-background sm:text-4xl">
              {event.name}
            </h2>

            <div className="space-y-3 border-y border-dashed border-background/15 py-4">
              <p className="flex items-start gap-2.5 font-section-label text-section-label uppercase text-background/75">
                <span className="material-symbols-outlined mt-0.5 text-[15px] text-primary" aria-hidden="true">
                  calendar_month
                </span>
                <span>{formatEventDate(event.date)}</span>
              </p>
              <p className="flex min-w-0 items-start gap-2.5 font-section-label text-section-label uppercase text-background/75">
                <span className="material-symbols-outlined mt-0.5 text-[15px] text-primary" aria-hidden="true">
                  location_on
                </span>
                <span className="line-clamp-1">{event.venue}</span>
              </p>
            </div>
          </div>

          <div className="mt-auto flex items-end justify-between gap-4 pt-6">
            <div>
              <p className="font-section-label text-[9px] uppercase tracking-[0.14em] text-background/45">
                Starting from
              </p>
              <p className="mt-1 font-mono text-sm font-bold text-background sm:text-base">
                {formatPrice(event.basePriceLamports)}
              </p>
            </div>

            <span className="flex shrink-0 items-center gap-2 bg-background px-3.5 py-2 font-section-label text-[10px] font-bold uppercase tracking-wider text-inverse-surface transition-all duration-300 group-hover:bg-primary group-hover:text-on-primary-container">
              View
              <span
                className="material-symbols-outlined text-sm transition-transform duration-300 group-hover:translate-x-1"
                aria-hidden="true"
              >
                arrow_forward
              </span>
            </span>
          </div>
        </div>
      </article>
    </a>
  );
}

function EventSkeleton() {
  return (
    <div className="overflow-hidden border border-outline-variant bg-inverse-surface/10" aria-hidden="true">
      <div className="h-64 animate-pulse border-b-2 border-dashed border-outline-variant bg-surface-container-high" />
      <div className="flex min-h-[236px] flex-col gap-4 p-5">
        <div className="h-3 w-28 animate-pulse bg-surface-container-high" />
        <div className="h-10 w-4/5 animate-pulse bg-surface-container-high" />
        <div className="h-8 w-full animate-pulse bg-surface-container-high" />
        <div className="mt-auto h-9 w-1/2 animate-pulse bg-surface-container-high" />
      </div>
    </div>
  );
}

export function ExploreEventsPage() {
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<EventsState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    api
      .getEvents()
      .then((events) => {
        if (active) setState({ status: "success", events });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof ApiError
            ? `${error.message} (${error.code})`
            : "We could not load events right now. Please try again.";
        setState({ status: "error", message });
      });
    return () => {
      active = false;
    };
  }, [retry]);

  const eventCount = state.status === "success" ? state.events.length : 0;

  return (
    <section className="relative mx-auto flex w-full max-w-[1440px] flex-1 overflow-hidden px-4 pb-20 sm:px-6 lg:px-8">
      {/* Background registration grid */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-40 top-10 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-40 top-[28rem] h-[34rem] w-[34rem] rounded-full bg-primary/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <div className="w-full">
        <header className="relative mb-10 overflow-hidden border border-outline-variant bg-surface-container shadow-marquee-soft">
          <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />

          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end lg:p-10">
            <div>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
                  <span className="h-1.5 w-1.5 bg-primary" />
                  Public manifest
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-on-surface-variant">
                  Solana / RENTS
                </span>
              </div>

              <p className="mb-2 font-section-label text-[10px] font-bold uppercase tracking-[0.23em] text-primary">
                Find the room. Keep the ticket.
              </p>

              <h1 className="font-display text-5xl uppercase leading-[0.86] tracking-tight text-on-surface sm:text-7xl lg:text-[7rem]">
                Upcoming
                <br />
                <span className="text-primary">Events</span>
              </h1>

              <p className="mt-5 max-w-2xl font-mono text-[10px] uppercase leading-relaxed tracking-[0.07em] text-on-surface-variant sm:text-xs">
                Discover and secure authentic tickets on Solana — with transparent pricing,
                verifiable ownership, and resale rules written into the ticket.
              </p>
            </div>

            <div className="grid w-full max-w-xs grid-cols-2 border border-outline-variant bg-background/50 sm:max-w-sm">
              <div className="border-r border-dashed border-outline-variant p-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-on-surface-variant">
                  Manifest
                </p>
                <p className="mt-1 font-display text-4xl text-on-surface">
                  {state.status === "success" ? String(eventCount).padStart(2, "0") : "—"}
                </p>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-wider text-primary">
                  Listed events
                </p>
              </div>
              <div className="p-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-on-surface-variant">
                  Network
                </p>
                <p className="mt-1 font-display text-4xl text-on-surface">01</p>
                <p className="mt-1 font-mono text-[8px] uppercase tracking-wider text-primary">
                  Solana
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 border-t border-dashed border-outline-variant sm:grid-cols-4">
            {[
              ["01", "DISCOVER", "Find your next room"],
              ["02", "VERIFY", "Know what you own"],
              ["03", "COLLECT", "Keep your ticket"],
              ["04", "ATTEND", "Show up"],
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
                <p className="mt-1 hidden font-mono text-[8px] uppercase text-on-surface-variant sm:block">
                  {caption}
                </p>
              </div>
            ))}
          </div>
        </header>

        {state.status === "loading" && (
          <div
            role="status"
            aria-label="Loading events"
            className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <EventSkeleton key={index} />
            ))}
          </div>
        )}

        {state.status === "error" && (
          <div
            role="alert"
            className="relative overflow-hidden border border-dashed border-outline-variant bg-inverse-surface p-8 text-center text-background sm:p-14"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />
            <div className="mx-auto flex max-w-2xl flex-col items-center">
              <div className="flex h-16 w-16 items-center justify-center border border-primary/30 bg-primary/10">
                <span
                  className="material-symbols-outlined text-3xl text-primary"
                  aria-hidden="true"
                >
                  cloud_off
                </span>
              </div>
              <p className="mt-5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
                Manifest temporarily closed
              </p>
              <h2 className="mt-2 font-display text-4xl uppercase leading-none sm:text-5xl">
                Events are unavailable
              </h2>
              <p className="mt-4 max-w-lg font-body text-body-md text-background/70">
                {state.message}
              </p>
              <button
                type="button"
                onClick={() => setRetry((count) => count + 1)}
                className="mt-7 inline-flex items-center gap-2 bg-background px-5 py-3 font-section-label text-section-label uppercase text-inverse-surface transition-transform hover:-translate-y-0.5 hover:bg-surface-variant"
              >
                Try again
                <span className="material-symbols-outlined text-sm" aria-hidden="true">refresh</span>
              </button>
            </div>
          </div>
        )}

        {state.status === "success" &&
          (state.events.length === 0 ? (
            <div className="relative overflow-hidden border border-dashed border-outline-variant bg-surface-container p-10 text-center sm:p-16">
              <div className="absolute inset-x-0 top-0 flex justify-center gap-2" aria-hidden="true">
                <span className="h-1 w-8 bg-primary" />
                <span className="h-1 w-2 bg-outline-variant" />
                <span className="h-1 w-2 bg-outline-variant" />
              </div>
              <span
                className="material-symbols-outlined text-6xl text-outline"
                aria-hidden="true"
              >
                confirmation_number
              </span>
              <p className="mt-5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
                Manifest empty
              </p>
              <h2 className="mt-2 font-display text-4xl uppercase text-on-surface sm:text-5xl">
                No events on the manifest
              </h2>
              <p className="mx-auto mt-3 max-w-lg font-body text-body-md text-on-surface-variant">
                There are no events listed right now. Check back soon for the next opening.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {state.events.map((event, index) => (
                <EventCard key={event._id} event={event} index={index} />
              ))}
            </div>
          ))}
      </div>
    </section>
  );
}
