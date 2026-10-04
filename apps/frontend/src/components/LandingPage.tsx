export function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <section className="flex min-h-0 w-full flex-1 items-center justify-center px-margin-mobile py-base lg:min-h-[819px] lg:px-margin-desktop lg:py-margin-desktop">
        <div className="relative mx-auto flex w-full max-w-6xl flex-col shadow-2xl lg:flex-row">
          <div className="ticket-paper perforated-edge-right relative flex min-h-[400px] w-full flex-col justify-between rounded-l-lg p-stub-padding text-background lg:w-2/3">
            <div>
              <p className="mb-4 font-section-label text-section-label text-outline">ADMIT ONE • GENERAL ADMISSION</p>
              <h1 className="mb-2 font-display text-headline-xl leading-none text-on-secondary">THE END OF<br />SCALPING.</h1>
              <p className="mt-4 max-w-md font-body text-body-md text-on-secondary">
                Tickets that can&apos;t be scalped. Built on Solana for total transparency and fairness.
              </p>
            </div>
            <div className="mt-8 flex gap-gutter border-t border-dashed border-outline-variant pt-4">
              <div>
                <p className="font-section-label text-section-label text-outline">DATE</p>
                <p className="mt-1 font-mono text-utility-mono text-on-secondary">FOREVER</p>
              </div>
              <div>
                <p className="font-section-label text-section-label text-outline">VENUE</p>
                <p className="mt-1 font-mono text-utility-mono text-on-secondary">THE BLOCKCHAIN</p>
              </div>
            </div>
          </div>

          <div className="ticket-paper perforated-edge-left relative flex w-full flex-col items-center justify-center border-t-2 border-dashed border-outline-variant p-stub-padding lg:w-1/3 lg:border-l-2 lg:border-t-0">
            <div className="mb-6 flex h-32 w-32 items-center justify-center bg-background" aria-label="Ticket QR symbol">
              <span className="material-symbols-outlined text-4xl text-secondary-fixed" aria-hidden="true">qr_code_2</span>
            </div>
            <div className="mb-6 text-center">
              <p className="font-section-label text-section-label text-outline">PRICE</p>
              <p className="font-display text-headline-lg text-on-secondary">0.5 SOL</p>
            </div>
            <div className="marquee-glow flex items-center gap-2 rounded bg-primary-container px-3 py-1 font-mono text-utility-mono font-bold text-black">
              <span className="material-symbols-outlined text-sm" aria-hidden="true">lock</span>
              CAPPED AT 110%
            </div>
          </div>
        </div>
      </section>
      <div className="my-8 w-full border-b border-dashed border-outline-variant" aria-hidden="true" />
    </div>
  )
}
