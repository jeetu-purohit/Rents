import { useCallback, useEffect, useRef, useState } from 'react'
import type { BrowserQRCodeReader, IScannerControls } from '@zxing/browser'
import { useWallet } from '@solana/wallet-adapter-react'
import type { CheckInQrPayload, CheckInVerificationResponse } from '../lib/api'
import { ApiError, api } from '../lib/api'
import { useSendBuilderTx } from '../hooks/useSendBuilderTx'

type ScanResult =
  | { status: 'valid'; payload: CheckInQrPayload; ticket: CheckInVerificationResponse['ticket'] }
  | { status: 'rejected'; title: string; message: string }
  | { status: 'api-error'; message: string }
  | { status: 'checked-in'; payload: CheckInQrPayload; ticket: CheckInVerificationResponse['ticket']; signature: string; refreshMessage?: string }
  | { status: 'used'; payload: CheckInQrPayload; ticket?: CheckInVerificationResponse['ticket']; signature?: string }

type CameraState = 'idle' | 'starting' | 'ready' | 'permission-denied' | 'unavailable' | 'error'

function shorten(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-6)}`
}

function formatSol(lamports: string): string {
  const value = BigInt(lamports)
  const whole = value / 1_000_000_000n
  const fraction = (value % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} SOL`
}

function parseQrPayload(raw: string): CheckInQrPayload {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('This QR code is not a RENTS ticket.') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('This QR code is not a RENTS ticket.')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 3 || keys.join(',') !== 'eventPda,mint,owner' ||
    typeof record.mint !== 'string' || typeof record.owner !== 'string' || typeof record.eventPda !== 'string' ||
    !record.mint || !record.owner || !record.eventPda) {
    throw new Error('This QR code is not a RENTS ticket. Expected mint, owner, and eventPda.')
  }
  return { mint: record.mint, owner: record.owner, eventPda: record.eventPda }
}

function rejectionDetails(error: ApiError): { title: string; message: string; used: boolean } {
  const text = error.message.toLowerCase()
  if (text.includes('already checked in') || text.includes('ticketalreadyused')) {
    return { title: 'ALREADY USED', message: 'This ticket has already been checked in.', used: true }
  }
  if (text.includes('owner does not match') || text.includes('ticket holder')) {
    return { title: 'WRONG OWNER', message: 'This QR code does not belong to the current ticket holder.', used: false }
  }
  if (text.includes('expected event') || text.includes('different event')) {
    return { title: 'WRONG EVENT', message: 'This ticket is not for the Event shown in its QR code.', used: false }
  }
  if (error.status === 404) return { title: 'TICKET NOT FOUND', message: 'No matching ticket was found on chain.', used: false }
  return { title: 'TICKET REJECTED', message: 'The ticket could not be verified. Check that it is current and belongs to this event.', used: false }
}

function friendlyApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status >= 500 || error.status === 429 || error.status === 408) return 'Ticket verification is temporarily unavailable. Try again in a moment.'
    return rejectionDetails(error).message
  }
  return 'Ticket verification could not reach the RENTS service. Check your connection and try again.'
}

function ResultCard({ result }: { result: ScanResult }) {
  const accepted = result.status === 'valid' || result.status === 'checked-in'
  const used = result.status === 'used'
  const heading = result.status === 'valid' ? 'TICKET VERIFIED' : result.status === 'checked-in' ? 'CHECK-IN CONFIRMED' : result.status === 'used' ? 'ALREADY USED' : result.status === 'api-error' ? 'VERIFICATION ERROR' : result.title
  const description = result.status === 'valid' ? 'The ticket is valid for entry.' : result.status === 'checked-in' ? 'The on-chain check-in is confirmed.' : result.status === 'used' ? (result.signature ? 'Check-in confirmed. This ticket is now used.' : 'This ticket has already been checked in.') : result.status === 'api-error' ? result.message : result.message
  const ticket = result.status === 'valid' || result.status === 'checked-in' || result.status === 'used' ? result.ticket : undefined

  return <section role={accepted || used ? 'status' : 'alert'} aria-live="polite" className={`border-2 p-5 sm:p-8 ${accepted ? 'border-tertiary bg-tertiary/10' : used ? 'border-outline bg-surface-container' : 'border-error-container bg-error-container/10'}`}>
    <div className="flex items-start gap-4">
      <span aria-hidden="true" className={`font-display text-5xl leading-none sm:text-7xl ${accepted ? 'text-tertiary' : used ? 'text-primary' : 'text-error'}`}>{accepted ? '✓' : used ? '!' : '✕'}</span>
      <div className="min-w-0 flex-1">
        <h2 className={`font-display text-headline-lg uppercase sm:text-headline-xl ${accepted ? 'text-tertiary' : used ? 'text-primary' : 'text-error'}`}>{heading}</h2>
        <p className="mt-2 font-body text-body-md text-on-surface-variant">{description}</p>
        {ticket && <dl className="mt-6 grid gap-4 border-t border-dashed border-outline-variant pt-5 sm:grid-cols-2">
          <div><dt className="font-section-label text-section-label uppercase text-outline">Ticket mint</dt><dd className="mt-1 break-all font-mono text-utility-sm" title={ticket.mintAddress}>{shorten(ticket.mintAddress)}</dd></div>
          <div><dt className="font-section-label text-section-label uppercase text-outline">Event PDA</dt><dd className="mt-1 break-all font-mono text-utility-sm" title={ticket.eventPda}>{shorten(ticket.eventPda)}</dd></div>
          <div><dt className="font-section-label text-section-label uppercase text-outline">Ticket PDA</dt><dd className="mt-1 break-all font-mono text-utility-sm" title={ticket.ticketPda}>{shorten(ticket.ticketPda)}</dd></div>
          <div><dt className="font-section-label text-section-label uppercase text-outline">Face value</dt><dd className="mt-1 font-mono text-utility-sm">{formatSol(ticket.faceValueLamports)}</dd></div>
          <div><dt className="font-section-label text-section-label uppercase text-outline">Current holder</dt><dd className="mt-1 break-all font-mono text-utility-sm" title={ticket.ownerPubkey}>{shorten(ticket.ownerPubkey)}</dd></div>
        </dl>}
        {result.status === 'checked-in' && <>
          <p className="mt-5 break-all font-mono text-utility-sm text-on-surface-variant">Confirmed transaction: {result.signature}</p>
          {result.refreshMessage && <p role="status" className="mt-3 border border-primary/40 p-3 font-body text-utility-sm text-primary">{result.refreshMessage}</p>}
        </>}
        {result.status === 'used' && result.signature && <p className="mt-5 break-all font-mono text-utility-sm text-on-surface-variant">Confirmed transaction: {result.signature}</p>}
      </div>
    </div>
  </section>
}

export function ScannerPage() {
  const { publicKey } = useWallet()
  const organizer = publicKey?.toBase58()
  const tx = useSendBuilderTx()
  const resetTx = tx.reset
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | undefined>(undefined)
  const processingRef = useRef(false)
  const [scanning, setScanning] = useState(false)
  const [cameraState, setCameraState] = useState<CameraState>('idle')
  const [cameraMessage, setCameraMessage] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState<ScanResult>()

  const verifyPayload = useCallback(async (payload: CheckInQrPayload) => {
    setVerifying(true)
    try {
      const response = await api.verifyCheckIn(payload)
      if (response.valid !== true || response.ticket.isCheckedIn ||
        response.ticket.mintAddress !== payload.mint || response.ticket.ownerPubkey !== payload.owner || response.ticket.eventPda !== payload.eventPda) {
        setResult({ status: 'rejected', title: 'TICKET REJECTED', message: 'The verification service did not confirm this unused ticket for the QR owner and Event.' })
        return
      }
      setResult({ status: 'valid', payload, ticket: response.ticket })
    } catch (error) {
      if (error instanceof ApiError) {
        const details = rejectionDetails(error)
        setResult(details.used
          ? { status: 'used', payload }
          : { status: 'rejected', title: details.title, message: details.message })
        if (error.status >= 500 || error.status === 429 || error.status === 408) setResult({ status: 'api-error', message: friendlyApiError(error) })
        return
      }
      setResult({ status: 'api-error', message: friendlyApiError(error) })
    } finally {
      setVerifying(false)
    }
  }, [])

  useEffect(() => {
    resetTx()
  // A prepared transaction must not survive an organizer wallet change.
  }, [organizer, resetTx])

  useEffect(() => {
    if (!scanning) return
    const video = videoRef.current
    if (!video) return
    let active = true
    let reader: BrowserQRCodeReader | undefined
    setCameraState('starting')
    setCameraMessage('Requesting camera access…')

    void import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
      if (!active) return undefined
      reader = new BrowserQRCodeReader()
      return reader.decodeFromVideoDevice(undefined, video, (decoded) => {
        if (!active || !decoded || processingRef.current) return
        processingRef.current = true
        const raw = decoded.getText()
        setScanning(false)
        setCameraState('idle')
        try {
          void verifyPayload(parseQrPayload(raw))
        } catch (error) {
          setResult({ status: 'rejected', title: 'INVALID QR CODE', message: error instanceof Error ? error.message : 'This QR code is not a RENTS ticket.' })
        }
      })
    }).then((controls) => {
      if (!controls) return
      controlsRef.current = controls
      if (active) {
        setCameraState('ready')
        setCameraMessage('Camera ready. Hold the ticket QR inside the frame.')
      } else controls.stop()
    }).catch((error: unknown) => {
      if (!active) return
      setScanning(false)
      const name = error instanceof Error ? error.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setCameraState('permission-denied')
        setCameraMessage('Camera access was denied. Allow camera access in your browser settings, then try again.')
      } else if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
        setCameraState('unavailable')
        setCameraMessage('No usable camera is available. Connect a camera or try another device.')
      } else {
        setCameraState('error')
        setCameraMessage('The camera could not start. Check browser permissions and try again.')
      }
    })

    return () => {
      active = false
      controlsRef.current?.stop()
      controlsRef.current = undefined
    }
  }, [scanning, verifyPayload])

  function startScan() {
    processingRef.current = false
    setResult(undefined)
    setCameraMessage('')
    setScanning(true)
  }

  async function prepareCheckIn() {
    if (!result || result.status !== 'valid' || !organizer) return
    try {
      await tx.prepare({ kind: 'check-in', input: { mintPubkey: result.payload.mint, holderPubkey: result.payload.owner } })
    } catch { /* Transaction state displays the mapped error. */ }
  }

  async function sendCheckIn() {
    if (!result || result.status !== 'valid') return
    try {
      const sent = await tx.send()
      setResult({ status: 'checked-in', payload: result.payload, ticket: result.ticket, signature: sent.signature })
      try {
        await api.verifyCheckIn(result.payload)
        setResult({ status: 'checked-in', payload: result.payload, ticket: result.ticket, signature: sent.signature, refreshMessage: 'The transaction is confirmed, but the verification API still reports the ticket as valid. Refresh and verify again before admitting another attendee.' })
      } catch (error) {
        if (error instanceof ApiError && rejectionDetails(error).used) {
          setResult({ status: 'used', payload: result.payload, ticket: { ...result.ticket, isCheckedIn: true }, signature: sent.signature })
        } else {
          setResult({ status: 'checked-in', payload: result.payload, ticket: { ...result.ticket, isCheckedIn: true }, signature: sent.signature, refreshMessage: 'Check-in is confirmed on chain, but the follow-up verification could not be completed. Scan again to refresh the result.' })
        }
      }
    } catch { /* The transaction hook keeps the actionable state and mapped error. */ }
  }

  const resultIsValid = result?.status === 'valid'
  const txBusy = tx.busy

  return <section className="mx-auto w-full max-w-6xl flex-1">
    <header className="mb-8 border-b border-dashed border-outline-variant pb-6 sm:mb-12 sm:pb-8">
      <p className="mb-2 font-section-label text-section-label uppercase tracking-widest text-primary">RENTS · GATE OPERATIONS</p>
      <h1 className="font-display text-headline-xl uppercase text-primary">Ticket Scanner</h1>
      <p className="mt-3 max-w-2xl font-body text-body-md text-on-surface-variant">Scan a ticket QR to verify its current on-chain holder and check it in for this Event.</p>
      {organizer ? <p className="mt-3 break-all font-mono text-utility-sm text-outline">Organizer wallet: {shorten(organizer)}</p> : <p className="mt-3 font-mono text-utility-sm text-primary">Connect the event organizer wallet to sign check-ins.</p>}
    </header>

    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
      <section className="border border-outline-variant bg-surface-container-low p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-headline-lg uppercase text-on-surface">Camera</h2>
          {cameraState === 'ready' && <span className="flex items-center gap-2 font-section-label text-section-label uppercase text-tertiary"><span className="h-2 w-2 animate-pulse rounded-full bg-tertiary"/>Scanning</span>}
        </div>
        <div className="relative aspect-[4/3] overflow-hidden border border-outline bg-black">
          <video ref={videoRef} className={`h-full w-full object-cover ${cameraState === 'ready' ? 'block' : 'hidden'}`} muted playsInline />
          {cameraState !== 'ready' && <div role={cameraState === 'starting' ? 'status' : undefined} className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <span aria-hidden="true" className="material-symbols-outlined text-6xl text-primary">qr_code_scanner</span>
            <p className="max-w-sm font-body text-body-md text-on-surface-variant">{cameraMessage || 'Camera scanning is ready when you are.'}</p>
          </div>}
          {cameraState === 'ready' && <div aria-hidden="true" className="pointer-events-none absolute inset-[12%] border-2 border-primary shadow-marquee-soft"><span className="absolute left-1/2 top-1/2 h-px w-full -translate-x-1/2 bg-primary/50"/></div>}
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {!scanning ? <button type="button" onClick={startScan} className="flex-1 bg-primary-container px-5 py-4 font-section-label text-section-label font-bold uppercase tracking-widest text-on-primary-container hover:brightness-110">{result ? 'Scan another ticket' : cameraState === 'idle' ? 'Enable camera' : 'Try camera again'}</button> : <button type="button" onClick={() => { setScanning(false); setCameraState('idle'); setCameraMessage('Camera stopped.') }} className="flex-1 border border-outline px-5 py-4 font-section-label text-section-label font-bold uppercase tracking-widest text-on-surface hover:bg-surface-container-high">Stop scanning</button>}
        </div>
        <p className="mt-3 font-mono text-utility-sm text-outline">Camera access is used only to read a ticket QR in this browser.</p>
      </section>

      <div className="flex flex-col gap-5">
        {!result && verifying && <div role="status" className="flex min-h-64 flex-col items-center justify-center border border-dashed border-outline-variant p-6 text-center">
          <span aria-hidden="true" className="material-symbols-outlined animate-pulse text-5xl text-primary">hourglass_top</span>
          <h2 className="mt-3 font-display text-headline-lg uppercase">Verifying ticket</h2>
          <p className="mt-2 max-w-sm font-body text-body-md text-on-surface-variant">Checking the current ticket state and holder with the RENTS API.</p>
        </div>}
        {!result && !verifying && <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-outline-variant p-6 text-center">
          <span aria-hidden="true" className="material-symbols-outlined text-5xl text-outline">confirmation_number</span>
          <h2 className="mt-3 font-display text-headline-lg uppercase">Awaiting ticket</h2>
          <p className="mt-2 max-w-sm font-body text-body-md text-on-surface-variant">Scan a RENTS ticket. Verification checks its current owner and used state with the backend.</p>
        </div>}
        {result && <ResultCard result={result}/>}

        {resultIsValid && <section className="border border-outline-variant bg-surface-container-low p-5 sm:p-6">
          <h2 className="font-display text-headline-lg uppercase text-on-surface">Organizer check-in</h2>
          {!organizer && <p className="mt-3 font-body text-body-md text-primary">Connect the event organizer wallet before preparing a check-in transaction.</p>}
          {organizer && tx.state.status === 'idle' && <button type="button" disabled={txBusy} onClick={() => void prepareCheckIn()} className="mt-4 w-full bg-primary-container px-5 py-4 font-section-label text-section-label font-bold uppercase tracking-widest text-on-primary-container hover:brightness-110 disabled:cursor-wait disabled:opacity-50">Prepare check-in</button>}
          {tx.state.message && <div role={tx.state.status === 'error' ? 'alert' : 'status'} className={`mt-4 border p-4 ${tx.state.status === 'error' ? 'border-error-container bg-error-container/10 text-error' : tx.state.status === 'success' ? 'border-tertiary/50 bg-tertiary/10 text-tertiary' : 'border-outline-variant text-on-surface-variant'}`}>
            <p className="font-body text-body-md">{tx.state.message}</p>
            {tx.state.errorCode && <p className="mt-1 font-mono text-utility-sm">{tx.state.errorCode}</p>}
            {tx.state.review && <p className="mt-2 font-mono text-utility-sm">Network: Devnet · Fee payer: {shorten(tx.state.review.feePayer)}</p>}
            {tx.state.signature && <a href={`https://explorer.solana.com/tx/${tx.state.signature}?cluster=devnet`} target="_blank" rel="noreferrer" className="mt-2 block break-all font-mono text-utility-sm underline">View confirmed transaction</a>}
            {tx.state.status === 'ready' && <button type="button" disabled={txBusy} onClick={() => void sendCheckIn()} className="mt-4 w-full bg-tertiary-container px-5 py-4 font-section-label text-section-label font-bold uppercase tracking-widest text-on-tertiary-container hover:brightness-110 disabled:cursor-wait disabled:opacity-50">Sign check-in with Phantom</button>}
            {(tx.state.status === 'error' || tx.state.status === 'success') && <button type="button" onClick={tx.reset} className="mt-3 font-section-label text-section-label uppercase underline">Dismiss</button>}
          </div>}
        </section>}
      </div>
    </div>
  </section>
}
