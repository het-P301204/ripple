import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Github } from 'lucide-react'
import { NAV } from '@/lib/nav'
import { cn } from '@/lib/cn'
import { springSoft } from '@/lib/motion'
import { useRipple } from '@/lib/store'
import { Logo } from '@/components/brand/Logo'

const REPO = 'https://github.com/het-P301204/ripple'

function isActive(pathname: string, to: string, end?: boolean) {
  return end ? pathname === to : pathname === to || pathname.startsWith(to + '/')
}

/** Sidebar content (used in the fixed desktop rail and inside the mobile Drawer). */
export function SidebarContent({ onNavigate, idPrefix = 'd' }: { onNavigate?: () => void; idPrefix?: string }) {
  const { pathname } = useLocation()
  const { health, offline, scanning, apiOnline } = useRipple()
  const regs = health ? Object.values(health.registries) : []
  const reachable = regs.filter((r) => r.state === 'ok').length
  const regText = offline ? 'Registries unavailable' : health?.mode === 'live' ? `${reachable}/${regs.length} registries reachable` : 'Offline analysis · no registry calls'
  const scannerText = scanning ? 'Scanning…' : offline ? 'Offline demo' : apiOnline ? 'Scanner ready' : 'Connecting…'
  const dot = scanning ? 'bg-accent-soft animate-pulse' : offline ? 'bg-amber' : apiOnline ? 'bg-ok' : 'bg-ink-4'

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] shrink-0 items-center px-5">
        <NavLink to="/" onClick={onNavigate} aria-label="RIPPLE home" className="rounded-r1"><Logo /></NavLink>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4 pt-3">
        <ul className="space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.to, item.end)
            const Icon = item.icon
            return (
              <li key={item.to}>
                <NavLink
                  to={item.to} end={item.end} onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex h-10 items-center gap-3 rounded-r2 px-3 text-[13.5px] font-medium transition-colors duration-micro',
                    active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                  )}
                >
                  {active && (
                    <>
                      <motion.span layoutId={`nav-bg-${idPrefix}`} transition={springSoft} aria-hidden className="absolute inset-0 rounded-r2 border border-white/[.06] bg-white/[.06]" />
                      <motion.span layoutId={`nav-bar-${idPrefix}`} transition={springSoft} aria-hidden className="absolute -left-3 top-2.5 h-5 w-[3px] rounded-full bg-accent-soft shadow-[0_0_10px_rgb(var(--c-accent)/.8)]" />
                    </>
                  )}
                  <Icon size={18} strokeWidth={active ? 2 : 1.75} className={cn('relative z-10 shrink-0', active && 'text-accent-soft')} aria-hidden />
                  <span className="relative z-10 truncate">{item.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="shrink-0 space-y-3 border-t border-hair p-4">
        <div className="space-y-1.5 text-[12px]">
          <div className="flex items-center gap-2 text-ink-2">
            <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden /> {scannerText}
          </div>
          <div className="pl-3.5 text-ink-4">{regText}</div>
        </div>
        <div className="flex items-center justify-between text-[11.5px] text-ink-4">
          <span className="mono">v{health?.version ?? '0.1.0'}</span>
          <a href={REPO} target="_blank" rel="noopener noreferrer" aria-label="RIPPLE on GitHub" className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-white/[.05] hover:text-ink-2">
            <Github size={14} /> GitHub
          </a>
        </div>
      </div>
    </div>
  )
}

/** Fixed desktop sidebar (>= lg). */
export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-w)] border-r border-hair bg-sidebar lg:block">
      <SidebarContent idPrefix="desk" />
    </aside>
  )
}
