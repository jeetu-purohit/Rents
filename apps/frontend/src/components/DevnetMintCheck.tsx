import { useState, type FormEvent } from 'react'
import { useSendBuilderTx } from '../hooks/useSendBuilderTx'

export function DevnetMintCheck() {
  const { state, prepare, send, reset, busy } = useSendBuilderTx()
  const [eventPda, setEventPda] = useState(() => new URLSearchParams(window.location.search).get('eventPda') ?? '')
  const [eventName, setEventName] = useState(() => new URLSearchParams(window.location.search).get('eventName') ?? '')

  async function build(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await prepare({ kind: 'mint', input: { eventPda: eventPda.trim(), eventName: eventName.trim() } })
    } catch {
      // The hook exposes the detailed error in state for this check screen.
    }
  }

  async function signAndSend() {
    try {
      await send()
    } catch {
      // The hook exposes the detailed error in state for this check screen.
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="border-b border-dashed border-outline-variant pb-6">
        <p className="font-section-label text-section-label uppercase tracking-widest text-primary">RENTS · DEVNET CHECK</p>
        <h1 className="mt-2 font-display text-headline-xl uppercase text-on-surface">Mint transaction check</h1>
        <p className="mt-3 max-w-2xl font-body text-body-md text-on-surface-variant">
          Build and simulate a ticket mint, review the transaction, then explicitly approve its wallet signature in Phantom.
        </p>
      </header>

      <form onSubmit={build} className="flex flex-col gap-4 border border-outline-variant bg-surface-container-low p-6">
        <label className="flex flex-col gap-2 font-section-label text-section-label uppercase tracking-widest text-on-surface">
          On-chain event address
          <input required value={eventPda} onChange={(event) => setEventPda(event.target.value)} className="rounded border border-outline-variant bg-background px-3 py-3 font-mono text-sm normal-case tracking-normal text-on-background" placeholder="Devnet Event PDA" />
        </label>
        <label className="flex flex-col gap-2 font-section-label text-section-label uppercase tracking-widest text-on-surface">
          Event name
          <input required value={eventName} onChange={(event) => setEventName(event.target.value)} className="rounded border border-outline-variant bg-background px-3 py-3 font-body text-sm normal-case tracking-normal text-on-background" placeholder="Event name shown on the ticket" />
        </label>
        <button disabled={busy} className="w-fit rounded bg-primary px-5 py-3 font-section-label text-section-label uppercase tracking-widest text-on-primary disabled:opacity-50">
          {state.status === 'preparing' ? 'Building and simulating…' : 'Build & simulate'}
        </button>
      </form>

      {state.message && (
        <div role={state.status === 'error' ? 'alert' : 'status'} className={`flex flex-col gap-3 border p-5 ${state.status === 'error' ? 'border-error text-error' : 'border-outline-variant text-on-surface'}`}>
          <p className="font-body text-body-md">{state.message}</p>
          {state.errorCode && <p className="font-mono text-xs">Code: {state.errorCode}</p>}
          {state.review && (
            <dl className="grid gap-2 border-t border-outline-variant pt-3 font-mono text-xs sm:grid-cols-[10rem_1fr]">
              <dt>Network</dt><dd>Solana Devnet</dd>
              <dt>Action</dt><dd>{state.review.label}</dd>
              <dt>Wallet / fee payer</dt><dd className="break-all">{state.review.feePayer}</dd>
              <dt>Program</dt><dd className="break-all">{state.review.programId}</dd>
              {state.review.eventPda && <><dt>Event</dt><dd className="break-all">{state.review.eventPda}</dd></>}
              {state.review.mintPubkey && <><dt>New ticket mint</dt><dd className="break-all">{state.review.mintPubkey}</dd></>}
              {state.review.ticketFaceLamports && <><dt>Ticket face price</dt><dd>{state.review.ticketFaceLamports} lamports</dd></>}
              {state.review.platformFeeLamports && <><dt>Platform fee</dt><dd>{state.review.platformFeeLamports} lamports → {state.review.platformWallet}</dd></>}
              {state.review.ticketFaceLamports && <><dt>Plus</dt><dd>New mint, metadata, and token-account rent; Phantom shows the final wallet debit.</dd></>}
              <dt>Est. network fee</dt><dd>{state.review.networkFeeLamports.toLocaleString()} lamports</dd>
              <dt>Simulation units</dt><dd>{state.review.simulationUnits ?? 'Not reported'}</dd>
              <dt>Blockhash valid through</dt><dd>{state.review.lastValidBlockHeight}</dd>
              <dt>Simulation logs</dt><dd className="whitespace-pre-wrap break-words">{state.review.simulationLogs.join('\n') || 'No logs returned'}</dd>
            </dl>
          )}
          {state.status === 'ready' && (
            <button onClick={signAndSend} disabled={busy} className="w-fit rounded bg-primary px-5 py-3 font-section-label text-section-label uppercase tracking-widest text-on-primary disabled:opacity-50">
              Sign & send with Phantom
            </button>
          )}
          {state.signature && (
            <a className="font-mono text-xs underline" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${state.signature}?cluster=devnet`}>
              View confirmed transaction: {state.signature}
            </a>
          )}
          {state.result?.mintPubkey && <p className="font-mono text-xs">Ticket mint: {state.result.mintPubkey}</p>}
          {state.result?.ticketPda && <p className="font-mono text-xs">Ticket account: {state.result.ticketPda}</p>}
          {state.result?.syncError && <p role="alert" className="font-body text-sm text-error">On-chain transaction succeeded, but ticket sync failed: {state.result.syncError}</p>}
          <button type="button" onClick={reset} className="w-fit font-section-label text-section-label uppercase tracking-widest underline">Clear status</button>
        </div>
      )}
    </section>
  )
}
