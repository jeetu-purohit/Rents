import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { WalletButton } from "./components/WalletButton";
import { ExploreEventsPage } from "./components/ExploreEventsPage";
import { EventDetailsPage } from "./components/EventDetailsPage";
import { LandingPage } from "./components/LandingPage";
import { MyStubsPage } from "./components/MyStubsPage";
import { ListForResalePage } from "./components/ListForResalePage";
import { OrganizerDashboardPage } from "./components/OrganizerDashboardPage";
import { ScannerPage } from "./components/ScannerPage";

const navigation = [
  { label: "Events", href: "/events" },
  { label: "My Stubs", href: "/my-tickets" },
  { label: "Organizer", href: "/organizer" },
  { label: "Scanner", href: "/scanner" },
];

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const updatePath = () => setPathname(window.location.pathname);

    window.addEventListener("popstate", updatePath);

    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  return pathname;
}

function AppLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return (
    <a href={href} onClick={navigate} className={className}>
      {children}
    </a>
  );
}

function AppShell({
  children,
  pathname,
}: {
  children: ReactNode;
  pathname: string;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-background text-on-background">
      {/* Subtle top accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 h-px bg-primary opacity-70"
      />

      <header className="sticky top-0 z-20 border-b border-dashed border-outline-variant/80 bg-background/95 backdrop-blur-sm">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-4 px-margin-mobile py-4 md:px-margin-desktop md:py-5"
        >
          {/* Brand */}
          <AppLink
                      href="/"
                      className="group flex shrink-0 items-center"
                      aria-label="RENTS home"
                    >
                      <img
                        src="/rents-logo.png"
                        alt="RENTS — Solana Ticketing"
                        className="h-10 w-auto object-contain transition-opacity duration-200 group-hover:opacity-80 sm:h-12"
                      />
          </AppLink>

          {/* Navigation */}
          <div className="order-3 flex w-full items-center justify-center sm:order-none sm:w-auto">
            <div className="flex w-full items-center justify-center gap-1 rounded-full border border-outline-variant/70 bg-surface/20 p-1 sm:w-auto sm:gap-0">
              {navigation.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href === "/events" && pathname.startsWith("/events/"));

                return (
                  <AppLink
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`group relative whitespace-nowrap rounded-full px-3 py-2 font-section-label text-section-label uppercase tracking-wide transition-all duration-200 sm:px-4 ${
                      isActive
                        ? "bg-primary text-background shadow-sm"
                        : "text-on-surface-variant hover:bg-surface hover:text-primary"
                    }`}
                  >
                    <span className="relative z-10">{item.label}</span>

                    {!isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-3 bottom-1 h-px origin-left scale-x-0 bg-primary transition-transform duration-200 group-hover:scale-x-100"
                      />
                    )}
                  </AppLink>
                );
              })}
            </div>
          </div>

          {/* Wallet */}
          <div className="shrink-0">
            <WalletButton />
          </div>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-margin-mobile py-10 md:px-margin-desktop md:py-16">
        {children}
      </main>

      <footer className="mt-auto w-full border-t border-dashed border-outline-variant bg-background">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-center gap-2 px-margin-mobile py-8 text-center md:px-margin-desktop md:py-10">
          <div className="flex items-center justify-center gap-3">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_rgba(255,196,92,0.35)]"
            />
            <span className="font-mono text-utility-sm uppercase tracking-[0.12em] text-primary">
              © 2026 RENTS TICKETING
            </span>
          </div>
      
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant">
            Built on Solana · Devnet
          </span>
        </div>
      </footer>
    </div>
  );
}

function NotFoundPage() {
  return (
    <section className="ticket-paper mx-auto flex min-h-64 w-full max-w-3xl flex-col items-center justify-center gap-4 border border-dashed border-outline-variant p-6 text-center text-background sm:p-stub-padding">
      <span
        className="material-symbols-outlined text-5xl text-outline"
        aria-hidden="true"
      >
        confirmation_number
      </span>
      <h1 className="font-display text-headline-lg uppercase">
        Page not found
      </h1>
      <p className="max-w-lg font-body text-body-md">
        This address does not match a RENTS page.
      </p>
    </section>
  );
}

function RouteContent({ pathname }: { pathname: string }) {
  if (pathname === "/") return <LandingPage />;
  if (pathname === "/events") return <ExploreEventsPage />;

  const eventDetailsMatch = pathname.match(/^\/events\/([^/]+)$/);
  if (eventDetailsMatch) {
    return (
      <EventDetailsPage id={decodeURIComponent(eventDetailsMatch[1])} />
    );
  }

  if (pathname === "/my-tickets") return <MyStubsPage />;

  const resaleMatch = pathname.match(/^\/my-tickets\/([^/]+)\/resell$/);
  if (resaleMatch) {
    return (
      <ListForResalePage mint={decodeURIComponent(resaleMatch[1])} />
    );
  }

  if (pathname === "/organizer") return <OrganizerDashboardPage />;
  if (pathname === "/scanner") return <ScannerPage />;

  return <NotFoundPage />;
}

function App() {
  const pathname = usePathname();

  return (
    <AppShell pathname={pathname}>
      <RouteContent pathname={pathname} />
    </AppShell>
  );
}

export default App;