import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import { QRCodeSVG } from "qrcode.react";

/* Display-only demo constants. Import the real values if they live in shared config. */
const FACE_SOL = 0.5;
const CAP_MULTIPLIER = 1.1;
const AXIS_MAX = 3;

const STEPS = [
  { icon: "confirmation_number", title: "Buy at face value", body: "Mint your ticket straight from the event for the listed price, in SOL." },
  { icon: "account_balance_wallet", title: "Hold it in your wallet", body: "The ticket is a token you own. No account, no inbox, no screenshot." },
  { icon: "sell", title: "Resell, capped", body: "List it again at up to 110% of face value. The program rejects anything higher." },
  { icon: "qr_code_scanner", title: "Scan at the gate", body: "Show the QR code from My Stubs. Entry is checked on-chain and can't be reused." },
];

const MARQUEE = ["FACE VALUE ALWAYS", "VERIFIED ON-CHAIN", "RESALE CAPPED AT 110%", "NO BOTS AT THE DOOR", "EVERY TRANSFER IS PUBLIC"];

const FAQ = [
  { q: "What stops someone from reselling above the cap?", a: "The cap is part of the on-chain program. A listing above 110% of face value is rejected, so there is no workaround through a different page or app." },
  { q: "What do I need to buy a ticket?", a: "A Solana wallet such as Phantom with enough SOL for the ticket price. Connect it and your tickets appear in My Stubs." },
  { q: "Can I cancel a resale listing?", a: "Yes. Open My Stubs, choose Cancel listing, and sign the transaction with your wallet." },
  { q: "What happens to a ticket after it is scanned?", a: "It is marked as used on-chain. A used ticket can't be scanned again or listed for resale." },
];

const Q = { size: 128, level: "M" as const, bgColor: "#ffffff", fgColor: "#12131a" };

function ResaleDemo() {
  const [ask, setAsk] = useState(1.5);
  const ceiling = FACE_SOL * CAP_MULTIPLIER;
  const listed = Math.min(ask, ceiling);
  const blocked = Math.max(0, ask - ceiling);
  const capped = ask > ceiling;
  const pct = (v: number) => `${(v / AXIS_MAX) * 100}%`;

  return (
    <div className="ticket-paper perforated-edge-right relative mx-auto grid w-full max-w-6xl gap-8 rounded-lg p-6 text-background sm:p-stub-padding lg:grid-cols-2 lg:gap-12">
      <div>
        <p className="mb-2 font-section-label text-section-label uppercase text-outline">Resale desk</p>
        <h2 className="mb-3 font-display text-headline-lg uppercase leading-none text-on-secondary">Try to scalp one.</h2>
        <p className="max-w-md font-body text-body-md text-on-secondary">
          The cap is enforced by the program, not by a policy page. Name any price and see what the market accepts for a {FACE_SOL} SOL ticket.
        </p>
      </div>
      <div>
        <div className="flex items-end justify-between gap-4 border-b border-dashed border-outline-variant pb-3">
          <label htmlFor="ask" className="font-section-label text-section-label uppercase text-outline">Your asking price</label>
          <output className="font-display text-headline-lg text-on-secondary">{ask.toFixed(2)} SOL</output>
        </div>

        {/* price track: face value, cap line, blocked zone */}
        <div className="relative mt-6 h-8 border border-outline-variant bg-[#e6e2d7]" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 bg-primary-container transition-all duration-200" style={{ width: pct(listed) }} />
          <div className="absolute inset-y-0 bg-error-container/60 transition-all duration-200" style={{ left: pct(ceiling), width: pct(blocked) }} />
          <div className="absolute -top-2 bottom-[-8px] border-l-2 border-dashed border-black" style={{ left: pct(ceiling) }} />
        </div>
        <div className="relative mt-1 h-4 font-mono text-utility-sm text-outline" aria-hidden="true">
          <span className="absolute left-0">0</span>
          <span className="absolute -translate-x-1/2 font-bold text-on-secondary" style={{ left: pct(ceiling) }}>CAP {ceiling.toFixed(2)}</span>
          <span className="absolute right-0">{AXIS_MAX}</span>
        </div>

        <input id="ask" type="range" min={FACE_SOL} max={AXIS_MAX} step={0.05} value={ask} onChange={(e) => setAsk(parseFloat(e.target.value))} className="mt-4 w-full accent-primary-container" />
        <div className="mt-4 grid grid-cols-2 gap-gutter">
          <div className="border border-dashed border-outline-variant p-3">
            <p className="font-section-label text-section-label uppercase text-outline">Listed at</p>
            <p className="font-mono text-utility-mono font-bold text-on-secondary">{listed.toFixed(2)} SOL</p>
          </div>
          <div className="border border-dashed border-outline-variant p-3">
            <p className="font-section-label text-section-label uppercase text-outline">Scalper profit blocked</p>
            <p className={`font-mono text-utility-mono font-bold ${capped ? "text-error-container" : "text-outline"}`}>{blocked.toFixed(2)} SOL</p>
          </div>
        </div>
        <p className="mt-4 font-mono text-utility-sm text-on-secondary" aria-live="polite">
          {capped ? `REJECTED ABOVE ${ceiling.toFixed(2)} SOL. Your listing is held at the cap.` : "WITHIN THE CAP. This listing goes through."}
        </p>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [torn, setTorn] = useState(false);
  const tiltRef = useRef<HTMLDivElement>(null);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el || torn) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 6}deg`);
    el.style.setProperty("--rx", `${(0.5 - (e.clientY - r.top) / r.height) * 4}deg`);
  };
  const onLeave = () => {
    tiltRef.current?.style.setProperty("--ry", "0deg");
    tiltRef.current?.style.setProperty("--rx", "0deg");
  };

  return (
    <div className="flex flex-1 flex-col overflow-x-clip">
      <style>{`
        @keyframes rents-deal { from { opacity: 0; transform: translateY(-48px) rotate(-4deg); } to { opacity: 1; transform: none; } }
        .rents-deal { animation: rents-deal .9s cubic-bezier(.2,.9,.25,1) both; }
        .rents-tilt { --rx: 0deg; --ry: 0deg; transform: perspective(1400px) rotateX(var(--rx)) rotateY(var(--ry)) rotate(-1deg); transition: transform .3s ease-out; }
        .rents-stub { transition: transform .7s cubic-bezier(.5,-.2,.3,1.2), opacity .7s ease; transform-origin: top left; }
        .rents-stub[data-torn="true"] { transform: translate(28px, 36px) rotate(7deg); }
        @media (min-width: 1024px) { .rents-stub[data-torn="true"] { transform: translate(44px, 28px) rotate(6deg); } }
        @keyframes rents-left { to { transform: translateX(-50%); } }
        @keyframes rents-right { from { transform: translateX(-50%); } to { transform: none; } }
        .rents-left { animation: rents-left 32s linear infinite; }
        .rents-right { animation: rents-right 40s linear infinite; }
        details[open] .rents-plus { transform: rotate(45deg); }
        @media (prefers-reduced-motion: reduce) { .rents-deal, .rents-left, .rents-right { animation: none; } .rents-tilt, .rents-stub { transition: none; } }
      `}</style>

      {/* HERO */}
      <section className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-10 px-margin-mobile py-base lg:min-h-[819px] lg:px-margin-desktop lg:py-margin-desktop">
        <div className="relative mx-auto w-full max-w-6xl" onPointerMove={onMove} onPointerLeave={onLeave}>
          <div className="ticket-paper absolute inset-0 hidden translate-x-3 translate-y-3 rotate-1 rounded-lg opacity-40 lg:block" aria-hidden="true" />
          <div className="rents-deal">
            <div ref={tiltRef} className="rents-tilt relative flex w-full flex-col shadow-2xl lg:flex-row">
              <div className="ticket-paper perforated-edge-right relative flex min-h-[400px] w-full flex-col justify-between rounded-l-lg p-stub-padding text-background lg:w-2/3">
                <div>
                  <p className="mb-4 font-section-label text-section-label text-outline">ADMIT ONE • GENERAL ADMISSION</p>
                  <h1 className="mb-2 font-display text-[clamp(3.25rem,10vw,8.5rem)] leading-[0.88] text-on-secondary">
                    THE END OF
                    <br />
                    SCALPING.
                  </h1>
                  <p className="mt-4 max-w-md font-body text-body-md text-on-secondary">
                    Tickets that can&apos;t be scalped. Built on Solana for total transparency and fairness.
                  </p>
                </div>
                <div className="mt-8 flex flex-wrap items-end justify-between gap-4 border-t border-dashed border-outline-variant pt-4">
                  <div className="flex gap-gutter">
                    <div>
                      <p className="font-section-label text-section-label text-outline">DATE</p>
                      <p className="mt-1 font-mono text-utility-mono text-on-secondary">FOREVER</p>
                    </div>
                    <div>
                      <p className="font-section-label text-section-label text-outline">VENUE</p>
                      <p className="mt-1 font-mono text-utility-mono text-on-secondary">THE BLOCKCHAIN</p>
                    </div>
                  </div>
                  <a href="/events" className="bg-background px-5 py-3 font-section-label text-section-label uppercase text-inverse-surface transition-colors hover:bg-surface-container-high">
                    Browse events
                  </a>
                </div>
              </div>

              <div
                data-torn={torn}
                className="rents-stub ticket-paper perforated-edge-left relative flex w-full flex-col items-center justify-center border-t-2 border-dashed border-outline-variant p-stub-padding shadow-xl lg:w-1/3 lg:border-l-2 lg:border-t-0"
              >
                <div className="mb-6 border border-black bg-white p-2" aria-label="Ticket QR symbol" role="img">
                  <QRCodeSVG value="rents" {...Q} />
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
          </div>
        </div>

        <button
          type="button"
          aria-pressed={torn}
          onClick={() => setTorn((v) => !v)}
          className="flex items-center gap-2 border border-dashed border-outline-variant px-4 py-2 font-mono text-utility-sm font-bold text-primary transition-colors hover:bg-surface-container-high"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">{torn ? "undo" : "content_cut"}</span>
          {torn ? "STUB TORN. PUT IT BACK" : "TEAR OFF THE STUB"}
        </button>
      </section>

      {/* MARQUEE: two rows, opposite directions */}
      <div className="border-y border-black" aria-hidden="true">
        <div className="overflow-hidden bg-primary-container py-2 text-on-primary-container">
          <div className="rents-left flex w-max whitespace-nowrap font-mono text-utility-mono font-bold">
            {[0, 1].map((c) => (
              <div key={c} className="flex">{MARQUEE.map((m) => <span key={`${c}-${m}`} className="px-6">{m} •</span>)}</div>
            ))}
          </div>
        </div>
        <div className="overflow-hidden bg-[#f4ebd0] py-2 text-background">
          <div className="rents-right flex w-max whitespace-nowrap font-mono text-utility-mono font-bold">
            {[0, 1].map((c) => (
              <div key={c} className="flex">{[...MARQUEE].reverse().map((m) => <span key={`${c}-${m}`} className="px-6">{m} •</span>)}</div>
            ))}
          </div>
        </div>
      </div>

      {/* BIG NUMBERS (facts from the product itself) */}
      <section className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-gutter px-margin-mobile py-16 sm:grid-cols-3 lg:px-margin-desktop lg:py-24">
        {[
          ["110%", "The most any ticket can resell for"],
          ["1", "Scan per ticket. Used tickets stay used"],
          ["0", "Hidden fees between you and the face value"],
        ].map(([n, label]) => (
          <div key={n} className="border-t-2 border-dashed border-outline-variant pt-4">
            <p className="font-display text-[clamp(4rem,9vw,7rem)] leading-none text-primary">{n}</p>
            <p className="mt-2 max-w-[22ch] font-mono text-utility-mono text-on-surface-variant">{label}</p>
          </div>
        ))}
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto w-full max-w-6xl px-margin-mobile pb-16 lg:px-margin-desktop lg:pb-24">
        <header className="mb-10 border-b border-dashed border-outline-variant pb-6">
          <h2 className="mb-2 font-display text-headline-xl uppercase text-primary">How a stub works</h2>
          <p className="font-mono text-utility-mono text-on-surface-variant">From mint to gate in four steps.</p>
        </header>
        <ol className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col rounded-sm border border-outline-variant bg-[#f4ebd0] p-5 text-background transition-transform duration-200 hover:-translate-y-1 lg:odd:translate-y-6 lg:odd:hover:translate-y-5">
              <div className="mb-4 flex items-center justify-between border-b border-dotted border-outline-variant pb-3">
                <span className="font-mono text-utility-sm font-bold">STEP {i + 1}</span>
                <span className="material-symbols-outlined text-outline" aria-hidden="true">{s.icon}</span>
              </div>
              <h3 className="mb-2 font-display text-headline-lg-mobile uppercase leading-tight">{s.title}</h3>
              <p className="font-body text-body-md">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* RESALE DEMO */}
      <section className="px-margin-mobile pb-16 pt-6 lg:px-margin-desktop lg:pb-24">
        <ResaleDemo />
      </section>

      {/* FAQ */}
      <section className="mx-auto w-full max-w-4xl px-margin-mobile pb-16 lg:px-margin-desktop lg:pb-24">
        <h2 className="mb-6 border-b border-dashed border-outline-variant pb-4 font-display text-headline-lg uppercase text-primary">Before you buy</h2>
        {FAQ.map((f) => (
          <details key={f.q} className="group border-b border-dashed border-outline-variant py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-body text-body-md font-bold text-on-background">
              {f.q}
              <span className="rents-plus material-symbols-outlined shrink-0 text-primary-container transition-transform duration-200" aria-hidden="true">add</span>
            </summary>
            <p className="mt-3 max-w-2xl font-body text-body-md text-on-surface-variant">{f.a}</p>
          </details>
        ))}
      </section>

      {/* CLOSING CTA */}
      <section className="px-margin-mobile pb-16 lg:px-margin-desktop">
        <div className="ticket-paper perforated-edge-right relative mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-8 overflow-hidden rounded-lg p-6 text-background sm:p-stub-padding md:flex-row md:items-end">
          <div>
            <p className="mb-2 font-section-label text-section-label uppercase text-outline">Admit one • no markup</p>
            <h2 className="font-display text-[clamp(2.5rem,7vw,5.5rem)] uppercase leading-[0.9] text-on-secondary">
              Your seat, at the
              <br />
              price it was meant to be.
            </h2>
          </div>
          <a href="/events" className="marquee-glow shrink-0 bg-primary-container px-8 py-5 font-section-label text-section-label uppercase text-on-primary-container hover:brightness-110">
            Browse events
          </a>
        </div>
      </section>

      <div className="my-8 w-full border-b border-dashed border-outline-variant" aria-hidden="true" />
    </div>
  );
}