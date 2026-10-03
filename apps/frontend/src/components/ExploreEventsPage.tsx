import { useEffect, useState } from 'react'
import type { EventDto } from 'shared'
import { ApiError, api } from '../lib/api'

type EventsState =
  | { status: 'loading' }
  | { status: 'success'; events: EventDto[] }
  | { status: 'error'; message: string }

function formatPrice(lamports: string): string {
  const amount = BigInt(lamports)
  const whole = amount / 1_000_000_000n
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`
}

function formatEventDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.toUpperCase()
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date).toUpperCase()
}

function capLabel(resaleCapBps: number): string {
  const percentage = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(resaleCapBps / 100)
  return `${percentage}% CAP`
}

function EventCard({ event }: { event: EventDto }) {
  return (
    <a
      href={`/events/${encodeURIComponent(event._id)}`}
      aria-label={`View details for ${event.name}`}
      className="group flex min-h-[430px] flex-col overflow-hidden rounded-lg bg-inverse-surface text-background transition-transform duration-200 hover:-translate-y-1"
    >
      <article className="ticket-stub flex h-full flex-col">
        <div className="relative h-48 shrink-0 border-b-2 border-dashed border-outline-variant bg-background">
          <div className="absolute inset-0 flex items-center justify-center bg-surface-container-high text-outline" aria-hidden="true">
            <span className="material-symbols-outlined text-5xl">confirmation_number</span>
          </div>
          {event.imageUrl && (
            <img
              className="relative h-full w-full object-cover grayscale transition-all duration-300 group-hover:grayscale-0"
              src={event.imageUrl}
              alt=""
              loading="lazy"
              onError={(image) => { image.currentTarget.hidden = true }}
            />
          )}
          <span className="absolute right-2 top-2 rounded bg-primary-container px-2 py-1 font-mono text-utility-sm font-bold text-on-primary-container shadow-sm">
            {capLabel(event.resaleCapBps)}
          </span>
        </div>
        <div className="flex flex-1 flex-col justify-between p-4">
          <div>
            <h2 className="mb-3 line-clamp-2 font-display text-headline-lg-mobile leading-none uppercase tracking-tight text-background">
              {event.name}
            </h2>
            <div className="mb-4 space-y-1 border-b border-dashed border-background/20 pb-4">
              <p className="flex items-center gap-1 font-section-label text-section-label uppercase text-background/70">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">calendar_month</span>
                {formatEventDate(event.date)}
              </p>
              <p className="flex items-center gap-1 font-section-label text-section-label uppercase text-background/70">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">location_on</span>
                <span className="line-clamp-1">{event.venue}</span>
              </p>
            </div>
          </div>
          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            <div>
              <p className="font-section-label text-section-label uppercase text-background/50">Starting From</p>
              <p className="font-mono text-utility-mono font-bold text-background">{formatPrice(event.basePriceLamports)}</p>
            </div>
            <span className="shrink-0 rounded bg-background px-3 py-1 font-section-label text-section-label uppercase text-inverse-surface transition-colors group-hover:bg-surface-variant">
              View Details
            </span>
          </div>
        </div>
      </article>
    </a>
  )
}

function EventSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg bg-inverse-surface/10" aria-hidden="true">
      <div className="h-48 animate-pulse border-b-2 border-dashed border-outline-variant bg-surface-container-high" />
      <div className="flex min-h-[230px] flex-col gap-4 p-4">
        <div className="h-8 w-3/4 animate-pulse rounded-sm bg-surface-container-high" />
        <div className="h-4 w-full animate-pulse rounded-sm bg-surface-container-high" />
        <div className="mt-auto h-8 w-1/2 animate-pulse rounded-sm bg-surface-container-high" />
      </div>
    </div>
  )
}

export function ExploreEventsPage() {
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<EventsState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    api.getEvents().then((events) => {
      if (active) setState({ status: 'success', events })
    }).catch((error: unknown) => {
      if (!active) return
      const message = error instanceof ApiError
        ? `${error.message} (${error.code})`
        : 'We could not load events right now. Please try again.'
      setState({ status: 'error', message })
    })
    return () => { active = false }
  }, [retry])

  return (
    <section className="mx-auto w-full max-w-[1440px] flex-1">
      <header className="mb-12 border-b border-dashed border-outline-variant pb-8">
        <h1 className="mb-2 font-display text-headline-xl uppercase text-primary">Upcoming Events</h1>
        <p className="font-mono text-utility-mono text-on-surface-variant">Discover and secure authentic tickets on Solana.</p>
      </header>

      {state.status === 'loading' && (
        <div role="status" aria-label="Loading events" className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <EventSkeleton key={index} />)}
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="ticket-paper flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-stub-padding text-center text-background">
          <span className="material-symbols-outlined text-4xl text-error-container" aria-hidden="true">cloud_off</span>
          <h2 className="font-display text-headline-lg uppercase">Events are unavailable</h2>
          <p className="max-w-lg font-body text-body-md">{state.message}</p>
          <button type="button" onClick={() => setRetry((count) => count + 1)} className="rounded bg-background px-4 py-2 font-section-label text-section-label uppercase text-inverse-surface hover:bg-surface-variant">
            Try again
          </button>
        </div>
      )}

      {state.status === 'success' && (state.events.length === 0 ? (
        <div className="ticket-paper flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-stub-padding text-center text-background">
          <span className="material-symbols-outlined text-4xl text-outline" aria-hidden="true">confirmation_number</span>
          <h2 className="font-display text-headline-lg uppercase">No events on the manifest</h2>
          <p className="max-w-lg font-body text-body-md">There are no events listed right now. Check back soon.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {state.events.map((event) => <EventCard key={event._id} event={event} />)}
        </div>
      ))}
    </section>
  )
}
