import { Program, type Idl, type Provider } from '@coral-xyz/anchor'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import type { EventDto, PlatformConfigDto, RentsTicketing, TicketDto } from 'shared'
import sharedIdlJson from 'shared/idl/rents_ticketing.json'
import { useSendBuilderTx } from '../hooks/useSendBuilderTx'
import { ApiError, api } from '../lib/api'
import { frontendConfig } from '../lib/config'

type ChainTicket = { event: PublicKey; mint: PublicKey; faceValue: { toString(): string }; isUsed: boolean; listingPrice: { toString(): string } | null }
type ChainEvent = { organizer: PublicKey; eventId: { toString(): string }; resaleCapBps: number; royaltyBps: number }
type ResaleData = { ticket: TicketDto; event: EventDto; faceValue: string; resaleCapBps: number; royaltyBps: number; isUsed: boolean; listingPrice?: string; platform?: PlatformConfigDto; platformError?: string }
type PageState = { status: 'loading'; owner: string } | { status: 'error'; owner: string; message: string } | { status: 'ready'; owner: string; data: ResaleData }

const configuredIdl: Idl = { ...(sharedIdlJson as Idl), address: frontendConfig.programId.toBase58() }
const LAMPORTS_PER_SOL = 1_000_000_000n

function formatSol(lamports: string | bigint): string {
  const amount = typeof lamports === 'bigint' ? lamports : BigInt(lamports)
  const whole = amount / LAMPORTS_PER_SOL
  const fraction = (amount % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`
}

function percent(bps: number): string { return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%` }

function parseSol(value: string): bigint | undefined {
  const match = value.trim().match(/^(\d+)(?:\.(\d{0,9}))?$/)
  if (!match) return undefined
  return BigInt(match[1]) * LAMPORTS_PER_SOL + BigInt((match[2] ?? '').padEnd(9, '0') || '0')
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.code})`
  return error instanceof Error ? error.message : 'The ticket resale information could not be loaded.'
}

function shortAddress(value: string): string { return `${value.slice(0, 4)}…${value.slice(-4)}` }

export function ListForResalePage({ mint }: { mint: string }) {
  const { connection } = useConnection()
  const { publicKey } = useWallet()
  const owner = publicKey?.toBase58()
  const provider: Provider = useMemo(() => ({ connection }), [connection])
  const program = useMemo(() => new Program<RentsTicketing>(configuredIdl, provider), [provider])
  const tx = useSendBuilderTx()
  const resetTx = tx.reset
  const [page, setPage] = useState<PageState>({ status: 'loading', owner: '' })
  const [priceInput, setPriceInput] = useState('')
  const [retry, setRetry] = useState(0)
  const [txOwner, setTxOwner] = useState<string>()

  const load = useCallback(async (walletOwner: string, isActive: () => boolean) => {
    if (isActive()) setPage({ status: 'loading', owner: walletOwner })
    try {
      const mintKey = new PublicKey(mint)
      const [ticket, events, platformResult] = await Promise.all([
        api.getTicket(mintKey.toBase58()),
        api.getEvents(),
        api.getPlatform().then((platform) => ({ platform, platformError: undefined as string | undefined })).catch((error: unknown) => ({ platform: undefined, platformError: errorMessage(error) })),
      ])
      if (ticket.mintAddress !== mintKey.toBase58()) throw new Error('The ticket API returned a different mint.')
      if (ticket.ownerPubkey !== walletOwner) throw new Error('This wallet is not the indexed owner of this ticket.')
      const [expectedTicketPda] = PublicKey.findProgramAddressSync([Buffer.from('ticket'), mintKey.toBuffer()], frontendConfig.programId)
      if (ticket.ticketPda !== expectedTicketPda.toBase58()) throw new Error('The ticket cache PDA does not match the canonical mint-derived PDA.')
      const event = events.find((candidate) => candidate.eventPda === ticket.eventPda)
      if (!event) throw new Error('Matching Event metadata is not available for this ticket.')
      if (!isActive()) return
      const [chainTicket, chainEvent] = await Promise.all([
        program.account.ticket.fetch(expectedTicketPda) as Promise<ChainTicket>,
        program.account.event.fetch(new PublicKey(ticket.eventPda)) as Promise<ChainEvent>,
      ])
      if (!chainTicket.mint.equals(mintKey) || !chainTicket.event.equals(new PublicKey(ticket.eventPda)) || !chainEvent.organizer.equals(new PublicKey(event.organizerPubkey)) || chainEvent.eventId.toString() !== event.onChainEventId) {
        throw new Error('The ticket or Event metadata does not match the canonical on-chain accounts.')
      }
      if (!isActive()) return
      const faceValue = chainTicket.faceValue.toString()
      if (faceValue !== ticket.faceValueLamports) throw new Error('Cached face value differs from the on-chain ticket; refresh the ticket before listing.')
      const listingPrice = chainTicket.listingPrice?.toString()
      const data: ResaleData = {
        ticket, event, faceValue, resaleCapBps: chainEvent.resaleCapBps, royaltyBps: chainEvent.royaltyBps,
        isUsed: chainTicket.isUsed,
        ...(listingPrice ? { listingPrice } : {}),
        ...(platformResult.platform ? { platform: platformResult.platform } : {}),
        ...(platformResult.platformError ? { platformError: platformResult.platformError } : {}),
      }
      setPage({ status: 'ready', owner: walletOwner, data })
      if (!listingPrice) setPriceInput(formatSol(faceValue))
    } catch (error) {
      if (isActive()) setPage({ status: 'error', owner: walletOwner, message: errorMessage(error) })
    }
  }, [mint, program])

  useEffect(() => {
    resetTx()
    setTxOwner(undefined)
    setPriceInput('')
  }, [owner, resetTx])

  useEffect(() => {
    if (!owner) { setPage({ status: 'loading', owner: '' }); return }
    let active = true
    void load(owner, () => active)
    return () => { active = false }
  }, [owner, retry, load])

  const currentPage = owner && page.status !== 'loading' && page.owner === owner ? page : owner ? { status: 'loading' as const, owner } : { status: 'disconnected' as const }
  if (currentPage.status === 'disconnected') return <section className="ticket-paper mx-auto flex min-h-64 w-full max-w-2xl flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-6 text-center text-background sm:p-stub-padding"><span className="material-symbols-outlined text-5xl text-outline" aria-hidden="true">account_balance_wallet</span><h1 className="font-display text-headline-lg uppercase">Connect your wallet</h1><p className="font-body text-body-md">Connect the Phantom wallet that holds this ticket to list it for resale.</p></section>
  if (currentPage.status === 'loading') return <div role="status" aria-label="Loading resale details" className="mx-auto w-full max-w-2xl animate-pulse border border-outline-variant bg-surface-container p-stub-padding"><div className="h-8 w-1/2 bg-surface-container-high"/><div className="mt-8 h-40 bg-surface-container-high"/></div>
  if (currentPage.status === 'error') return <section role="alert" className="ticket-paper mx-auto flex min-h-72 w-full max-w-2xl flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-stub-padding text-center text-background"><span className="material-symbols-outlined text-5xl text-error-container" aria-hidden="true">sell</span><h1 className="font-display text-headline-lg uppercase">Ticket unavailable</h1><p className="max-w-xl break-words font-body text-body-md">{currentPage.message}</p><div className="flex flex-wrap justify-center gap-3"><button type="button" onClick={() => setRetry((value) => value + 1)} className="bg-background px-5 py-3 font-section-label text-section-label uppercase text-inverse-surface">Try again</button><a href="/my-tickets" className="border border-outline-variant px-5 py-3 font-section-label text-section-label uppercase">Back to My Stubs</a></div></section>

  const data = currentPage.data
  const inputLamports = parseSol(priceInput)
  const cap = data ? BigInt(data.faceValue) * BigInt(data.resaleCapBps) / 10_000n : undefined
  const royalty = inputLamports !== undefined && data ? inputLamports * BigInt(data.royaltyBps) / 10_000n : undefined
  const proceeds = inputLamports !== undefined && royalty !== undefined ? inputLamports - royalty : undefined
  const platformFee = inputLamports !== undefined && data?.platform ? inputLamports * BigInt(data.platform.platformFeeBps) / 10_000n : undefined
  const canList = Boolean(data && !data.isUsed && data.listingPrice === undefined && inputLamports !== undefined && inputLamports > 0n && cap !== undefined && inputLamports <= cap && !tx.busy)

  async function prepareListing() {
    if (!data || !owner || !canList || inputLamports === undefined) return
    setTxOwner(owner)
    try { await tx.prepare({ kind: 'list', input: { mintPubkey: data.ticket.mintAddress, priceLamports: inputLamports.toString() } }) } catch { /* transaction detail appears below */ }
  }

  async function sendListing() {
    try { await tx.send(); setRetry((value) => value + 1) } catch { /* transaction state keeps the actionable message */ }
  }

  function updateSlider(value: string) {
    if (cap === undefined) return
    const next = cap * BigInt(value) / 1000n
    setPriceInput(formatSol(next))
  }

  const blockedMessage = data.isUsed ? 'This ticket has already been used and cannot be listed.' : data.listingPrice !== undefined ? `This ticket is already listed for ${formatSol(data.listingPrice)}. Cancel the listing from My Stubs before changing it.` : undefined
  return <main className="mx-auto w-full max-w-2xl">
    <article className="relative flex flex-col overflow-hidden rounded border border-outline-variant bg-surface-container shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-dashed border-outline-variant bg-surface-container-high p-gutter">
        <div><h1 className="font-display text-headline-lg-mobile uppercase tracking-widest text-primary sm:text-headline-lg">List Ticket</h1><p className="mt-1 break-all font-mono text-utility-sm text-on-surface-variant">TOKEN · {shortAddress(data.ticket.mintAddress)}</p></div>
        <a href="/my-tickets" aria-label="Close and return to My Stubs" className="material-symbols-outlined text-on-surface-variant hover:text-primary">close</a>
      </header>
      <div className="flex flex-col gap-8 p-gutter">
        <section className="flex min-w-0 items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-outline-variant bg-surface-container-highest">{data.event.imageUrl ? <img className="h-full w-full object-cover" src={data.event.imageUrl} alt={`${data.event.name} event artwork`} onError={(image) => { image.currentTarget.hidden = true }} /> : <span className="material-symbols-outlined text-primary" aria-hidden="true">confirmation_number</span>}</div>
          <div className="min-w-0"><h2 className="break-words font-body text-body-md font-bold text-on-surface">{data.event.name}</h2><p className="mt-1 font-section-label text-section-label uppercase text-on-surface-variant">{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(data.event.date))} · {data.event.venue}</p><p className="mt-2 flex items-center gap-1 font-mono text-utility-sm uppercase text-tertiary"><span className="material-symbols-outlined text-[14px]" aria-hidden="true">verified</span>Verified asset</p></div>
        </section>
        <div className="h-px w-full border-t-2 border-dashed border-outline-variant" />
        <section className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div><p className="mb-2 font-section-label text-section-label uppercase text-on-surface-variant">Face value</p><span className="font-mono text-utility-mono text-on-surface-variant">{formatSol(data.faceValue)}</span></div>
            <div className="text-right"><p className="mb-2 font-section-label text-section-label uppercase text-on-surface-variant">Max resale ({percent(data.resaleCapBps)})</p><span className="border border-primary-container/30 bg-primary-container/10 px-2 py-1 font-mono text-utility-mono text-primary">{formatSol(cap!)}</span></div>
          </div>
          <div className="rounded border border-outline-variant bg-surface-container-lowest p-5 sm:p-6">
            <label htmlFor="resale-price" className="mb-4 block font-section-label text-section-label uppercase text-on-surface-variant">Set your price</label>
            <div className="mb-5 flex items-center gap-3">
              <div className="relative min-w-0 flex-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-on-surface-variant">◎</span><input id="resale-price" type="number" min="0.000000001" step="0.000000001" inputMode="decimal" value={priceInput} onChange={(event) => setPriceInput(event.target.value)} aria-describedby="resale-cap-hint" className="w-full rounded border border-outline-variant bg-surface-container py-3 pl-10 pr-3 font-mono text-headline-lg-mobile text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" /></div>
              <span className="font-mono text-utility-mono text-on-surface-variant">SOL</span>
            </div>
            <input aria-label="Adjust resale price up to the maximum cap" type="range" min="0" max="1000" step="1" value={cap && inputLamports ? Math.min(1000, Number(inputLamports * 1000n / cap)) : 0} onChange={(event) => updateSlider(event.target.value)} className="w-full accent-primary" />
            <p id="resale-cap-hint" className="mt-2 flex justify-between font-mono text-utility-sm text-on-surface-variant"><span>Enter a SOL amount</span><span className="text-primary">Max {formatSol(cap!)}</span></p>
            {inputLamports !== undefined && inputLamports > cap! && <p role="alert" className="mt-3 font-body text-utility-sm text-error-container">Price exceeds this Event’s on-chain resale cap.</p>}
          </div>
        </section>
        <div className="h-px w-full border-t-2 border-dashed border-outline-variant" />
        <section className="rounded bg-surface-container-high p-4 font-mono text-utility-sm sm:p-5">
          <h3 className="mb-4 border-b border-dashed border-outline-variant pb-2 font-section-label text-section-label uppercase text-on-surface-variant">Transaction breakdown</h3>
          <dl className="flex flex-col gap-3">
            <div className="flex justify-between gap-4"><dt>Listing price</dt><dd>{inputLamports === undefined ? '—' : formatSol(inputLamports)}</dd></div>
            <div className="flex justify-between gap-4 text-on-surface-variant"><dt>Organizer royalty ({percent(data.royaltyBps)})</dt><dd>{royalty === undefined ? '—' : `−${formatSol(royalty)}`}</dd></div>
            <div className="flex justify-between gap-4 text-on-surface-variant"><dt>Estimated seller proceeds</dt><dd>{proceeds === undefined ? '—' : formatSol(proceeds)}</dd></div>
            {platformFee !== undefined && <div className="flex justify-between gap-4 border-t border-dashed border-outline-variant pt-3 text-on-surface-variant"><dt>Buyer platform fee ({percent(data.platform!.platformFeeBps)})</dt><dd>+{formatSol(platformFee)}</dd></div>}
          </dl>
          <p className="mt-3 border-t border-dashed border-outline-variant pt-3 text-[11px] leading-5 text-on-surface-variant">The organizer royalty is paid from the resale price. The platform fee is paid by the buyer on top and is not deducted from seller proceeds.</p>
        </section>
        {data.platformError && <p role="status" className="border border-outline-variant p-3 font-body text-utility-sm text-on-surface-variant">Platform fee preview unavailable: {data.platformError}</p>}
        {blockedMessage && <p role="alert" className="border border-error-container/50 bg-error-container/10 p-3 font-body text-utility-sm text-error-container">{blockedMessage}</p>}
      </div>
      <footer className="border-t border-dashed border-outline-variant bg-surface-container-high p-gutter">
        <button type="button" disabled={!canList} onClick={() => void prepareListing()} className="marquee-glow flex w-full items-center justify-center gap-2 rounded bg-primary-container py-3 font-display text-headline-lg-mobile uppercase text-on-primary-container transition-colors hover:bg-primary-fixed disabled:cursor-not-allowed disabled:opacity-50"><span className="material-symbols-outlined" aria-hidden="true">sell</span>{tx.busy ? 'Preparing transaction…' : 'Confirm listing'}</button>
        <p className="mt-4 text-center font-mono text-utility-sm text-on-surface-variant">Listing is subject to the on-chain cap and Phantom approval.</p>
      </footer>
    </article>
    {owner && txOwner === owner && tx.state.message && <div role={tx.state.status === 'error' ? 'alert' : 'status'} className={`mt-5 border p-4 ${tx.state.status === 'error' ? 'border-error-container bg-error-container/10 text-error-container' : tx.state.status === 'success' ? 'border-tertiary/50 bg-tertiary/10 text-on-background' : 'border-outline-variant text-on-surface-variant'}`}>
      <p className="font-body text-body-md">{tx.state.message}</p>{tx.state.errorCode && <p className="mt-2 font-mono text-utility-sm">{tx.state.errorCode}</p>}
      {tx.state.review && <dl className="mt-3 grid gap-x-3 gap-y-1 border-t border-current/20 pt-3 font-mono text-utility-sm sm:grid-cols-[10rem_1fr]"><dt>Network</dt><dd>Solana Devnet</dd><dt>Fee payer</dt><dd className="break-all">{tx.state.review.feePayer}</dd><dt>Est. network fee</dt><dd>{tx.state.review.networkFeeLamports.toLocaleString()} lamports</dd></dl>}
      {tx.state.status === 'ready' && <button type="button" onClick={() => void sendListing()} className="mt-4 w-full bg-primary-container px-4 py-3 font-mono text-utility-sm font-bold text-on-primary-container hover:brightness-110">SIGN &amp; SEND WITH PHANTOM</button>}
      {tx.state.signature && <a className="mt-3 block break-all font-mono text-utility-sm underline" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${tx.state.signature}?cluster=devnet`}>Transaction: {tx.state.signature}</a>}
      {tx.state.result?.syncError && <p className="mt-3 border-t border-current/20 pt-3 font-body text-utility-sm">Transaction confirmed on-chain; ticket cache sync failed: {tx.state.result.syncError}</p>}
      {(tx.state.status === 'success' || tx.state.status === 'error') && <button type="button" onClick={tx.reset} className="mt-3 font-section-label text-section-label uppercase underline">Dismiss</button>}
    </div>}
    {data.listingPrice !== undefined && <a href="/my-tickets" className="mt-5 block text-center font-section-label text-section-label uppercase text-primary underline">Return to My Stubs to cancel this listing</a>}
  </main>
}
