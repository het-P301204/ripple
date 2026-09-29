import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { pageVariants } from '@/lib/motion'
import { AmbientBackground } from '@/components/brand/AmbientBackground'
import { Drawer } from '@/components/ui/Modal'
import { Sidebar, SidebarContent } from './Sidebar'
import { Topbar } from './Topbar'
import { NAV } from '@/lib/nav'

/**
 * App chrome: fixed sidebar (lg+), mobile drawer, sticky topbar and the animated page outlet.
 * Pages render inside <PageTransition> keyed by pathname, so every route change fades in.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false)
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const firstNav = useRef(true)
  useEffect(() => {
    setDrawer(false)
    // a11y: on route change (not first paint) reset scroll, name the page in the tab title, and move focus to <main>
    // so screen-reader and keyboard users land at the top of the new view instead of on a vanished link.
    window.scrollTo(0, 0)
    const item = NAV.find((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + '/')))
    document.title = item && item.to !== '/' ? `${item.label} · RIPPLE` : 'RIPPLE — Supply-chain attack surface'
    if (firstNav.current) { firstNav.current = false; return }
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="relative min-h-screen">
      <AmbientBackground />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-r2 focus:bg-elevated focus:px-4 focus:py-2">Skip to content</a>
      <Sidebar />
      <Drawer open={drawer} onClose={() => setDrawer(false)} label="Navigation" hideClose className="bg-sidebar">
        <SidebarContent idPrefix="mob" onNavigate={() => setDrawer(false)} />
      </Drawer>
      <div className="relative z-10 lg:pl-[var(--sidebar-w)]">
        <Topbar onMenu={() => setDrawer(true)} />
        <main ref={mainRef} id="main" tabIndex={-1} className="page-x mx-auto w-full max-w-[1280px] pb-24 pt-6 outline-none md:pt-8">
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * Route-keyed page transition: opacity + 6px rise (200ms). No AnimatePresence / exit: the old page unmounts immediately so navigation
 * is never delayed by a leave animation and only one page subtree is ever animating.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const reduced = !!useReducedMotion()
  return (
    <motion.div key={pathname} variants={pageVariants(reduced)} initial="initial" animate="animate">
      {children}
    </motion.div>
  )
}
