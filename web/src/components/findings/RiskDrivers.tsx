import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import type { RiskDriver } from '@/types/scan'
import { EASE } from '@/lib/motion'
import { signed } from './labels'

/** Series colours shared by each driver's bar and its slice of the stacked total. */
const seg = (i: number, neg: boolean) => (neg ? 'rgb(var(--c-ok))' : `rgb(var(--c-accent) / ${Math.max(0.42, 1 - i * 0.16)})`)

/**
 * Transparent score breakdown. Each driver row has a bar (relative to the largest driver) and the total line
 * shows the same contributions stacked on the 0-100 scale, so the sum visibly equals the score.
 */
export function RiskDrivers({ drivers, score }: { drivers: RiskDriver[]; score: number }) {
  const reduced = !!useReducedMotion()
  const sum = drivers.reduce((a, d) => a + d.points, 0)
  const diff = Math.round(score - sum)
  const rows: RiskDriver[] = diff !== 0 ? [...drivers, { label: 'Calibration', points: diff, detail: 'Rounding and cross-signal adjustments' }] : drivers
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.points)))
  const positive = rows.filter((r) => r.points > 0)

  return (
    <div>
      <ul role="list" className="divide-y divide-white/[.05]">
        {rows.map((d, i) => {
          const neg = d.points < 0
          return (
            <li key={d.label + i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2.5 py-3.5 first:pt-0 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)_56px]">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">{d.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{d.detail}</p>
              </div>
              <div className="order-3 col-span-2 md:order-none md:col-span-1">
                <div className="h-2 overflow-hidden rounded-full bg-white/[.05]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: seg(i, neg), transformOrigin: 'left', width: `${(Math.abs(d.points) / max) * 100}%` }}
                    initial={{ scaleX: reduced ? 1 : 0 }} animate={{ scaleX: 1 }}
                    transition={{ duration: 0.8, delay: 0.1 + i * 0.07, ease: EASE }}
                  />
                </div>
              </div>
              <span className="tnum justify-self-end text-right text-[15px] font-semibold tracking-[-0.01em]" style={neg ? { color: 'rgb(var(--c-ok))' } : undefined}>
                {signed(d.points)}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-3 rounded-r3 border border-white/[.07] bg-black/25 p-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)_56px]">
        <div>
          <p className="text-[14px] font-semibold text-ink">Total risk score</p>
          <p className="mt-0.5 text-[12.5px] text-ink-3">Sum of the drivers above, out of 100</p>
        </div>
        <div className="order-3 col-span-2 md:order-none md:col-span-1" aria-hidden>
          <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-white/[.05]">
            {positive.map((d, i) => (
              <motion.div
                key={d.label + i} className="h-full rounded-full"
                style={{ background: seg(rows.indexOf(d), false) }}
                initial={{ width: reduced ? `${d.points}%` : 0 }} animate={{ width: `${d.points}%` }}
                transition={{ duration: 0.9, delay: 0.25 + i * 0.07, ease: EASE }}
              />
            ))}
          </div>
        </div>
        <span className="tnum justify-self-end text-right text-[20px] font-semibold tracking-[-0.02em]">{Math.round(score)}</span>
      </div>
    </div>
  )
}
