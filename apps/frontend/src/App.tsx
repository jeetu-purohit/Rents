import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { WalletButton } from './components/WalletButton'
import { DevnetBootstrap } from './components/DevnetBootstrap'
import { DevnetMintCheck } from './components/DevnetMintCheck'
import { ExploreEventsPage } from './components/ExploreEventsPage'
import { EventDetailsPage } from './components/EventDetailsPage'
import { LandingPage } from './components/LandingPage'
import { MyStubsPage } from './components/MyStubsPage'
import { ListForResalePage } from './components/ListForResalePage'
import { OrganizerDashboardPage } from './components/OrganizerDashboardPage'
import { ScannerPage } from './components/ScannerPage'

const navigation = [
  { label: 'Events', href: '/events' },
  { label: 'Marketplace', href: '/marketplace' },
  { label: 'My Stubs', href: '/my-tickets' },
  { label: 'Organizer', href: '/organizer' },
  { label: 'Scanner', href: '/scanner' },
]

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname)

  useEffect(() => {
    const updatePath = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', updatePath)
    return () => window.removeEventListener('popstate', updatePath)
  }, [])

  return pathname
}

function AppLink({ href, children, className = '' }: {
  href: string
  children: ReactNode
  className?: string
}) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    window.history.pushState({}, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  return <a href={href} onClick={navigate} className={className}>{children}</a>
}

function AppShell({ children, pathname }: { children: ReactNode; pathname: string }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-on-background">
      <header className="sticky top-0 z-20 border-b border-dashed border-outline-variant bg-background">
        <nav aria-label="Main navigation" className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-4 px-margin-mobile py-base md:px-margin-desktop">
          <AppLink href="/" className="font-display text-headline-lg tracking-widest text-primary">RENTS</AppLink>
          <div className="order-3 flex w-full items-center justify-center gap-5 overflow-x-auto pb-1 sm:order-none sm:w-auto sm:pb-0 md:gap-gutter">
            {navigation.map((item) => (
              <AppLink key={item.href} href={item.href} className={`whitespace-nowrap font-section-label text-section-label uppercase transition-colors hover:text-primary ${pathname === item.href || (item.href === '/events' && pathname.startsWith('/events/')) ? 'border-b-2 border-primary pb-1 text-primary' : 'text-on-surface-variant'}`}>
                {item.label}
              </AppLink>
            ))}
          </div>
          <WalletButton />
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-margin-mobile py-10 md:px-margin-desktop md:py-16">
        {children}
      </main>
      <footer className="border-t border-dashed border-outline-variant bg-background">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col items-center justify-between gap-base px-margin-mobile py-gutter md:flex-row md:px-margin-desktop">
          <span className="font-mono text-utility-sm text-primary">© 2024 RENTS TICKETING. BUILT ON SOLANA.</span>
          <nav aria-label="Footer navigation" className="flex flex-wrap justify-center gap-5">
            {['Terms of Service', 'Privacy Policy', 'Verify Contract', 'Support'].map((label) => (
              <a key={label} href="#" onClick={(event) => event.preventDefault()} className="font-section-label text-section-label uppercase tracking-widest text-on-surface-variant transition-colors hover:text-tertiary">{label}</a>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-gutter">
      <div className="border-b border-dashed border-outline-variant pb-gutter">
        <p className="mb-2 font-section-label text-section-label uppercase tracking-widest text-primary">RENTS · DEVNET</p>
        <h1 className="font-display text-headline-xl uppercase text-on-surface">{title}</h1>
        <p className="mt-4 max-w-2xl font-body text-body-md text-on-surface-variant">{description}</p>
      </div>
      <div className="ticket-paper relative flex min-h-48 flex-col justify-between border border-outline-variant p-stub-padding text-background md:flex-row md:items-center">
        <div>
          <p className="font-section-label text-section-label uppercase tracking-widest text-outline">ADMIT ONE · RENTS TICKETING</p>
          <h2 className="mt-2 font-display text-headline-lg uppercase">Your next event belongs here.</h2>
        </div>
        <span className="material-symbols-outlined mt-6 text-5xl text-primary-container md:mt-0" aria-hidden="true">confirmation_number</span>
        <span className="pointer-events-none absolute inset-y-0 right-1/3 hidden border-l-2 border-dashed border-outline-variant md:block" aria-hidden="true" />
      </div>
    </section>
  )
}

function RouteContent({ pathname }: { pathname: string }) {
  if (pathname === '/devnet-bootstrap') return <DevnetBootstrap />
  if (pathname === '/devnet-mint-check') return <DevnetMintCheck />
  if (pathname === '/') return <LandingPage />
  if (pathname === '/events') return <ExploreEventsPage />
  if (pathname === '/marketplace') return <PlaceholderPage title="Ticket marketplace" description="Discover and secure authentic tickets on Solana." />
  const eventDetailsMatch = pathname.match(/^\/events\/([^/]+)$/)
  if (eventDetailsMatch) return <EventDetailsPage id={decodeURIComponent(eventDetailsMatch[1])} />
  if (pathname === '/my-tickets') return <MyStubsPage />
  const resaleMatch = pathname.match(/^\/my-tickets\/([^/]+)\/resell$/)
  if (resaleMatch) return <ListForResalePage mint={decodeURIComponent(resaleMatch[1])} />
  if (pathname === '/organizer') return <OrganizerDashboardPage />
  if (pathname === '/scanner') return <ScannerPage />
  if (pathname === '/organizer/scan') return <PlaceholderPage title="Gate scan" description="Organizer ticket scanning will appear here." />
  return <PlaceholderPage title="Page not found" description="This route is not part of RENTS." />
}

function App() {
  const pathname = usePathname()
  return <AppShell pathname={pathname}><RouteContent pathname={pathname} /></AppShell>
}

export default App
