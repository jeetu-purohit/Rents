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
      className="event-card group relative block overflow-hidden border border-outline-variant/80 bg-inverse-surface text-background shadow-lg shadow-black/15 transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1.5 hover:border-primary/70 hover:shadow-xl hover:shadow-black/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      style={{ animationDelay: `${Math.min(index, 8) * 65}ms` }}
    >
      <article className="ticket-stub flex h-full min-h-[430px] flex-col">
        <div className="relative h-56 shrink-0 overflow-hidden border-b-2 border-dashed border-outline-variant bg-surface-container-high sm:h-60">
          <div
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-container-high to-background text-outline"
            aria-hidden="true"
          >
            <span className="material-symbols-outlined text-6xl opacity-60">
              confirmation_number
            </span>
          </div>

          {event.imageUrl && (
            <img
              className="relative h-full w-full object-cover grayscale transition-[filter,transform] duration-500 group-hover:scale-[1.04] group-hover:grayscale-0"
              src={event.imageUrl}
              alt={`${event.name} event artwork`}
              loading="lazy"
              onError={(image) => {
                image.currentTarget.hidden = true;
              }}
            />
          )}

          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-black/25"
            aria-hidden="true"
          />

          <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-3">
            <span className="border border-white/25 bg-black/45 px-2.5 py-1.5 font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-white/90 backdrop-blur-sm">
              Event · {String(index + 1).padStart(2, "0")}
            </span>
            <span className="border border-primary/40 bg-primary-container px-2.5 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-on-primary-container shadow-marquee">
              {capLabel(event.resaleCapBps)}
            </span>
          </div>

          <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-4 text-white">
            <div>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/65">
                RENTS · SOLANA TICKETING
              </span>
              <div className="mt-2 h-px w-12 bg-primary" />
            </div>
            <span
              className="material-symbols-outlined text-xl text-primary/90 transition-transform duration-300 group-hover:translate-x-1"
              aria-hidden="true"
            >
              arrow_outward
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-col p-5 sm:p-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 bg-primary" aria-hidden="true" />
            <span className="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-on-background/55">
              Event details
            </span>
          </div>

          <h2 className="line-clamp-2 min-h-[3.7rem] font-display text-3xl uppercase leading-[0.95] tracking-tight text-background sm:text-[2rem]">
            {event.name}
          </h2>

          <div className="mt-4 space-y-3 border-y border-dashed border-background/15 py-4">
            <p className="flex items-start gap-2.5 font-section-label text-[10px] uppercase leading-relaxed tracking-[0.1em] text-background/70">
              <span className="material-symbols-outlined mt-0.5 text-[15px] text-primary" aria-hidden="true">
                calendar_month
              </span>
              <span>{formatEventDate(event.date)}</span>
            </p>
            <p className="flex min-w-0 items-start gap-2.5 font-section-label text-[10px] uppercase leading-relaxed tracking-[0.1em] text-background/70">
              <span className="material-symbols-outlined mt-0.5 text-[15px] text-primary" aria-hidden="true">
                location_on
              </span>
              <span className="line-clamp-1">{event.venue}</span>
            </p>
          </div>

          <div className="mt-auto flex items-end justify-between gap-3 pt-5">
            <div className="min-w-0">
              <p className="font-section-label text-[9px] uppercase tracking-[0.15em] text-background/50">
                Starting from
              </p>
              <p className="mt-1 truncate font-mono text-sm font-bold text-background sm:text-base">
                {formatPrice(event.basePriceLamports)}
              </p>
            </div>

            <span className="flex shrink-0 items-center gap-2 bg-background px-3.5 py-2.5 font-section-label text-[10px] font-bold uppercase tracking-[0.12em] text-inverse-surface transition-colors duration-200 group-hover:bg-primary group-hover:text-on-primary-container">
              Explore
              <span
                className="material-symbols-outlined text-sm transition-transform duration-200 group-hover:translate-x-0.5"
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
    <div className="overflow-hidden border border-outline-variant/70 bg-inverse-surface/10" aria-hidden="true">
      <div className="h-56 animate-pulse border-b-2 border-dashed border-outline-variant bg-surface-container-high sm:h-60" />
      <div className="flex min-h-[230px] flex-col gap-4 p-5 sm:p-6">
        <div className="h-2.5 w-24 animate-pulse bg-surface-container-high" />
        <div className="h-9 w-4/5 animate-pulse bg-surface-container-high" />
        <div className="h-14 w-full animate-pulse bg-surface-container-high" />
        <div className="mt-auto h-8 w-1/2 animate-pulse bg-surface-container-high" />
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
    <section className="relative mx-auto w-full max-w-[1440px] flex-1 overflow-hidden pb-20">
      <style>{`
        @keyframes rents-event-enter {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .event-card { animation: rents-event-enter 520ms cubic-bezier(.2,.75,.25,1) both; }
        @media (prefers-reduced-motion: reduce) {
          .event-card { animation: none; transition-duration: 0.01ms; }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-48 top-8 h-96 w-96 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute -right-48 top-[32rem] h-[34rem] w-[34rem] rounded-full bg-primary/7 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <header className="relative mb-8 overflow-hidden border border-outline-variant/80 bg-surface-container shadow-marquee-soft sm:mb-10">
        <div className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />

        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:p-10">
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 border border-primary/35 bg-primary/10 px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-primary">
                <span className="h-1.5 w-1.5 bg-primary" aria-hidden="true" />
                Explore the calendar
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-on-surface-variant">
                RENTS / SOLANA
              </span>
            </div>

            <p className="mb-2 font-section-label text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
              Find your next room
            </p>
            <h1 className="font-display text-[clamp(3.5rem,9vw,7.5rem)] uppercase leading-[0.82] tracking-tight text-on-surface">
              Upcoming
              <br />
              <span className="text-primary">Events</span>
            </h1>
            <p className="mt-5 max-w-2xl font-mono text-[10px] uppercase leading-relaxed tracking-[0.07em] text-on-surface-variant sm:text-xs">
              Discover events and secure your ticket with transparent pricing and resale terms.
            </p>
          </div>

          <div className="grid w-full max-w-sm grid-cols-2 border border-outline-variant/80 bg-background/40 lg:w-72">
            <div className="border-r border-dashed border-outline-variant p-4 sm:p-5">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">
                On the calendar
              </p>
              <p className="mt-1 font-display text-5xl leading-none text-on-surface">
                {state.status === "success" ? String(eventCount).padStart(2, "0") : "—"}
              </p>
              <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-primary">
                {state.status === "loading" ? "Loading" : eventCount === 1 ? "Event" : "Events"}
              </p>
            </div>
            <div className="p-4 sm:p-5">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-on-surface-variant">
                Ticket rules
              </p>
              <span className="material-symbols-outlined mt-1 block text-4xl leading-none text-primary" aria-hidden="true">
                verified_user
              </span>
              <p className="mt-2 font-mono text-[8px] uppercase tracking-[0.12em] text-on-surface-variant">
                Program enforced
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-dashed border-outline-variant sm:grid-cols-4">
          {[
            ["01", "DISCOVER", "Browse events"],
            ["02", "CHECK TERMS", "See resale limits"],
            ["03", "COLLECT", "Hold your ticket"],
            ["04", "SHOW UP", "Scan at entry"],
          ].map(([number, title, caption]) => (
            <div
              key={number}
              className="border-r border-dashed border-outline-variant px-4 py-3 last:border-r-0 sm:px-5"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] text-primary">{number}</span>
                <span className="font-section-label text-[9px] font-bold uppercase tracking-[0.14em] text-on-surface">
                  {title}
                </span>
              </div>
              <p className="mt-1 hidden font-mono text-[8px] uppercase tracking-wide text-on-surface-variant sm:block">
                {caption}
              </p>
            </div>
          ))}
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-dashed border-outline-variant/80 pb-4">
        <div>
          <p className="font-section-label text-[9px] font-bold uppercase tracking-[0.2em] text-primary">
            Browse the manifest
          </p>
          <h2 className="mt-1 font-display text-3xl uppercase leading-none text-on-surface sm:text-4xl">
            Find an event
          </h2>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-on-surface-variant">
          {state.status === "success"
            ? `${eventCount} ${eventCount === 1 ? "event" : "events"} listed`
            : state.status === "loading"
              ? "Updating listings"
              : "Listings unavailable"}
        </span>
      </div>

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
              <span className="material-symbols-outlined text-3xl text-error-container" aria-hidden="true">
                cloud_off
              </span>
            </div>
            <p className="mt-5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-error-container">
              Manifest temporarily unavailable
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
              className="mt-7 inline-flex items-center gap-2 bg-background px-5 py-3 font-section-label text-section-label uppercase text-inverse-surface transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-inverse-surface"
            >
              Try again
              <span className="material-symbols-outlined text-sm" aria-hidden="true">
                refresh
              </span>
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
              The calendar is clear
            </p>
            <h2 className="mt-2 font-display text-4xl uppercase text-on-surface sm:text-5xl">
              No events listed yet
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
    </section>
  );
}
