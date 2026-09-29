import { Link } from 'react-router-dom'
import type { LookalikeGroup } from '@/types/scan'
import { SEVERITY_META } from '@/lib/meta'
import { plural } from '@/lib/format'
import { cn } from '@/lib/cn'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { SeverityDot } from '@/components/ui/SeverityBadge'
import { groupHref, worstSeverity } from './lookalike'

/**
 * Picks the original package. Vertical list on large screens, a horizontally scrolling strip below.
 * Each entry is a real link, so the selection lives in the URL (/typosquatting/:pkg).
 */
export function LookalikeSelector({ groups, activeIndex }: { groups: LookalikeGroup[]; activeIndex: number }) {
  const names = groups.map((g) => g.original)
  const dupes = new Set(names.filter((n, i) => names.indexOf(n) !== i))
  return (
    <nav aria-label="Original packages">
      <p className="eyebrow mb-3 hidden lg:block">Original package</p>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {groups.map((g, i) => {
          const worst = worstSeverity(g.candidates)
          const active = i === activeIndex
          return (
            <li key={`${g.ecosystem}:${g.original}`} className="shrink-0 lg:shrink">
              <Link
                to={groupHref(g, dupes.has(g.original))}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-w-[168px] items-center gap-3 rounded-r3 border px-3.5 py-3 transition-[background,border-color] duration-micro ease-ripple lg:min-w-0',
                  active ? 'border-accent-soft/45 bg-accent/[.09]' : 'border-white/[.07] bg-card hover:border-white/[.15] hover:bg-elevated',
                )}
              >
                <EcosystemMark ecosystem={g.ecosystem} size={16} />
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[13.5px] font-medium">{g.original}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-3">
                    {plural(g.candidates.length, 'lookalike')}
                  </span>
                </span>
                <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: SEVERITY_META[worst].text }} title={`Worst: ${SEVERITY_META[worst].label}`}>
                  <SeverityDot severity={worst} />
                  <span className="hidden sm:inline">{SEVERITY_META[worst].label}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
