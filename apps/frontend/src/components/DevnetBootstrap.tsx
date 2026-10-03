import { BN, Program, type Idl, type Provider } from '@coral-xyz/anchor'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js'
import sharedIdlJson from 'shared/idl/rents_ticketing.json'
import type { CreateEventRequest, RentsTicketing } from 'shared'
import { api } from '../lib/api'
import { frontendConfig } from '../lib/config'
import { useSendBuilderTx } from '../hooks/useSendBuilderTx'

const PLATFORM_FEE_BPS = 100
const DEFAULT_IMAGE = 'https://lh3.googleusercontent.com/aida-public/AB6AXuAek51tuYwM1fajuY3NkOq5xSYDIL6HRECI933qIORsKHA-u_9dA3ILSNWpgWplrZDdPPymU671iJuuEcwmsZ6VsxHCky8SPL0Pwi4NTKklkYuo6vDFKanqTSy2416VtwtZqz7lsrGdrbqrZI42tgUFC0Nf0eo5QYAkUb9w26g_layUsZzOp8_YufDHSq_lfXUq9M_HQmt7YiJjzWDe62n4pojMU52YhFk66gCptFErDHlt7KZ7RJmBYMEkU22oXBETUQ2NstU-LSQ'
const configuredIdl: Idl = { ...(sharedIdlJson as Idl), address: frontendConfig.programId.toBase58() }
function eventIdSeed(): string {
  const requested = new URLSearchParams(window.location.search).get('eventId')
  if (requested && /^\d+$/.test(requested)) {
    window.localStorage.setItem('rents-devnet-fixture-event-id', requested)
    return requested
  }
  const existing = window.localStorage.getItem('rents-devnet-fixture-event-id')
  if (existing && /^\d+$/.test(existing)) return existing
  const value = String(Date.now())
  window.localStorage.setItem('rents-devnet-fixture-event-id', value)
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function deriveEventPda(organizer: PublicKey, eventId: string): PublicKey {
  const [eventPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('event'), organizer.toBuffer(), new BN(eventId, 10).toArrayLike(Buffer, 'le', 8)],
    frontendConfig.programId,
  )
  return eventPda
}

export function DevnetBootstrap() {
  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()
  const tx = useSendBuilderTx()
  const provider: Provider = useMemo(() => ({ connection }), [connection])
  const program = useMemo(() => new Program<RentsTicketing>(configuredIdl, provider), [provider])
  const [platformState, setPlatformState] = useState('Checking the on-chain PlatformConfig…')
  const [platformMissing, setPlatformMissing] = useState(false)
  const [platformAccount, setPlatformAccount] = useState<{ pda: string; admin: string; wallet: string; fee: number }>()
  const [platformReady, setPlatformReady] = useState(false)
  const [platformError, setPlatformError] = useState('')
  const [platformReview, setPlatformReview] = useState<{ pda: string; wallet: string; fee: number; rent: number; units?: number }>()
  const platformPending = useRef<{ transaction: Transaction; lastValidBlockHeight: number } | null>(null)
  const [eventId] = useState(eventIdSeed)
  const [name, setName] = useState('RENTS Devnet Demo')
  const [description, setDescription] = useState('Development-only Devnet fixture for verifying RENTS ticket minting.')
  const [venue, setVenue] = useState('Devnet Demo Hall')
  const [date, setDate] = useState('2027-10-03T18:00')
  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGE)
  const [metadataStatus, setMetadataStatus] = useState('')
  const [metadataError, setMetadataError] = useState('')
  const [mintBuilderResult, setMintBuilderResult] = useState('')
  const [fixture, setFixture] = useState<{ eventPda: string; eventName: string }>()

  const checkPlatform = useCallback(async () => {
    setPlatformMissing(false)
    const [platformPda] = PublicKey.findProgramAddressSync([Buffer.from('platform_config')], frontendConfig.programId)
    const config = await program.account.platformConfig.fetchNullable(platformPda)
    if (!config) {
      setPlatformAccount(undefined)
      setPlatformMissing(true)
      setPlatformReady(false)
      setPlatformState('No PlatformConfig exists on Devnet. Prepare its initialization below.')
      return
    }
    setPlatformMissing(false)
    setPlatformAccount({ pda: platformPda.toBase58(), admin: config.admin.toBase58(), wallet: config.platformWallet.toBase58(), fee: config.platformFeeBps })
    setPlatformReady(false)
    setPlatformState('PlatformConfig exists on chain; comparing it with GET /api/platform…')
    const apiValue = await api.getPlatform()
    if (apiValue.platformFeeBps !== config.platformFeeBps || apiValue.platformWallet !== config.platformWallet.toBase58()) {
      throw new Error('GET /api/platform does not match the on-chain PlatformConfig.')
    }
    setPlatformReady(true)
    setPlatformState(`Verified by chain and GET /api/platform: ${config.platformFeeBps} bps; fee wallet ${config.platformWallet.toBase58()}.`)
  }, [program])

  useEffect(() => {
    void checkPlatform().catch((error: unknown) => {
      setPlatformReady(false)
      setPlatformError(errorMessage(error))
      setPlatformState('PlatformConfig verification could not complete.')
    })
  }, [checkPlatform])

  const preparePlatform = useCallback(async () => {
    setPlatformError('')
    if (!publicKey) { setPlatformError('Connect Phantom before preparing PlatformConfig initialization.'); return }
    if (!signTransaction) { setPlatformError('The connected wallet cannot sign transactions.'); return }
    setPlatformState('Building and simulating the unsigned PlatformConfig transaction…')
    platformPending.current = null
    try {
      const [platformConfig] = PublicKey.findProgramAddressSync([Buffer.from('platform_config')], frontendConfig.programId)
      if (await program.account.platformConfig.fetchNullable(platformConfig)) {
        await checkPlatform()
        return
      }
      const instruction = await program.methods
        .initializePlatformConfig(publicKey, PLATFORM_FEE_BPS)
        .accountsStrict({ admin: publicKey, platformConfig, systemProgram: SystemProgram.programId })
        .instruction()
      const latest = await connection.getLatestBlockhash('confirmed')
      const transaction = new Transaction({ feePayer: publicKey, recentBlockhash: latest.blockhash }).add(instruction)
      const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')
      if (fee.value === null) throw new Error('Devnet did not return a network-fee estimate.')
      const rent = await connection.getMinimumBalanceForRentExemption(75, 'confirmed')
      const simulation = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, commitment: 'confirmed' })
      if (simulation.value.err) throw new Error(`PlatformConfig simulation failed: ${JSON.stringify(simulation.value.err)}\n${(simulation.value.logs ?? []).join('\n')}`)
      platformPending.current = { transaction, lastValidBlockHeight: latest.lastValidBlockHeight }
      setPlatformReview({ pda: platformConfig.toBase58(), wallet: publicKey.toBase58(), fee: fee.value, rent, units: simulation.value.unitsConsumed })
      setPlatformState('Simulation passed. Review the Devnet transaction; Phantom approval is a separate step.')
    } catch (error) {
      setPlatformError(errorMessage(error))
      setPlatformState('PlatformConfig transaction preparation failed.')
    }
  }, [checkPlatform, connection, program, publicKey, signTransaction])

  const signPlatform = useCallback(async () => {
    const prepared = platformPending.current
    const transaction = prepared?.transaction
    if (!prepared || !transaction || !publicKey || !signTransaction) { setPlatformError('Prepare the transaction again with the intended connected wallet.'); return }
    if (!transaction.feePayer?.equals(publicKey)) { setPlatformError('The connected wallet changed. Rebuild the transaction.'); return }
    setPlatformError('')
    setPlatformState('Waiting for you to approve PlatformConfig initialization in Phantom…')
    try {
      const blockhash = transaction.recentBlockhash
      if (!blockhash) throw new Error('Prepared transaction has no blockhash.')
      const signed = await signTransaction(transaction)
      const signature = await connection.sendRawTransaction(signed.serialize({ requireAllSignatures: true, verifySignatures: true }), { preflightCommitment: 'confirmed', maxRetries: 3 })
      setPlatformState(`Submitted ${signature}; waiting for Devnet confirmation…`)
      const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight: prepared.lastValidBlockHeight }, 'confirmed')
      if (confirmation.value.err) throw new Error(`PlatformConfig transaction failed: ${JSON.stringify(confirmation.value.err)} (signature ${signature})`)
      platformPending.current = null
      await checkPlatform()
      setPlatformReview(undefined)
      setPlatformState(`PlatformConfig confirmed and verified. Signature: ${signature}`)
    } catch (error) {
      setPlatformError(errorMessage(error))
      setPlatformState('PlatformConfig signing, confirmation, or API verification failed.')
    }
  }, [checkPlatform, connection, publicKey, signTransaction])

  async function prepareEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMetadataError('')
    setMetadataStatus('')
    setMintBuilderResult('')
    if (!platformReady) { setMetadataError('Initialize and verify PlatformConfig first.'); return }
    if (!publicKey) { setMetadataError('Connect Phantom before preparing the Event.'); return }
    try {
      const expectedPda = deriveEventPda(publicKey, eventId)
      const existing = await program.account.event.fetchNullable(expectedPda)
      if (existing) {
        if (!existing.organizer.equals(publicKey) || existing.eventId.toString() !== eventId || existing.maxTickets !== 100 || existing.ticketsSold >= existing.maxTickets || existing.basePrice.toString() !== '10000000' || existing.resaleCapBps !== 11_000 || existing.royaltyBps !== 500) {
          throw new Error('The existing account at the expected PDA does not match this fixture.')
        }
        await saveMetadata(expectedPda.toBase58())
        return
      }
      const review = await tx.prepare({
        kind: 'initialize-event',
        input: { eventId, maxTickets: 100, basePriceLamports: '10000000', resaleCapBps: 11_000, royaltyBps: 500 },
      })
      if (review.eventPda !== expectedPda.toBase58()) {
        tx.reset()
        throw new Error('Backend event PDA disagrees with the locally derived canonical PDA; do not sign this transaction.')
      }
    } catch (error) {
      setMetadataError(errorMessage(error))
    }
  }

  async function signEventAndSaveMetadata() {
    setMetadataError('')
    try {
      const result = await tx.send()
      if (!result.eventPda || !publicKey) throw new Error('Confirmed transaction omitted the Event PDA or organizer wallet.')
      const expectedPda = deriveEventPda(publicKey, eventId)
      if (result.eventPda !== expectedPda.toBase58()) throw new Error('Confirmed Event PDA does not match the canonical organizer + event ID derivation.')
      const event = await program.account.event.fetch(expectedPda)
      if (!event.organizer.equals(publicKey) || event.eventId.toString() !== eventId || event.maxTickets !== 100 || event.basePrice.toString() !== '10000000' || event.resaleCapBps !== 11_000 || event.royaltyBps !== 500) {
        throw new Error('Confirmed on-chain Event fields do not match the prepared fixture.')
      }
      setMetadataStatus('Event account confirmed and canonical PDA verified. Saving matching Mongo metadata…')
      await saveMetadata(expectedPda.toBase58())
    } catch (error) {
      setMetadataError(errorMessage(error))
    }
  }

  async function saveMetadata(eventPda: string) {
    if (!publicKey) throw new Error('Connect the organizer wallet before saving Event metadata.')
    const metadata: CreateEventRequest = {
      onChainEventId: eventId,
      organizerPubkey: publicKey.toBase58(),
      eventPda,
      name: name.trim(),
      description: description.trim(),
      venue: venue.trim(),
      date: new Date(date).toISOString(),
      imageUrl: imageUrl.trim(),
      maxTickets: 100,
      basePriceLamports: '10000000',
      resaleCapBps: 11_000,
      royaltyBps: 500,
    }
    const events = await api.getEvents()
    const existing = events.find((item) => item.eventPda === eventPda)
    if (existing) {
      if (existing.onChainEventId !== eventId || existing.organizerPubkey !== publicKey.toBase58() || existing.name !== metadata.name || existing.description !== metadata.description || existing.venue !== metadata.venue || new Date(existing.date).toISOString() !== metadata.date || existing.maxTickets !== metadata.maxTickets || existing.basePriceLamports !== metadata.basePriceLamports || existing.resaleCapBps !== metadata.resaleCapBps || existing.royaltyBps !== metadata.royaltyBps || existing.imageUrl !== metadata.imageUrl) {
        throw new Error('Mongo already contains metadata for this PDA with different fixture details.')
      }
    } else {
      await api.createEvent(metadata)
    }
    const verifiedEvents = await api.getEvents()
    const saved = verifiedEvents.find((item) => item.eventPda === eventPda)
    if (!saved || saved.onChainEventId !== eventId || saved.organizerPubkey !== publicKey.toBase58() || saved.name !== metadata.name || saved.description !== metadata.description || saved.venue !== metadata.venue || new Date(saved.date).toISOString() !== metadata.date || saved.maxTickets !== metadata.maxTickets || saved.basePriceLamports !== metadata.basePriceLamports || saved.resaleCapBps !== metadata.resaleCapBps || saved.royaltyBps !== metadata.royaltyBps || saved.imageUrl !== metadata.imageUrl) {
      throw new Error('Mongo Event metadata did not verify against the confirmed chain fixture.')
    }
    setMetadataStatus('On-chain Event and matching Mongo metadata are verified. Checking the backend mint builder…')
    const mintKey = PublicKey.unique().toBase58()
    const built = await api.buildMintTicket({
      buyerPubkey: publicKey.toBase58(),
      eventPda,
      mintPubkey: mintKey,
      eventName: name.trim(),
      uri: `${frontendConfig.apiBaseUrl}/metadata/${encodeURIComponent(mintKey)}`,
    })
    setMintBuilderResult(`Mint builder succeeded; unsigned ticket PDA: ${built.ticketPda}`)
    setFixture({ eventPda, eventName: name.trim() })
    setMetadataStatus('Devnet PlatformConfig, Event account, Mongo metadata, and backend mint builder are verified.')
  }

  const mintRoute = fixture ? `/devnet-mint-check?eventPda=${encodeURIComponent(fixture.eventPda)}&eventName=${encodeURIComponent(fixture.eventName)}` : ''

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="border-b border-dashed border-outline-variant pb-6">
        <p className="font-section-label text-section-label uppercase tracking-widest text-primary">DEVELOPMENT ONLY · DEVNET</p>
        <h1 className="mt-2 font-display text-headline-xl uppercase text-on-surface">Bootstrap one ticket fixture</h1>
        <p className="mt-3 font-body text-body-md text-on-surface-variant">Creates only the missing PlatformConfig, one Event account, and its metadata. Every transaction is simulated and shown before the separate Phantom signing action.</p>
        {window.location.origin !== 'http://localhost:5173' && <p role="alert" className="mt-3 font-body text-sm text-error">Open this route at http://localhost:5173/devnet-bootstrap. The backend allows that frontend origin; file:// and 127.0.0.1 origins cannot verify the API.</p>}
      </header>

      <div className="flex flex-col gap-3 border border-outline-variant bg-surface-container-low p-6">
        <h2 className="font-display text-headline-lg uppercase">PlatformConfig</h2>
        <p role="status" className="font-body text-body-md">{platformState}</p>
        {platformError && <p role="alert" className="whitespace-pre-wrap font-body text-sm text-error">{platformError}</p>}
        {platformAccount && <div className="grid gap-2 border-t border-outline-variant pt-3 font-mono text-xs sm:grid-cols-[10rem_1fr]"><dt>PlatformConfig PDA</dt><dd className="break-all">{platformAccount.pda}</dd><dt>Admin</dt><dd className="break-all">{platformAccount.admin}</dd><dt>Fee wallet</dt><dd className="break-all">{platformAccount.wallet}</dd><dt>Fee</dt><dd>{platformAccount.fee} bps</dd></div>}
        {platformMissing && !platformReview && <button onClick={() => void preparePlatform()} disabled={!publicKey} className="w-fit rounded bg-primary px-5 py-3 font-section-label text-section-label uppercase tracking-widest text-on-primary disabled:opacity-50">Prepare 100 bps initialization</button>}
        {platformAccount && !platformReady && <button onClick={() => { setPlatformError(''); void checkPlatform().catch((error: unknown) => setPlatformError(errorMessage(error))) }} className="w-fit font-section-label text-section-label uppercase tracking-widest underline">Retry PlatformConfig/API verification</button>}
        {platformReview && (
          <div className="flex flex-col gap-3 border-t border-outline-variant pt-4 font-mono text-xs">
            <p>Network: Solana Devnet · Fee: 100 bps (SPEC maximum 500 bps)</p>
            <p>Admin signer and platform wallet: {platformReview.wallet}</p>
            <p>PlatformConfig PDA: {platformReview.pda}</p>
            <p>Estimated network fee: {platformReview.fee.toLocaleString()} lamports · simulation units: {platformReview.units ?? 'not reported'}</p>
            <p>PlatformConfig rent: {platformReview.rent.toLocaleString()} lamports; network fee: {platformReview.fee.toLocaleString()} lamports. Both are paid by the connected wallet.</p>
            <button onClick={() => void signPlatform()} className="w-fit rounded bg-primary px-5 py-3 font-section-label text-section-label uppercase tracking-widest text-on-primary">Sign & initialize in Phantom</button>
          </div>
        )}
      </div>

      <form onSubmit={(event) => void prepareEvent(event)} className="flex flex-col gap-4 border border-outline-variant bg-surface-container-low p-6">
        <h2 className="font-display text-headline-lg uppercase">Event fixture</h2>
        <p className="font-mono text-xs">Event ID: {eventId} · 100 tickets · 0.01 SOL face price · 110% resale cap · 5% royalty</p>
        <label className="flex flex-col gap-2 font-section-label text-section-label uppercase tracking-widest">Event name<input required maxLength={24} value={name} onChange={(event) => setName(event.target.value)} className="rounded border border-outline-variant bg-background px-3 py-3 font-body text-sm normal-case tracking-normal" /></label>
        <label className="flex flex-col gap-2 font-section-label text-section-label uppercase tracking-widest">Description<input required value={description} onChange={(event) => setDescription(event.target.value)} className="rounded border border-outline-variant bg-background px-3 py-3 font-body text-sm normal-case tracking-normal" /></label>
        <label className="flex flex-col gap-2 font-section-label text-section-label uppercase tracking-widest">Venue<input required value={venue} onChange={(event) => setVenue(event.target.value)} className="rounded border border-outline-variant bg-background px-3 py-3 font-body text-sm normal-case tracking-normal" /></label>
        <label className="flex flex-col gap-2 font-section-label text-section-label uppercase tracking-widest">Date<input required type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className="rounded border border-outline-variant bg-background px-3 py-3 font-body text-sm normal-case tracking-normal" /></label>
        <label className="flex flex-col gap-2 font-section-label text-section-label uppercase tracking-widest">Public ticket image URL<input required type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} className="rounded border border-outline-variant bg-background px-3 py-3 font-mono text-xs normal-case tracking-normal" /></label>
        {metadataError && <p role="alert" className="whitespace-pre-wrap font-body text-sm text-error">{metadataError}</p>}
        {metadataStatus && <p role="status" className="font-body text-sm">{metadataStatus}</p>}
        {mintBuilderResult && <p className="break-all font-mono text-xs">{mintBuilderResult}</p>}
        {tx.state.status === 'ready' && tx.state.review && (
          <div className="flex flex-col gap-2 border-t border-outline-variant pt-4 font-mono text-xs">
            <p>Network: Solana Devnet · instruction: initialize_event</p>
            <p>Organizer: {publicKey?.toBase58()}</p>
            <p>Event ID: {eventId}</p>
            <p>Canonical Event PDA: {tx.state.review.eventPda}</p>
            <p>Base price: 10,000,000 lamports (0.01 SOL)</p>
            <p>Max tickets: 100 · resale cap: 11,000 bps · royalty: 500 bps</p>
            <p>Fee payer: {tx.state.review.feePayer}</p>
            <p>Estimated network fee: {tx.state.review.networkFeeLamports.toLocaleString()} lamports · Event rent: {tx.state.review.eventRentLamports?.toLocaleString() ?? 'not reported'} lamports · simulation units: {tx.state.review.simulationUnits ?? 'not reported'}</p>
            <p>Initial ticket purchase by your wallet will cost 0.0101 SOL plus mint/account rent.</p>
            <button type="button" onClick={() => void signEventAndSaveMetadata()} className="w-fit rounded bg-primary px-5 py-3 font-section-label text-section-label uppercase tracking-widest text-on-primary">Sign & create Event in Phantom</button>
          </div>
        )}
        {tx.state.status !== 'idle' && tx.state.status !== 'ready' && <p role={tx.state.status === 'error' ? 'alert' : 'status'} className="whitespace-pre-wrap font-body text-sm">{tx.state.message}</p>}
        {!tx.state.review && <button disabled={!platformReady || !publicKey || tx.busy} className="w-fit rounded bg-primary px-5 py-3 font-section-label text-section-label uppercase tracking-widest text-on-primary disabled:opacity-50">Prepare & simulate Event transaction</button>}
      </form>

      {fixture && <a href={mintRoute} className="w-fit rounded border border-primary px-5 py-3 font-section-label text-section-label uppercase tracking-widest text-primary">Continue to Task 5.2 mint check</a>}
    </section>
  )
}
