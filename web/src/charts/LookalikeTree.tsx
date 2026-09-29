import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import type { LookalikeCandidate, LookalikeGroup } from '@/types/scan'
import { sevColor } from '@/lib/meta'
import { fmtCompact, fmtPercent } from '@/lib/format'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { useMeasure } from './hooks'
import { bySuspicion } from './lookalike'

export const TREE_LIMIT = 10
const CW = 178
const CH = 62
const OW = 172
const OH = 66
const NARROW = 640

interface Placed { c: LookalikeCandidate; x: number; y: number; d: string; i: number; side: 'l' | 'r' }

/**
 * Pure layout (exported for tests). The original sits in the middle; candidates form two columns, one either side, and are
 * dealt out alternately right, left, right, left… so both columns read top-to-bottom in order of suspicion.
 * Each candidate hangs off the original by a thin S-curve with horizontal tangents (a horizontal tree).
 */
export function layoutTree(width: number, cands: LookalikeCandidate[]) {
  const W = Math.max(NARROW, width)
  const items = cands.slice(0, TREE_LIMIT)
  const n = items.length
  const rows = Math.max(1, Math.ceil(n / 2))
  const rowGap = 20
  const PAD = 34
  const H = Math.max(280, PAD * 2 + rows * CH + (rows - 1) * rowGap)
  const cx = W / 2, cy = H / 2
  const gap = Math.max(28, Math.min(130, (W - 2 * CW - OW - 48) / 2))
  const colTop = (H - (rows * CH + (rows - 1) * rowGap)) / 2 + CH / 2
  const placed: Placed[] = items.map((c, i) => {
    const side: 'l' | 'r' = i % 2 === 0 ? 'r' : 'l'
    const row = Math.floor(i / 2)
    const x = side === 'r' ? cx + OW / 2 + gap + CW / 2 : cx - OW / 2 - gap - CW / 2
    const y = colTop + row * (CH + rowGap)
    const sx = side === 'r' ? cx + OW / 2 : cx - OW / 2
    const ex = side === 'r' ? x - CW / 2 : x + CW / 2
    const mx = (sx + ex) / 2
    const d = `M${sx.toFixed(1)},${cy.toFixed(1)}C${mx.toFixed(1)},${cy.toFixed(1)} ${mx.toFixed(1)},${y.toFixed(1)} ${ex.toFixed(1)},${y.toFixed(1)}`
    return { c, x, y, d, i, side }
  })
  return { W, H, cx, cy, placed }
}

function OriginalNode({ group, className, style }: { group: LookalikeGroup; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn('rounded-r3 border border-accent-soft/40 bg-elevated px-4 py-2.5 shadow-[0_0_32px_-10px_rgb(var(--c-accent)/.55)]', className)} style={style}>
      <div className="flex items-center gap-2">
        <EcosystemMark ecosystem={group.ecosystem} size={15} />
        <span className="mono truncate text-[15px] font-semibold tracking-[-0.01em]">{group.original}</span>
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
        Original{group.original_weekly_downloads != null ? ` · ${fmtCompact(group.original_weekly_downloads)} weekly` : ''}
      </p>
    </div>
  )
}

function CandidateBody({ c }: { c: LookalikeCandidate }) {
  return (
    <>
      <span className={cn('mono block truncate text-[12.5px] font-medium', c.registered ? 'text-ink' : 'text-ink-2')}>{c.name}</span>
      <span className="mt-1.5 flex items-center gap-2">
        <SeverityBadge severity={c.severity} size="sm" />
        <span className="tnum text-[11.5px] text-ink-3">{fmtPercent(c.similarity)}</span>
        {!c.registered && <span className="text-[10.5px] text-ink-3">unregistered</span>}
      </span>
    </>
  )
}

const cardBase = 'rounded-r3 border px-3 py-2 text-left transition-[border-color,background,box-shadow] duration-micro ease-ripple'
const cardState = (sel: boolean, registered: boolean) =>
  cn(cardBase, sel ? 'border-accent-soft/60 bg-elevated shadow-[0_0_0_1px_rgb(var(--c-accent-soft)/.25),0_10px_30px_-14px_rgb(var(--c-accent)/.5)]' : 'border-white/[.09] bg-card hover:border-white/[.18] hover:bg-elevated', !registered && !sel && 'border-dashed')

/**
 * The lookalike relationship view. Wide: the original in the middle with its lookalikes in two columns either side,
 * most suspicious at the top, joined by thin curves. Narrow (<640px): a vertical spine list.
 * Entrance: the original appears, rings ripple out, candidates fan in one by one.
 */
export function LookalikeTree({
  group, selected, onSelect,
}: { group: LookalikeGroup; selected: string | null; onSelect: (name: string) => void }) {
  const reduced = !!useReducedMotion()
  const [ref, { width }] = useMeasure<HTMLDivElement>({ width: 900, height: 0 })
  const sorted = useMemo(() => bySuspicion(group.candidates), [group.candidates])
  const narrow = width > 0 && width < NARROW
  const layout = useMemo(() => layoutTree(width || 900, sorted), [width, sorted])
  const hidden = sorted.length - TREE_LIMIT

  if (narrow) {
    return (
      <div ref={ref} className="p-4">
        <motion.div initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <OriginalNode group={group} />
        </motion.div>
        <ul className="relative ml-5 mt-3 space-y-2 border-l border-white/[.12] pl-5" aria-label={`Lookalikes of ${group.original}, most suspicious first`}>
          {sorted.map((c, i) => (
            <motion.li
              key={c.name} className="relative"
              initial={{ opacity: 0, x: reduced ? 0 : -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.15 + i * 0.05, ease: EASE }}
            >
              <span aria-hidden className="absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2" style={{ background: c.severity === 'info' ? 'rgba(255,255,255,.14)' : sevColor(c.severity, 0.55) }} />
              <button type="button" aria-pressed={selected === c.name} onClick={() => onSelect(c.name)} className={cn(cardState(selected === c.name, c.registered), 'block w-full')}>
                <CandidateBody c={c} />
              </button>
            </motion.li>
          ))}
        </ul>
      </div>
    )
  }

  const { W, H, cx, cy, placed } = layout
  const R = Math.min(H / 2 - 6, 190)
  return (
    <div ref={ref} className="relative w-full overflow-hidden" style={{ height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute left-0 top-0" aria-hidden>
        {reduced
          ? [0.34, 0.62, 0.9].map((f) => <circle key={f} cx={cx} cy={cy} r={R * f} fill="none" stroke="rgb(var(--c-accent))" strokeOpacity=".09" />)
          : [0, 1, 2].map((k) => (
              <circle
                key={k} cx={cx} cy={cy} r={R * 1.5} fill="none" stroke="rgb(var(--c-accent))"
                style={{ transformBox: 'fill-box', transformOrigin: 'center', opacity: 0, animation: `net-pulse 2.4s cubic-bezier(0.22,1,0.36,1) ${0.15 + k * 0.32}s 1 both` }}
              />
            ))}
        {placed.map(({ c, d, i }) => {
          const on = selected === c.name
          const col = c.severity === 'info' ? 'rgba(255,255,255,.22)' : sevColor(c.severity, on ? 0.9 : 0.5)
          return (
            <motion.path
              key={c.name} d={d} fill="none" stroke={on ? 'rgb(var(--c-accent-soft))' : col} strokeWidth={on ? 1.6 : 1.1} strokeDasharray={c.registered ? undefined : '3 4'}
              initial={{ pathLength: reduced ? 1 : 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.7, delay: reduced ? 0 : 0.45 + i * 0.07, ease: EASE }}
            />
          )
        })}
      </svg>

      <motion.div
        initial={{ opacity: 0, scale: reduced ? 1 : 0.86 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.55, ease: EASE }}
        className="absolute z-10" style={{ left: cx - OW / 2, top: cy - OH / 2, width: OW, height: OH }}
      >
        <OriginalNode group={group} className="h-full" />
      </motion.div>

      {placed.map(({ c, x, y, i }) => (
        <motion.button
          key={c.name} type="button" aria-pressed={selected === c.name} onClick={() => onSelect(c.name)}
          aria-label={`${c.name}, ${c.severity} severity, ${fmtPercent(c.similarity)} similar to ${group.original}${c.registered ? '' : ', unregistered'}`}
          className={cn(cardState(selected === c.name, c.registered), 'absolute z-10')}
          style={{ left: x - CW / 2, top: y - CH / 2, width: CW, height: CH }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: (cx - x) * 0.7, y: (cy - y) * 0.7, scale: 0.7 }}
          animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
          transition={{ duration: 0.62, delay: reduced ? 0 : 0.5 + i * 0.07, ease: EASE }}
        >
          <CandidateBody c={c} />
        </motion.button>
      ))}
      {hidden > 0 && <p className="absolute bottom-3 left-4 text-[11.5px] text-ink-3">+{hidden} lower-suspicion names in the table below</p>}
      <p className="absolute bottom-3 right-4 hidden text-[11.5px] text-ink-3 md:block">Most suspicious at the top</p>
    </div>
  )
}
