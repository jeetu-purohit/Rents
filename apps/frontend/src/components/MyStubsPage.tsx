import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { QRCodeSVG } from 'qrcode.react'
import type { EventDto, TicketDto } from 'shared'
import { ApiError, api } from '../lib/api'
import { useSendBuilderTx } from '../hooks/useSendBuilderTx'

type TicketState =
  | { status: 'disconnected' }
  | { status: 'loading'; owner: string }
  | { status: 'error'; owner: string; message: string }
  | { status: 'ready'; owner: string; tickets: TicketDto[]; events: Record<string, EventDto>; eventsError?: string }

function shortAddress(value: string): string {
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

function formatSol(lamports: string): string {
  const amount = BigInt(lamports)
  const whole = amount / 1_000_000_000n
  const fraction = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.toUpperCase()
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date).toUpperCase()
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.code})`
  return error instanceof Error ? error.message : 'Tickets could not be loaded right now.'
}

function qrPayload(ticket: TicketDto, connectedOwner: string): string {
  return JSON.stringify({
    mint: ticket.mintAddress,
    owner: connectedOwner,
    eventPda: ticket.eventPda,
  })
}

function StatusChips({ ticket }: { ticket: TicketDto }) {
  const isListed = ticket.listingPriceLamports !== undefined
  const statuses = ticket.isCheckedIn ? ['USED'] : ['VALID', ...(isListed ? ['LISTED'] : [])]
  return <div aria-label="Ticket status" className="flex flex-wrap gap-2">
    {statuses.map((status) => <span key={status} className={`border px-2 py-1 font-mono text-utility-sm font-bold ${status === 'USED' ? 'border-error-container bg-error-container/10 text-error-container' : status === 'LISTED' ? 'border-primary-container bg-primary-container text-on-primary-container' : 'border-tertiary-container bg-tertiary/20 text-on-tertiary-container'}`}>
      {status === 'USED' ? 'USED' : status === 'LISTED' ? 'LISTED' : 'VALID'}
    </span>)}
  </div>
}

function TicketCard({ ticket, event, owner, busy, onCancel }: { ticket: TicketDto; event?: EventDto; owner: string; busy: boolean; onCancel: (ticket: TicketDto) => void }) {
  const used = ticket.isCheckedIn
  const listed = ticket.listingPriceLamports !== undefined
  return <article className="ticket-card relative flex min-h-56 flex-col overflow-hidden rounded-sm border border-outline-variant bg-[#f4ebd0] text-background shadow-sm transition-transform duration-300 hover:-translate-y-1 md:flex-row">
    <div className="perforated-edge-right relative flex min-w-0 flex-1 flex-col justify-between gap-8 p-6 sm:p-stub-padding">
      <div className="absolute right-4 top-4 flex max-w-[65%] flex-wrap justify-end gap-2 sm:right-6 sm:top-6">
        <StatusChips ticket={ticket} />
      </div>
      <div className="pr-2 sm:pr-32">
        <p className="mb-2 font-section-label text-section-label uppercase tracking-widest text-outline-variant">Verified stub // {shortAddress(ticket.ticketPda)}</p>
        <h2 className="mb-2 break-words font-display text-headline-lg-mobile uppercase leading-tight sm:text-headline-lg">{event?.name ?? `Event ${shortAddress(ticket.eventPda)}`}</h2>
        {event ? <>
          <p className="font-mono text-utility-sm text-surface-variant">{formatDate(event.date)}</p>
          <p className="font-mono text-utility-sm text-surface-variant">{event.venue}</p>
        </> : <p className="font-mono text-utility-sm text-surface-variant">Event metadata is not available.</p>}
      </div>
      <div className="grid gap-4 border-t-2 border-dotted border-outline-variant pt-3 sm:grid-cols-2">
        <div><p className="font-section-label text-section-label uppercase text-outline-variant">Admit one · face value</p><p className="font-mono text-utility-mono font-bold">{formatSol(ticket.faceValueLamports)}</p></div>
        <div><p className="font-section-label text-section-label uppercase text-outline-variant">Ticket mint</p><p className="break-all font-mono text-utility-sm" title={ticket.mintAddress}>{shortAddress(ticket.mintAddress)}</p></div>
      </div>
    </div>

    <aside className="relative flex w-full flex-col items-center justify-between border-t border-dashed border-outline-variant bg-[#e6e2d7] p-5 md:w-64 md:border-l md:border-t-0">
      <div className="mb-4 w-full border-b border-dashed border-outline pb-3 text-center">
        <p className="font-section-label text-section-label uppercase tracking-widest text-outline-variant">Gate scan</p>
      </div>
      <div className="border border-black bg-white p-2">
        <QRCodeSVG
          value={qrPayload(ticket, owner)}
          size={144}
          level="M"
          bgColor="#ffffff"
          fgColor="#12131a"
          title={`Check-in QR for ${event?.name ?? 'ticket'}`}
        />
      </div>
      <p className="mt-3 text-center font-mono text-[10px] leading-4 text-outline-variant">Show this code at the event entrance.<br/>Ticket cache synced {formatDate(ticket.lastSyncedAt)}</p>
    </aside>
    {!used && <footer className="flex w-full flex-col justify-center gap-3 border-t border-dashed border-outline-variant bg-[#e6e2d7] p-5 sm:flex-row md:w-56 md:border-l md:border-t-0">
      {listed ? <>
        <div className="text-center sm:text-left md:text-center"><p className="font-section-label text-section-label uppercase text-outline-variant">Listed for</p><p className="font-mono text-utility-mono font-bold">{formatSol(ticket.listingPriceLamports!)}</p></div>
        <button type="button" disabled={busy} onClick={() => onCancel(ticket)} className="bg-background px-4 py-3 font-section-label text-section-label uppercase text-inverse-surface hover:bg-surface-container-high disabled:cursor-wait disabled:opacity-50">{busy ? 'PREPARING…' : 'CANCEL LISTING'}</button>
      </> : <a href={`/my-tickets/${encodeURIComponent(ticket.mintAddress)}/resell`} className="bg-primary-container px-4 py-3 text-center font-section-label text-section-label uppercase text-on-primary-container hover:brightness-110">List for resale</a>}
    </footer>}
  </article>
}

function TicketSkeleton() {
  return <div aria-hidden="true" className="flex min-h-56 animate-pulse flex-col overflow-hidden border border-outline-variant bg-surface-container md:flex-row">
    <div className="flex-1 space-y-4 p-6 sm:p-stub-padding"><div className="h-4 w-40 bg-surface-container-high"/><div className="h-9 w-2/3 bg-surface-container-high"/><div className="mt-10 h-10 w-full bg-surface-container-high"/></div>
    <div className="h-52 w-full border-t border-outline-variant bg-surface-container-high md:h-auto md:w-64 md:border-l md:border-t-0"/>
  </div>
}

export function MyStubsPage() {
  const { publicKey } = useWallet()
  const owner = publicKey?.toBase58()
  const tx = useSendBuilderTx()
  const resetTx = tx.reset
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<TicketState>({ status: 'disconnected' })
  const [txOwner, setTxOwner] = useState<string>()

  useEffect(() => { resetTx(); setTxOwner(undefined) }, [owner, resetTx])

  useEffect(() => {
    if (!owner) {
      setState({ status: 'disconnected' })
      return
    }
    let active = true
    setState({ status: 'loading', owner })
    Promise.all([
      api.getTicketsByOwner(owner),
      api.getEvents().then((events) => ({ events, eventsError: undefined as string | undefined })).catch((error: unknown) => ({ events: [] as EventDto[], eventsError: errorMessage(error) })),
    ]).then(([tickets, eventResult]) => {
      if (!active) return
      setState({
        status: 'ready',
        owner,
        tickets,
        events: Object.fromEntries(eventResult.events.map((event) => [event.eventPda, event])),
        ...(eventResult.eventsError ? { eventsError: eventResult.eventsError } : {}),
      })
    }).catch((error: unknown) => {
      if (active) setState({ status: 'error', owner, message: errorMessage(error) })
    })
    return () => { active = false }
  }, [owner, retry])

  const viewState: TicketState = !owner
    ? { status: 'disconnected' }
    : state.status === 'disconnected' || state.owner !== owner
      ? { status: 'loading', owner }
      : state

  async function prepareCancel(ticket: TicketDto) {
    if (!owner || ticket.ownerPubkey !== owner || ticket.isCheckedIn || ticket.listingPriceLamports === undefined) return
    setTxOwner(owner)
    try { await tx.prepare({ kind: 'cancel-listing', input: { mintPubkey: ticket.mintAddress } }) } catch { /* error is shown in the transaction panel */ }
  }

  async function sendCancel() {
    try {
      await tx.send()
      setRetry((value) => value + 1)
    } catch { /* transaction state keeps the actionable message */ }
  }

  return <section className="mx-auto w-full max-w-7xl flex-1">
    <header className="mb-8 border-b border-dashed border-outline-variant pb-6 sm:mb-12 sm:pb-8">
      <h1 className="mb-2 font-display text-headline-xl uppercase text-primary">My Stubs</h1>
      {owner ? <p className="break-all font-mono text-utility-mono uppercase tracking-widest text-on-surface-variant">Wallet address: {owner}</p> : <p className="font-mono text-utility-mono uppercase tracking-widest text-on-surface-variant">Your tickets, ready at the gate.</p>}
    </header>

    {viewState.status === 'disconnected' && <div className="ticket-paper flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-6 text-center text-background sm:p-stub-padding">
      <span className="material-symbols-outlined text-5xl text-outline" aria-hidden="true">account_balance_wallet</span>
      <h2 className="font-display text-headline-lg uppercase">Connect your wallet</h2>
      <p className="max-w-lg font-body text-body-md">Connect Phantom to see the tickets held by that wallet.</p>
    </div>}

    {viewState.status === 'loading' && <div role="status" aria-label="Loading your tickets" className="flex flex-col gap-8 md:gap-12">{Array.from({ length: 2 }, (_, index) => <TicketSkeleton key={index}/>)}</div>}

    {viewState.status === 'error' && <div role="alert" className="ticket-paper flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-6 text-center text-background sm:p-stub-padding">
      <span className="material-symbols-outlined text-5xl text-error-container" aria-hidden="true">cloud_off</span>
      <h2 className="font-display text-headline-lg uppercase">Tickets are unavailable</h2>
      <p className="max-w-2xl break-words font-body text-body-md">{viewState.message}</p>
      <button type="button" onClick={() => setRetry((value) => value + 1)} className="bg-background px-5 py-3 font-section-label text-section-label uppercase text-inverse-surface hover:bg-surface-container-high">Try again</button>
    </div>}

    {viewState.status === 'ready' && viewState.eventsError && <p role="status" className="mb-5 border border-outline-variant p-3 font-body text-utility-sm text-on-surface-variant">Some event descriptions could not be loaded. Ticket identity and QR data are still available.</p>}

    {owner && txOwner === owner && tx.state.message && <div role={tx.state.status === 'error' ? 'alert' : 'status'} className={`mb-6 border p-4 ${tx.state.status === 'error' ? 'border-error-container bg-error-container/10 text-error-container' : tx.state.status === 'success' ? 'border-tertiary/50 bg-tertiary/10 text-on-background' : 'border-outline-variant text-on-surface-variant'}`}>
      <p className="font-body text-body-md">{tx.state.message}</p>
      {tx.state.errorCode && <p className="mt-1 font-mono text-utility-sm">{tx.state.errorCode}</p>}
      {tx.state.signature && <a className="mt-2 block break-all font-mono text-utility-sm underline" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${tx.state.signature}?cluster=devnet`}>Transaction: {tx.state.signature}</a>}
      {tx.state.result?.syncError && <p className="mt-2 font-body text-utility-sm">Transaction confirmed on-chain; ticket cache sync failed: {tx.state.result.syncError}</p>}
      {tx.state.status === 'ready' && <button type="button" disabled={tx.busy} onClick={() => void sendCancel()} className="mt-4 w-full bg-primary-container px-4 py-3 font-mono text-utility-sm font-bold text-on-primary-container hover:brightness-110">SIGN &amp; CANCEL WITH PHANTOM</button>}
      {(tx.state.status === 'success' || tx.state.status === 'error') && <button type="button" onClick={tx.reset} className="mt-3 font-section-label text-section-label uppercase underline">Dismiss</button>}
    </div>}

    {viewState.status === 'ready' && (viewState.tickets.length === 0 ? <div className="ticket-paper flex min-h-64 flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-6 text-center text-background sm:p-stub-padding">
      <span className="material-symbols-outlined text-5xl text-outline" aria-hidden="true">confirmation_number</span>
      <h2 className="font-display text-headline-lg uppercase">No stubs in this wallet</h2>
      <p className="max-w-lg font-body text-body-md">No tickets are currently listed for this wallet.</p>
    </div> : <div className="ticket-stack relative flex flex-col gap-8 md:gap-12">
      {viewState.tickets.map((ticket) => <TicketCard key={ticket.mintAddress} ticket={ticket} event={viewState.events[ticket.eventPda]} owner={owner!} busy={tx.busy} onCancel={(selected) => void prepareCancel(selected)}/>) }
    </div>)}
  </section>
}
