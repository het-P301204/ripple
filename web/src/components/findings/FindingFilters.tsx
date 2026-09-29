import { useId } from 'react'
import { motion } from 'framer-motion'
import type { Ecosystem, Severity } from '@/types/scan'
import { ECOSYSTEM_META, SEVERITY_META, SEVERITY_ORDER } from '@/lib/meta'
import { springSoft } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { CountUp } from '@/components/ui/CountUp'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { SeverityDot } from '@/components/ui/SeverityBadge'

/**
 * Severity summary that doubles as a filter. Selecting a tile filters the list; selecting it again clears.
 * The active tile is marked by a shared-layout highlight that glides between tiles.
 */
export function SeverityTiles({
  counts, value, onChange, showInfo,
}: {
  counts: Record<Severity, number>
  value: Severity | null
  onChange: (v: Severity | null) => void
  showInfo: boolean
}) {
  const gid = useId()
  const sevs = SEVERITY_ORDER.filter((s) => s !== 'info' || showInfo || value === 'info')
  const total = SEVERITY_ORDER.reduce((a, s) => a + counts[s], 0)
  const tiles: Array<{ key: Severity | null; label: string; n: number }> = [
    { key: null, label: 'All', n: total },
    ...sevs.map((s) => ({ key: s as Severity | null, label: SEVERITY_META[s].label, n: counts[s] })),
  ]
  return (
    <div
      role="group" aria-label="Filter by severity"
      className="grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(var(--n),minmax(0,1fr))]"
      style={{ ['--n' as string]: tiles.length }}
    >
      {tiles.map((t) => {
        const active = value === t.key
        const m = t.key ? SEVERITY_META[t.key] : null
        const empty = t.n === 0 && !active
        return (
          <motion.button
            key={t.label} type="button" aria-pressed={active} disabled={empty}
            aria-label={`${t.label}: ${t.n} findings`}
            onClick={() => onChange(t.key && active ? null : t.key)}
            whileTap={empty ? undefined : { scale: 0.985 }}
            className={cn(
              'relative overflow-hidden rounded-r3 border bg-card p-4 text-left transition-[border-color,background,opacity] duration-comp ease-ripple',
              active ? 'border-transparent' : 'border-white/[.07] hover:border-white/[.14] hover:bg-elevated', empty && 'cursor-default opacity-50',
            )}
          >
            {active && (
              <motion.span
                layoutId={`sev-active-${gid}`} transition={springSoft} aria-hidden
                className="absolute inset-0 rounded-r3 border"
                style={{ borderColor: m ? m.border : 'rgb(var(--c-accent) / .45)', background: m ? m.bg : 'rgb(var(--c-accent) / .08)' }}
              />
            )}
            <span className="relative flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: m ? m.text : 'rgb(var(--c-ink-3))' }}>
              {t.key && <SeverityDot severity={t.key} />}
              {t.label}
            </span>
            <span className="relative mt-2 block text-[26px] font-semibold leading-none tracking-[-0.03em]">
              <CountUp value={t.n} duration={0.5} />
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}

/** Ecosystem filter pills (All + each ecosystem in the scan) with a gliding active background. */
export function EcosystemFilter({
  value, onChange, ecosystems, counts, className,
}: {
  value: Ecosystem | null
  onChange: (e: Ecosystem | null) => void
  ecosystems: Ecosystem[]
  counts?: Partial<Record<Ecosystem, number>>
  className?: string
}) {
  const gid = useId()
  const opts: Array<Ecosystem | null> = [null, ...ecosystems]
  return (
    <div role="group" aria-label="Filter by ecosystem" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {opts.map((e) => {
        const active = value === e
        const label = e ? ECOSYSTEM_META[e].label : 'All'
        return (
          <button
            key={label} type="button" aria-pressed={active} onClick={() => onChange(active ? null : e)}
            className={cn(
              'relative inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors duration-micro',
              active ? 'border-transparent text-ink' : 'border-white/[.08] text-ink-3 hover:border-white/[.15] hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`eco-active-${gid}`} transition={springSoft} aria-hidden
                className="absolute inset-0 rounded-full border border-accent/35 bg-accent/[.12]"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {e && <EcosystemMark ecosystem={e} size={13} />}
              {label}
              {e && counts?.[e] != null && <span className="tnum text-[11px] text-ink-3">{counts[e]}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
