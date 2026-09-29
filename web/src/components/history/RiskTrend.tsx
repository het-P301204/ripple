import { useId, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { ScanHistoryEntry } from '@/types/scan'
import { SEVERITY_META, sevColor } from '@/lib/meta'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { Card } from '@/components/ui/Card'
import { CountUp } from '@/components/ui/CountUp'
import { fmtScanDay } from './helpers'

const W = 640, H = 96, PX = 14, PY = 12

/**
 * Risk over time across saved scans (oldest → newest, up to 20). The scan that is open in the
 * dashboard is ringed; hover moves the readout. The table below carries the same data for keyboard/AT users.
 */
export function RiskTrend({ entries, currentId }: { entries: ScanHistoryEntry[]; currentId: string | null }) {
  const reduced = !!useReducedMotion()
  const gid = useId().replace(/:/g, '')
  const [hover, setHover] = useState<number | null>(null)

  const series = useMemo(() => [...entries].slice(0, 20).reverse(), [entries])
  const n = series.length
  const pts = useMemo(
    () => series.map((e, i) => [n === 1 ? W / 2 : PX + (i / (n - 1)) * (W - PX * 2), PY + (1 - e.risk_score / 100) * (H - PY * 2)] as const),
    [series, n],
  )
  const latest = entries[0]
  const prev = entries[1]
  const delta = latest && prev ? latest.risk_score - prev.risk_score : null
  const curIdx = series.findIndex((e) => e.id === currentId)
  const focus = hover ?? (curIdx >= 0 ? curIdx : n - 1)
  const fe = series[focus]
  if (!latest) return null

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = n > 1 ? `${line} L${pts[n - 1][0]},${H} L${pts[0][0]},${H} Z` : ''

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (n < 2) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W
    let best = 0
    pts.forEach((p, i) => { if (Math.abs(p[0] - x) < Math.abs(pts[best][0] - x)) best = i })
    setHover(best)
  }

  return (
    <motion.div initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
      <Card radius={4} className="overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="border-b border-white/[.05] p-5 md:border-b-0 md:border-r md:p-6">
            <p className="eyebrow">Latest risk</p>
            <div className="mt-2.5 flex items-end gap-3">
              <span className="text-[40px] font-semibold leading-none tracking-[-0.04em] tnum" style={{ color: SEVERITY_META[latest.risk_label].text }}>
                <CountUp value={latest.risk_score} duration={0.8} />
              </span>
              {delta != null && (
                <span
                  className={cn('mb-1 inline-flex items-center gap-0.5 text-[12.5px] font-medium tnum', delta > 0 ? 'text-sev-critical' : delta < 0 ? 'text-ok' : 'text-ink-3')}
                  aria-label={delta === 0 ? 'No change since the previous scan' : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} points since the previous scan`}
                >
                  {delta > 0 ? <ArrowUpRight size={14} aria-hidden /> : delta < 0 ? <ArrowDownRight size={14} aria-hidden /> : <Minus size={14} aria-hidden />}
                  {Math.abs(delta)}
                </span>
              )}
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-ink-3">
              {delta == null ? 'Run another scan to see how your exposure changes.' : delta === 0 ? 'Unchanged since the previous scan.' : `${delta > 0 ? 'Higher' : 'Lower'} than the previous scan.`}
            </p>
          </div>

          <div className="relative min-w-0 p-5 md:p-6">
            <div className="flex min-h-[20px] items-center justify-between gap-3 text-[12px] text-ink-3" aria-live="polite">
              {fe && n > 1 ? (
                <>
                  <span className="min-w-0 truncate"><span className="mono text-ink-2">{fe.project}</span> · {fmtScanDay(fe.created_at)}</span>
                  <span className="shrink-0">
                    Risk <span className="tnum font-semibold" style={{ color: SEVERITY_META[fe.risk_label].text }}>{fe.risk_score}</span>
                    {fe.id === currentId && <span className="ml-2 text-accent-soft">Open now</span>}
                  </span>
                </>
              ) : (
                <span>Risk over time</span>
              )}
            </div>

            {n > 1 ? (
              <svg
                viewBox={`0 0 ${W} ${H}`} className="mt-3 block h-auto w-full" role="img"
                aria-label={`Risk trend across ${n} scans, from ${series[0].risk_score} to ${series[n - 1].risk_score}`}
                onMouseMove={onMove} onMouseLeave={() => setHover(null)}
              >
                <defs>
                  <linearGradient id={`t${gid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(167 139 250)" stopOpacity=".26" />
                    <stop offset="100%" stopColor="rgb(167 139 250)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[25, 50, 75].map((g) => {
                  const y = PY + (1 - g / 100) * (H - PY * 2)
                  return <line key={g} x1={PX} x2={W - PX} y1={y} y2={y} stroke="rgba(255,255,255,.05)" strokeDasharray="2 5" />
                })}
                <path d={area} fill={`url(#t${gid})`} />
                <motion.path
                  d={line} fill="none" stroke="rgb(167 139 250)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE }}
                />
                {hover != null && <line x1={pts[hover][0]} x2={pts[hover][0]} y1={PY - 4} y2={H - 4} stroke="rgba(255,255,255,.14)" />}
                {pts.map((p, i) => {
                  const cur = series[i].id === currentId
                  return (
                    <g key={series[i].id + i}>
                      {cur && <circle cx={p[0]} cy={p[1]} r="9" fill="rgb(139 92 246 / .18)" stroke="rgb(167 139 250 / .55)" strokeWidth="1" />}
                      <circle cx={p[0]} cy={p[1]} r={cur ? 4 : i === focus ? 3.6 : 2.6} fill={cur ? 'rgb(196 181 253)' : sevColor(series[i].risk_label)} stroke="#111316" strokeWidth="1.5" />
                    </g>
                  )
                })}
              </svg>
            ) : (
              <div className="mt-3 flex h-[96px] items-center justify-center rounded-r2 border border-dashed border-white/[.08] text-[12.5px] text-ink-3">
                A trend appears after your second scan.
              </div>
            )}
            <p className="sr-only">Latest scan {latest.project}, risk {latest.risk_score} out of 100, {SEVERITY_META[latest.risk_label].label}. Full list in the table below.</p>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
