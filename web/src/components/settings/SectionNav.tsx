import { useEffect, useState, type ReactNode } from 'react'
import { useReducedMotion } from '@/lib/perf'
import { cn } from '@/lib/cn'

export interface SectionDef { id: string; label: string; icon: ReactNode }

/** Sticky in-page nav (desktop). Highlights the section nearest the top; click scrolls + moves focus. */
export function SectionNav({ sections }: { sections: SectionDef[] }) {
  const [active, setActive] = useState(sections[0]?.id)
  const reduced = !!useReducedMotion()

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, number>()
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : Infinity))
        const visible = [...seen.entries()].filter(([, t]) => t !== Infinity).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))
        if (visible[0]) setActive(visible[0][0])
      },
      { rootMargin: '-90px 0px -55% 0px', threshold: [0, 0.1] },
    )
    sections.forEach((s) => { const el = document.getElementById(s.id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [sections])

  const go = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    setActive(id)
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }

  return (
    <nav aria-label="Settings sections" className="hidden lg:sticky lg:top-[calc(var(--topbar-h)+28px)] lg:block lg:self-start">
      <ul className="space-y-0.5">
        {sections.map((s) => {
          const on = s.id === active
          return (
            <li key={s.id}>
              <button
                type="button" onClick={() => go(s.id)} aria-current={on ? 'true' : undefined}
                className={cn(
                  'group relative flex w-full items-center gap-2.5 rounded-r1 px-3 py-2 text-left text-[13px] font-medium transition-colors duration-micro ease-ripple',
                  on ? 'bg-white/[.05] text-ink' : 'text-ink-3 hover:bg-white/[.03] hover:text-ink-2',
                )}
              >
                <span aria-hidden className={cn('absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent-soft transition-opacity duration-comp ease-ripple', on ? 'opacity-100' : 'opacity-0')} />
                <span className={cn('transition-colors', on ? 'text-accent-soft' : 'text-ink-4 group-hover:text-ink-3')}>{s.icon}</span>
                {s.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
