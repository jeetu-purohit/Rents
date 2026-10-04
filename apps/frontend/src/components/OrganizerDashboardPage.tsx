import { BN, BorshInstructionCoder, Program, type Idl, type Provider } from '@coral-xyz/anchor'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import type { CreateEventRequest, EventDto, RentsTicketing } from 'shared'
import sharedIdlJson from 'shared/idl/rents_ticketing.json'
import { useSendBuilderTx } from '../hooks/useSendBuilderTx'
import { ApiError, api } from '../lib/api'
import { frontendConfig } from '../lib/config'

type ChainEvent = { organizer: PublicKey; eventId: BN; maxTickets: number; ticketsSold: number; basePrice: BN; resaleCapBps: number; royaltyBps: number }
type OrganizerEvent = { metadata: EventDto; chain: ChainEvent; primaryRevenue: bigint; royalties: bigint }
type DashboardState = { status: 'disconnected' } | { status: 'loading'; owner: string } | { status: 'error'; owner: string; message: string } | { status: 'ready'; owner: string; events: OrganizerEvent[] }
type Draft = { name: string; description: string; venue: string; date: string; imageUrl: string; maxTickets: string; basePriceSol: string; resaleCapBps: string; royaltyBps: string }
type PendingMetadata = { eventPda: string; eventId: string; request: CreateEventRequest }

const configuredIdl: Idl = { ...(sharedIdlJson as Idl), address: frontendConfig.programId.toBase58() }
const instructionCoder = new BorshInstructionCoder(configuredIdl)
const U64_MAX = 18_446_744_073_709_551_615n
const LAMPORTS = 1_000_000_000n
const emptyDraft: Draft = { name: '', description: '', venue: '', date: '', imageUrl: '', maxTickets: '', basePriceSol: '', resaleCapBps: '11000', royaltyBps: '500' }

function formatSol(value: bigint): string {
  const whole = value / LAMPORTS
  const fraction = (value % LAMPORTS).toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`
}
function parseSol(value: string): bigint | undefined {
  const match = value.trim().match(/^(\d+)(?:\.(\d{0,9}))?$/)
  if (!match) return undefined
  const amount = BigInt(match[1]) * LAMPORTS + BigInt((match[2] ?? '').padEnd(9, '0') || '0')
  return amount > 0n && amount <= U64_MAX ? amount : undefined
}
function errorMessage(error: unknown): string {
  return error instanceof ApiError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : 'The request could not be completed.'
}
function sameMetadata(left: EventDto, right: CreateEventRequest): boolean {
  return left.eventPda === right.eventPda && left.onChainEventId === right.onChainEventId && left.organizerPubkey === right.organizerPubkey && left.name === right.name && left.description === right.description && left.venue === right.venue && new Date(left.date).toISOString() === right.date && (left.imageUrl ?? '') === (right.imageUrl ?? '') && left.maxTickets === right.maxTickets && left.basePriceLamports === right.basePriceLamports && left.resaleCapBps === right.resaleCapBps && left.royaltyBps === right.royaltyBps
}
function transferLamports(instruction: unknown): bigint | undefined {
  if (typeof instruction !== 'object' || instruction === null || !('parsed' in instruction)) return undefined
  const parsed = instruction.parsed
  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed) || parsed.type !== 'transfer' || !('info' in parsed)) return undefined
  const info = parsed.info
  if (typeof info !== 'object' || info === null || !('destination' in info) || typeof info.destination !== 'string' || !('lamports' in info)) return undefined
  const amount = info.lamports
  if (typeof amount === 'string' && /^\d+$/.test(amount)) return BigInt(amount)
  if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0) return BigInt(amount)
  return undefined
}

async function royaltiesForEvent(connection: ReturnType<typeof useConnection>['connection'], eventPda: string, organizer: string, expectedResales: number, royaltyBps: number): Promise<bigint> {
  if (expectedResales === 0 || royaltyBps === 0) return 0n
  let total = 0n
  let found = 0
  let before: string | undefined
  const eventKey = new PublicKey(eventPda)
  while (found < expectedResales) {
    const page = await connection.getSignaturesForAddress(eventKey, { limit: 1000, ...(before ? { before } : {}) }, 'confirmed')
    if (!page.length) break
    const signatures = page.filter((item) => item.err === null).map((item) => item.signature)
    for (let offset = 0; offset < signatures.length; offset += 8) {
      const transactions = await Promise.all(signatures.slice(offset, offset + 8).map((signature) => connection.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })))
      for (const transaction of transactions) {
        if (!transaction?.meta || transaction.meta.err) continue
        const instructions = transaction.transaction.message.instructions
        for (const [index, instruction] of instructions.entries()) {
          if (!('data' in instruction) || !('accounts' in instruction) || !instruction.programId.equals(frontendConfig.programId)) continue
          if (instructionCoder.decode(instruction.data, 'base58')?.name !== 'resell_ticket' || !instruction.accounts[1]?.equals(eventKey)) continue
          const group = transaction.meta.innerInstructions?.find((item) => item.index === index)
          const transfers = group?.instructions.map(transferLamports) ?? []
          const organizerRoyalty = transfers.find((amount, i) => amount !== undefined && group?.instructions[i] && 'parsed' in group.instructions[i] && group.instructions[i].parsed.type === 'transfer' && 'info' in group.instructions[i].parsed && typeof group.instructions[i].parsed.info === 'object' && group.instructions[i].parsed.info !== null && 'destination' in group.instructions[i].parsed.info && group.instructions[i].parsed.info.destination === organizer)
          if (organizerRoyalty === undefined) throw new Error('A confirmed resale transaction did not expose its organizer royalty transfer.')
          total += organizerRoyalty
          found += 1
          if (found >= expectedResales) break
        }
        if (found >= expectedResales) break
      }
    }
    before = page.at(-1)?.signature
    if (page.length < 1000) break
  }
  if (found !== expectedResales) throw new Error(`Could verify ${found} of ${expectedResales} indexed resales. Royalties are not shown as a partial total.`)
  return total
}

function StatCard({ label, value, suffix, amber = false }: { label: string; value: string; suffix?: string; amber?: boolean }) {
  return <article className={`relative overflow-hidden border border-outline-variant p-5 shadow-marquee-soft sm:p-stub-padding ${amber ? 'bg-surface-container text-primary' : 'bg-inverse-surface text-inverse-on-surface'}`}>
    <span className="absolute right-4 top-4 material-symbols-outlined text-4xl opacity-20" aria-hidden="true">{label === 'TICKETS SOLD' ? 'sell' : label === 'PRIMARY SALES REVENUE' ? 'payments' : 'bolt'}</span>
    <h2 className={`mb-4 font-section-label text-section-label uppercase tracking-widest ${amber ? 'text-primary' : 'text-inverse-on-surface/70'}`}>{label}</h2>
    <p className="break-words font-mono text-3xl sm:text-4xl">{value} {suffix && <span className="text-utility-sm">{suffix}</span>}</p>
  </article>
}

export function OrganizerDashboardPage() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const owner = publicKey?.toBase58()
  const provider: Provider = useMemo(() => ({ connection }), [connection])
  const program = useMemo(() => new Program<RentsTicketing>(configuredIdl, provider), [provider])
  const tx = useSendBuilderTx()
  const resetTx = tx.reset
  const [dashboard, setDashboard] = useState<DashboardState>({ status: 'disconnected' })
  const [retry, setRetry] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [formError, setFormError] = useState('')
  const [flowMessage, setFlowMessage] = useState('')
  const [metadataBusy, setMetadataBusy] = useState(false)
  const [pendingMetadata, setPendingMetadata] = useState<PendingMetadata>()
  const [transactionOwner, setTransactionOwner] = useState<string>()

  const loadDashboard = useCallback(async (organizer: string, active: () => boolean) => {
    if (active()) setDashboard({ status: 'loading', owner: organizer })
    try {
      const metadataEvents = await api.getEventsByOrganizer(organizer)
      const ticketAccounts = metadataEvents.length ? await program.account.ticket.all() : []
      const rows = await Promise.all(metadataEvents.map(async (metadata) => {
        const chain = await program.account.event.fetch(new PublicKey(metadata.eventPda)) as ChainEvent
        if (!chain.organizer.equals(new PublicKey(organizer)) || chain.eventId.toString() !== metadata.onChainEventId || chain.maxTickets !== metadata.maxTickets || chain.basePrice.toString() !== metadata.basePriceLamports || chain.resaleCapBps !== metadata.resaleCapBps || chain.royaltyBps !== metadata.royaltyBps) throw new Error(`Event metadata does not match chain state for ${metadata.name}.`)
        const eventTickets = ticketAccounts.filter(({ account }) => account.event.equals(new PublicKey(metadata.eventPda)))
        const resales = eventTickets.reduce((sum, item) => sum + item.account.resaleCount, 0)
        const royalties = await royaltiesForEvent(connection, metadata.eventPda, organizer, resales, chain.royaltyBps)
        return { metadata, chain, primaryRevenue: BigInt(chain.basePrice.toString()) * BigInt(chain.ticketsSold), royalties }
      }))
      if (active()) setDashboard({ status: 'ready', owner: organizer, events: rows })
    } catch (error) {
      if (active()) setDashboard({ status: 'error', owner: organizer, message: errorMessage(error) })
    }
  }, [connection, program])

  useEffect(() => {
    resetTx()
    setTransactionOwner(undefined)
    setPendingMetadata(undefined)
    setFlowMessage('')
  }, [owner, resetTx])

  useEffect(() => {
    if (!owner) { setDashboard({ status: 'disconnected' }); return }
    let active = true
    void loadDashboard(owner, () => active)
    return () => { active = false }
  }, [owner, retry, loadDashboard])

  const view = owner && dashboard.status !== 'disconnected' && dashboard.status !== 'loading' && dashboard.owner === owner ? dashboard : owner ? { status: 'loading' as const, owner } : { status: 'disconnected' as const }
  const readyEvents = view.status === 'ready' ? view.events : []
  const totalSold = readyEvents.reduce((sum, item) => sum + item.chain.ticketsSold, 0)
  const totalRevenue = readyEvents.reduce((sum, item) => sum + item.primaryRevenue, 0n)
  const totalRoyalties = readyEvents.reduce((sum, item) => sum + item.royalties, 0n)

  function setField(field: keyof Draft, value: string) { setDraft((current) => ({ ...current, [field]: value })); setFormError('') }

  async function verifyAndSave(pending: PendingMetadata) {
    setMetadataBusy(true)
    try {
      if (!publicKey || publicKey.toBase58() !== pending.request.organizerPubkey) throw new Error('The connected organizer wallet changed. Reconnect it before saving metadata.')
      const eventPda = new PublicKey(pending.eventPda)
      const expected = PublicKey.findProgramAddressSync([Buffer.from('event'), publicKey.toBuffer(), new BN(pending.eventId).toArrayLike(Buffer, 'le', 8)], frontendConfig.programId)[0]
      if (!eventPda.equals(expected)) throw new Error('The returned Event PDA does not match the connected organizer and event ID.')
      const chain = await program.account.event.fetch(eventPda) as ChainEvent
      if (!chain.organizer.equals(publicKey) || chain.eventId.toString() !== pending.eventId || chain.maxTickets !== pending.request.maxTickets || chain.basePrice.toString() !== pending.request.basePriceLamports || chain.resaleCapBps !== pending.request.resaleCapBps || chain.royaltyBps !== pending.request.royaltyBps) throw new Error('The confirmed Event account does not match the submitted metadata.')
      setFlowMessage('Event confirmed on Devnet. Saving matching Event metadata…')
      const existing = await api.getEventsByOrganizer(publicKey.toBase58())
      const alreadySaved = existing.find((item) => item.eventPda === pending.eventPda)
      if (alreadySaved && !sameMetadata(alreadySaved, pending.request)) throw new Error('An Event with this PDA already has different Mongo metadata; it was not overwritten.')
      if (!alreadySaved) await api.createEvent(pending.request)
      const verified = (await api.getEventsByOrganizer(publicKey.toBase58())).find((item) => item.eventPda === pending.eventPda)
      if (!verified || !sameMetadata(verified, pending.request)) throw new Error('Mongo did not return metadata matching the confirmed Event account.')
      setPendingMetadata(undefined)
      setFlowMessage('Event is live on Devnet and its Mongo metadata matches the canonical Event PDA.')
      setDraft(emptyDraft)
      setShowCreate(false)
      setRetry((value) => value + 1)
    } finally { setMetadataBusy(false) }
  }

  async function prepareCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setFlowMessage('')
    if (!publicKey) { setFormError('Connect Phantom to create an Event for this wallet.'); return }
    const name = draft.name.trim(), description = draft.description.trim(), venue = draft.venue.trim()
    const price = parseSol(draft.basePriceSol)
    const maxTickets = Number(draft.maxTickets), resaleCapBps = Number(draft.resaleCapBps), royaltyBps = Number(draft.royaltyBps)
    const eventDate = new Date(draft.date)
    if (!name || !description || !venue) { setFormError('Name, description, and venue are required.'); return }
    if (!draft.date || Number.isNaN(eventDate.getTime())) { setFormError('Enter a valid event date and time.'); return }
    if (!Number.isInteger(maxTickets) || maxTickets < 1 || maxTickets > 0xffff_ffff) { setFormError('Ticket count must be a positive 32-bit integer.'); return }
    if (price === undefined) { setFormError('Enter a price greater than zero with at most 9 decimal places.'); return }
    if (!Number.isInteger(resaleCapBps) || resaleCapBps < 10_000 || resaleCapBps > 0xffff) { setFormError('Resale cap must be at least 10,000 bps and fit the on-chain u16 field.'); return }
    if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > 2_000) { setFormError('Royalty must be between 0 and 2,000 bps.'); return }
    const imageUrl = draft.imageUrl.trim()
    if (imageUrl) { try { const image = new URL(imageUrl); if (image.protocol !== 'http:' && image.protocol !== 'https:') throw new Error() } catch { setFormError('Image URL must use http or https.'); return } }
    const eventId = `${Date.now()}`
    try {
      const review = await tx.prepare({ kind: 'initialize-event', input: { eventId, maxTickets, basePriceLamports: price.toString(), resaleCapBps, royaltyBps } })
      const expected = PublicKey.findProgramAddressSync([Buffer.from('event'), publicKey.toBuffer(), new BN(eventId).toArrayLike(Buffer, 'le', 8)], frontendConfig.programId)[0]
      if (review.eventPda !== expected.toBase58()) { tx.reset(); throw new Error('The transaction builder PDA did not match the canonical organizer + event ID derivation.') }
      const request: CreateEventRequest = { onChainEventId: eventId, organizerPubkey: publicKey.toBase58(), eventPda: expected.toBase58(), name, description, venue, date: eventDate.toISOString(), ...(imageUrl ? { imageUrl } : {}), maxTickets, basePriceLamports: price.toString(), resaleCapBps, royaltyBps }
      setPendingMetadata({ eventPda: expected.toBase58(), eventId, request })
      setTransactionOwner(publicKey.toBase58())
      setShowCreate(false)
    } catch (error) { setFormError(errorMessage(error)) }
  }

  async function signAndSave() {
    if (!pendingMetadata) return
    setFormError('')
    try {
      const result = await tx.send()
      if (result.eventPda !== pendingMetadata.eventPda) throw new Error('Confirmed transaction PDA differs from the prepared Event.')
      setFlowMessage('Event transaction confirmed. Verifying the on-chain account before saving Event metadata…')
      await verifyAndSave(pendingMetadata)
    } catch (error) { setFlowMessage(`Event was not fully saved: ${errorMessage(error)}. No Mongo Event is created until chain verification succeeds.`) }
  }

  async function retryMetadataSave() {
    if (!pendingMetadata) return
    setFormError('')
    try { await verifyAndSave(pendingMetadata) } catch (error) { setFlowMessage(`Metadata save is still pending: ${errorMessage(error)}`) }
  }

  async function recoverInitialization() {
    if (!pendingMetadata) return
    try {
      const eventPda = new PublicKey(pendingMetadata.eventPda)
      const account = await program.account.event.fetchNullable(eventPda) as ChainEvent | null
      if (account) { await verifyAndSave(pendingMetadata); return }
      if (tx.state.signature) {
        const [status, blockHeight] = await Promise.all([
          connection.getSignatureStatus(tx.state.signature, { searchTransactionHistory: true }),
          connection.getBlockHeight('confirmed'),
        ])
        if (status.value && !status.value.err) { setFlowMessage('The confirmed signature is visible. Refreshing the Event account before saving metadata…'); await verifyAndSave(pendingMetadata); return }
        if (!status.value && tx.state.review && blockHeight <= tx.state.review.lastValidBlockHeight) { setFlowMessage('The transaction is not finalized or expired yet. Wait briefly, then check again.'); return }
      }
      setPendingMetadata(undefined)
      setTransactionOwner(undefined)
      tx.reset()
      setFlowMessage('No initialized Event account exists, so no Mongo metadata was written. Review the form and prepare a new transaction.')
      setShowCreate(true)
    } catch (error) { setFlowMessage(`Initialization recovery could not verify the Event: ${errorMessage(error)}`) }
  }

  return <section className="mx-auto w-full max-w-7xl">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b-2 border-dashed border-outline-variant pb-base">
      <div><p className="mb-2 font-section-label text-section-label uppercase text-primary">Organizer Overview</p><h1 className="font-display text-headline-xl uppercase text-on-surface">Box Office</h1>{owner && <p className="mt-2 break-all font-mono text-utility-sm text-on-surface-variant">ORGANIZER · {owner.slice(0, 5)}…{owner.slice(-5)}</p>}</div>
      <div className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-2 border border-outline-variant bg-surface-container px-4 py-2 font-mono text-utility-sm uppercase text-on-surface-variant"><span className="h-2 w-2 animate-pulse rounded-full bg-tertiary"/>Devnet online</span><button type="button" disabled={!owner || view.status === 'loading' || tx.busy || metadataBusy || Boolean(pendingMetadata)} onClick={() => { setShowCreate(true); setFormError('') }} className="flex items-center gap-2 border border-outline-variant bg-inverse-surface px-4 py-3 font-section-label text-section-label uppercase text-inverse-on-surface hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"><span>New Event</span><span className="material-symbols-outlined text-base" aria-hidden="true">add</span></button></div>
    </header>
    {view.status === 'disconnected' && <div className="ticket-paper flex min-h-56 flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-6 text-center text-background"><span className="material-symbols-outlined text-5xl text-outline" aria-hidden="true">account_balance_wallet</span><h2 className="font-display text-headline-lg uppercase">Connect your organizer wallet</h2><p className="max-w-lg font-body text-body-md">Connect Phantom to see Events created by that wallet and open its box office.</p></div>}
    {view.status === 'loading' && <div role="status" aria-label="Loading organizer data" className="grid gap-6 md:grid-cols-3"><div className="h-36 animate-pulse bg-surface-container"/><div className="h-36 animate-pulse bg-surface-container"/><div className="h-36 animate-pulse bg-surface-container"/></div>}
    {view.status === 'error' && <div role="alert" className="border border-error-container bg-error-container/10 p-5 text-error-container"><h2 className="font-display text-headline-lg uppercase">Dashboard unavailable</h2><p className="mt-2 break-words font-body text-body-md">{view.message}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-4 border border-current px-4 py-2 font-section-label text-section-label uppercase">Try again</button></div>}
    {view.status === 'ready' && <>
      <div className="mb-12 grid grid-cols-1 gap-gutter md:grid-cols-3"><StatCard label="TICKETS SOLD" value={totalSold.toLocaleString()} suffix="ACROSS EVENTS"/><StatCard label="PRIMARY SALES REVENUE" value={formatSol(totalRevenue)} amber/><StatCard label="RESALE ROYALTIES EARNED" value={formatSol(totalRoyalties)} amber/></div>
      <section aria-labelledby="manifest-title"><header className="mb-3 flex items-center justify-between px-2"><h2 id="manifest-title" className="font-section-label text-section-label uppercase tracking-widest text-on-surface-variant">Active Manifest</h2><button type="button" onClick={() => setRetry((value) => value + 1)} className="flex items-center gap-1 font-mono text-utility-sm uppercase text-primary">Refresh<span className="material-symbols-outlined text-sm" aria-hidden="true">refresh</span></button></header>
        {readyEvents.length === 0 ? <div className="border border-dashed border-outline-variant p-8 text-center"><p className="font-display text-headline-lg uppercase text-on-surface">No Events yet</p><p className="mt-2 font-body text-body-md text-on-surface-variant">Create your first Event to open the box office.</p><button type="button" onClick={() => setShowCreate(true)} className="marquee-glow mt-5 bg-primary-container px-5 py-3 font-section-label text-section-label uppercase text-on-primary-container">Create Event</button></div> : <div className="flex flex-col border border-outline-variant bg-surface-container">
          <div className="grid grid-cols-12 gap-3 border-b-2 border-dashed border-outline-variant bg-surface-container-high/50 p-4"><div className="col-span-6 font-section-label text-section-label uppercase text-on-surface-variant md:col-span-5">Event Designation</div><div className="hidden font-section-label text-section-label uppercase text-on-surface-variant md:col-span-3 md:block">Date / Venue</div><div className="col-span-4 text-right font-section-label text-section-label uppercase text-on-surface-variant md:col-span-3">Minted / Sold</div><div className="col-span-2 text-right font-section-label text-section-label uppercase text-on-surface-variant md:col-span-1">Status</div></div>
          {readyEvents.map(({ metadata, chain }) => { const pct = chain.maxTickets ? Math.min(100, chain.ticketsSold / chain.maxTickets * 100) : 0; const status = chain.ticketsSold >= chain.maxTickets ? 'SOLD OUT' : new Date(metadata.date).getTime() < Date.now() ? 'PAST' : 'LIVE'; return <article key={metadata.eventPda} className="relative grid grid-cols-12 items-center gap-3 border-b border-dashed border-outline-variant p-4 hover:bg-surface-variant/30"><span className="absolute -left-1 top-1/2 h-4 w-2 -translate-y-1/2 rounded-r-full border-y border-r border-outline-variant bg-background"/><div className="col-span-6 flex min-w-0 flex-col gap-1 pl-2 md:col-span-5"><h3 className="truncate font-display text-headline-lg-mobile uppercase text-on-surface">{metadata.name}</h3><span className="truncate font-mono text-utility-sm text-primary">EVENT · {metadata.onChainEventId}</span></div><div className="hidden min-w-0 flex-col gap-1 md:col-span-3 md:flex"><span className="font-mono text-utility-sm text-on-surface">{new Date(metadata.date).toLocaleDateString()}</span><span className="truncate font-mono text-utility-sm text-on-surface-variant">{metadata.venue}</span></div><div className="col-span-4 flex flex-col items-end gap-1 md:col-span-3"><span className="font-mono text-utility-sm text-on-surface">{chain.maxTickets.toLocaleString()} / <strong className="text-primary">{chain.ticketsSold.toLocaleString()}</strong></span><span className="h-1 w-20 overflow-hidden bg-surface-variant"><span className="block h-full bg-primary" style={{ width: `${pct}%` }}/></span></div><div className="col-span-2 flex justify-end md:col-span-1"><span className={`px-2 py-1 font-mono text-[10px] font-bold tracking-wider ${status === 'LIVE' ? 'bg-primary-container text-on-primary-container shadow-marquee' : 'border border-outline-variant text-on-surface-variant'}`}>{status}</span></div></article> })}
        </div>}
      </section>
    </>}

    {transactionOwner === owner && (tx.state.message || flowMessage) && <div role={tx.state.status === 'error' || formError ? 'alert' : 'status'} className={`mt-6 border p-4 ${tx.state.status === 'error' || formError ? 'border-error-container bg-error-container/10 text-error-container' : tx.state.status === 'success' && !pendingMetadata ? 'border-tertiary/50 bg-tertiary/10 text-on-background' : 'border-outline-variant text-on-surface-variant'}`}><p className="font-body text-body-md">{flowMessage || tx.state.message}</p>{formError && <p className="mt-2 font-body text-body-md">{formError}</p>}{tx.state.errorCode && <p className="mt-2 font-mono text-utility-sm">{tx.state.errorCode}</p>}{tx.state.signature && <a className="mt-2 block break-all font-mono text-utility-sm underline" href={`https://explorer.solana.com/tx/${tx.state.signature}?cluster=devnet`} target="_blank" rel="noreferrer">Devnet transaction · {tx.state.signature}</a>}{tx.state.status === 'ready' && <button type="button" disabled={tx.busy} onClick={() => void signAndSave()} className="mt-4 w-full bg-primary-container px-4 py-3 font-mono text-utility-sm font-bold text-on-primary-container">Approve Event initialization in Phantom</button>}{pendingMetadata && tx.state.status === 'success' && <button type="button" disabled={metadataBusy} onClick={() => void retryMetadataSave()} className="mt-4 w-full border border-primary-container px-4 py-3 font-mono text-utility-sm font-bold text-primary disabled:opacity-50">{metadataBusy ? 'Verifying and saving…' : 'Retry metadata verification / save'}</button>}{pendingMetadata && tx.state.status === 'error' && <button type="button" disabled={metadataBusy} onClick={() => void recoverInitialization()} className="mt-4 w-full border border-outline-variant px-4 py-3 font-mono text-utility-sm disabled:opacity-50">{metadataBusy ? 'Checking chain…' : 'Check chain result and safely continue'}</button>}</div>}

    {showCreate && <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 py-8 sm:p-8"><section role="dialog" aria-modal="true" aria-labelledby="create-event-title" className="my-auto w-full max-w-3xl border border-outline-variant bg-surface-container shadow-2xl"><header className="flex items-center justify-between border-b border-dashed border-outline-variant bg-surface-container-high p-5 sm:p-gutter"><div><p className="font-section-label text-section-label uppercase tracking-widest text-primary">Organizer · Devnet</p><h2 id="create-event-title" className="mt-1 font-display text-headline-lg uppercase text-on-surface">Create Event</h2></div><button type="button" aria-label="Close form" onClick={() => setShowCreate(false)} className="material-symbols-outlined text-on-surface-variant hover:text-primary">close</button></header>
      <form onSubmit={(event) => void prepareCreate(event)} className="grid gap-4 p-5 sm:grid-cols-2 sm:p-gutter"><label className="font-section-label text-section-label uppercase text-on-surface-variant">Event name<input required maxLength={100} value={draft.name} onChange={(event) => setField('name', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-body text-body-md normal-case text-on-surface"/></label><label className="font-section-label text-section-label uppercase text-on-surface-variant">Venue<input required maxLength={200} value={draft.venue} onChange={(event) => setField('venue', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-body text-body-md normal-case text-on-surface"/></label><label className="font-section-label text-section-label uppercase text-on-surface-variant sm:col-span-2">Description<textarea required maxLength={2000} rows={3} value={draft.description} onChange={(event) => setField('description', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-body text-body-md normal-case text-on-surface"/></label><label className="font-section-label text-section-label uppercase text-on-surface-variant">Date &amp; time<input required type="datetime-local" value={draft.date} onChange={(event) => setField('date', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-mono text-utility-sm text-on-surface"/></label><label className="font-section-label text-section-label uppercase text-on-surface-variant">Image URL · optional<input type="url" value={draft.imageUrl} onChange={(event) => setField('imageUrl', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-mono text-utility-sm text-on-surface"/></label><label className="font-section-label text-section-label uppercase text-on-surface-variant">Ticket count<input required type="number" min="1" max="4294967295" step="1" value={draft.maxTickets} onChange={(event) => setField('maxTickets', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-mono text-utility-sm text-on-surface"/></label><label className="font-section-label text-section-label uppercase text-on-surface-variant">Ticket price · SOL<input required type="number" min="0.000000001" step="0.000000001" inputMode="decimal" value={draft.basePriceSol} onChange={(event) => setField('basePriceSol', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-mono text-utility-sm text-on-surface"/></label><label className="font-section-label text-section-label uppercase text-on-surface-variant">Resale cap · bps<input required type="number" min="10000" max="65535" step="1" value={draft.resaleCapBps} onChange={(event) => setField('resaleCapBps', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-mono text-utility-sm text-on-surface"/><span className="mt-1 block font-mono text-[10px] text-on-surface-variant">10000 bps = 100%; default 11000 bps</span></label><label className="font-section-label text-section-label uppercase text-on-surface-variant">Royalty · bps<input required type="number" min="0" max="2000" step="1" value={draft.royaltyBps} onChange={(event) => setField('royaltyBps', event.target.value)} className="mt-2 block w-full border border-outline-variant bg-surface-container-lowest px-3 py-3 font-mono text-utility-sm text-on-surface"/><span className="mt-1 block font-mono text-[10px] text-on-surface-variant">Maximum 2000 bps (20%)</span></label><div className="border-t border-dashed border-outline-variant pt-4 sm:col-span-2"><p className="mb-4 font-mono text-utility-sm text-on-surface-variant">The connected Phantom wallet is the organizer and fee payer. Chain initialization completes before Event metadata is saved.</p>{formError && <p role="alert" className="mb-3 border border-error-container p-3 font-body text-utility-sm text-error-container">{formError}</p>}<button type="submit" disabled={!owner || tx.busy || Boolean(pendingMetadata)} className="marquee-glow w-full bg-primary-container px-5 py-3 font-section-label text-section-label uppercase text-on-primary-container disabled:opacity-50">{tx.state.status === 'preparing' ? 'Preparing & simulating…' : 'Prepare Event initialization'}</button></div></form>
      </section></div>}
  </section>
}
