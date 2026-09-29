import { forwardRef, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowRight, ChevronDown } from 'lucide-react'
import type { Finding } from '@/types/scan'
import { EASE, tween } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { FindingCard } from '@/components/FindingCard'
import { signed } from './labels'

/** Compact evidence + risk-driver preview shown when a finding row is expanded in the list. */
function FindingPreview({ finding: f, id }: { finding: Finding; id: string }) {
  const reduced = !!useReducedMotion()
  const evidence = f.evidence.slice(0, 4)
  const drivers = f.drivers.slice(0, 4)
  const max = Math.max(1, ...drivers.map((d) => Math.abs(d.points)))
  return (
    <motion.div
      id={id} role="region" aria-label={`Preview of ${f.package}`}
      initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
      animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1, transition: tween(0.34) }}
      exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, transition: tween(0.22) }}
      className="overflow-hidden"
    >
      <div className="mt-2 grid gap-x-8 gap-y-6 rounded-r3 border border-hair bg-black/25 p-5 md:grid-cols-2">
        <div className="min-w-0">
          <p className="eyebrow mb-3">Evidence</p>
          <dl className="space-y-2.5">
            {evidence.map((e, i) => (
              <div key={e.label + i} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 text-[12.5px]">
                <dt className="text-ink-3">{e.label}</dt>
                <dd className={cn('min-w-0 break-words text-ink-2 [overflow-wrap:anywhere]', e.mono && 'mono text-[12px]')}>{e.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="min-w-0">
          <p className="eyebrow mb-3">Risk drivers</p>
          <ul role="list" className="space-y-3">
            {drivers.map((d, i) => (
              <li key={d.label + i}>
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="truncate text-ink-2">{d.label}</span>
                  <span className="tnum font-semibold text-ink">{signed(d.points)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[.05]">
                  <motion.div
                    className="h-full rounded-full bg-accent/80" style={{ transformOrigin: 'left', width: `${(Math.abs(d.points) / max) * 100}%` }}
                    initial={{ scaleX: reduced ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, delay: 0.1 + i * 0.05, ease: EASE }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-white/[.05] pt-4 md:col-span-2">
          <p className="min-w-0 truncate text-[12.5px] text-ink-3">Rule <span className="mono text-ink-2">{f.rule_id}</span></p>
          <Link to={`/findings/${encodeURIComponent(f.id)}`} className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:text-white">
            Open full finding <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

/**
 * One row of the findings list: the standard FindingCard (whole card links to the detail page) plus a chevron that
 * expands an inline preview without leaving the page. `index` drives the staggered entrance (first ~12 only).
 */
export const FindingListItem = forwardRef<HTMLLIElement, { finding: Finding; index: number }>(function FindingListItem(
  { finding: f, index }, ref,
) {
  const [open, setOpen] = useState(false)
  const reduced = !!useReducedMotion()
  const pid = `fp-${useId().replace(/:/g, '')}`
  const delay = reduced ? 0 : Math.min(index, 8) * 0.03
  return (
    <motion.li
      ref={ref}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE, delay } }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
    >
      <div className="relative">
        <FindingCard finding={f} className="pr-16" />
        <button
          type="button" aria-expanded={open} aria-controls={pid}
          aria-label={`${open ? 'Hide' : 'Show'} evidence preview for ${f.package}`}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'absolute right-3.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-r2 border border-white/[.07] bg-black/20 text-ink-3',
            'transition-colors duration-micro hover:bg-white/[.07] hover:text-ink', open && 'bg-white/[.06] text-ink',
          )}
        >
          <ChevronDown size={16} aria-hidden className={cn('transition-transform duration-comp ease-ripple', open && 'rotate-180')} />
        </button>
      </div>
      <AnimatePresence initial={false}>{open && <FindingPreview finding={f} id={pid} />}</AnimatePresence>
    </motion.li>
  )
})
