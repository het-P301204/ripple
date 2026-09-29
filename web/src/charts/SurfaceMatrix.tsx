import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { CATEGORY_META, ECOSYSTEM_META } from '@/lib/meta'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { CATEGORIES, type SurfaceData } from './surface'

/**
 * Restrained ecosystem x category matrix. Each row: mark, name, a thin bar for the ecosystem total, then the four
 * category counts as quiet cells (tinted by count). Zero cells stay empty. Cells open the filtered findings list.
 */
export function SurfaceMatrix({ data }: { data: SurfaceData }) {
  const reduced = !!useReducedMotion()
  const maxTotal = Math.max(1, ...data.ecos.map((e) => data.ecoTotals[e]))
  return (
    <div className="overflow-hidden rounded-r4 border border-hair bg-card shadow-card">
      <div className="hidden grid-cols-[120px_minmax(120px,1fr)_repeat(4,88px)] items-center gap-x-4 border-b border-white/[.05] px-6 py-3 md:grid" aria-hidden>
        <span /><span />
        {CATEGORIES.map((c) => <span key={c} className="text-center text-[10.5px] font-medium uppercase tracking-[.1em] text-ink-3">{CATEGORY_META[c].short}</span>)}
      </div>
      <ul>
        {data.ecos.map((eco, i) => {
          const total = data.ecoTotals[eco]
          return (
            <li key={eco} className={cn('grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3 px-5 py-4 md:grid-cols-[120px_minmax(120px,1fr)_repeat(4,88px)] md:px-6', i > 0 && 'border-t border-white/[.05]')}>
              <Link to={`/ecosystems/${eco}`} className="flex items-center gap-2.5 text-[13.5px] font-medium hover:text-white">
                <EcosystemMark ecosystem={eco} size={16} /> {ECOSYSTEM_META[eco].label}
              </Link>
              <div className="col-span-2 flex items-center gap-3 md:col-span-1">
                <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-white/[.06]" role="presentation">
                  <motion.div
                    className="h-full origin-left rounded-full bg-gradient-to-r from-accent to-magenta-soft"
                    style={{ width: `${(total / maxTotal) * 100}%` }}
                    initial={{ scaleX: reduced ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8, delay: 0.1 + i * 0.08, ease: EASE }}
                  />
                </div>
                <span className={cn('tnum w-6 text-right text-[14px] font-semibold', total === 0 && 'text-ink-3')}>{total}</span>
              </div>
              <div className="col-span-2 grid grid-cols-4 gap-2 md:col-span-4 md:col-start-3 md:row-start-1 md:contents">
                {CATEGORIES.map((c) => {
                  const n = data.cells[c][eco].length
                  const tint = n ? 0.07 + 0.22 * (n / Math.max(1, data.cellMax)) : 0
                  const inner = (
                    <>
                      <span className="tnum text-[14px] font-semibold">{n || <span className="text-ink-4">·</span>}</span>
                      <span className="mt-0.5 text-[10.5px] text-ink-3 md:hidden">{CATEGORY_META[c].short}</span>
                    </>
                  )
                  const cls = 'flex h-11 flex-col items-center justify-center rounded-r2 md:mx-auto md:w-full'
                  return n ? (
                    <Link
                      key={c} to={`/findings?category=${c}&ecosystem=${eco}`}
                      aria-label={`${n} ${CATEGORY_META[c].label} in ${ECOSYSTEM_META[eco].label}`}
                      className={cn(cls, 'border border-white/[.06] transition-colors duration-micro hover:border-accent-soft/50')}
                      style={{ background: `rgb(var(--c-accent) / ${tint.toFixed(3)})` }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <span key={c} className={cn(cls, 'border border-transparent')} aria-label={`No ${CATEGORY_META[c].label} in ${ECOSYSTEM_META[eco].label}`}>{inner}</span>
                  )
                })}
              </div>
              {total === 0 && <p className="col-span-2 -mt-1 text-[12px] text-ink-3 md:col-span-6 md:col-start-2">No exposed package signals detected.</p>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
