import type { Ecosystem, EcosystemSummary, Severity } from '@/types/scan'
import { ECOSYSTEMS, ECOSYSTEM_META, SEVERITY_ORDER, sevColor } from '@/lib/meta'
import { cn } from '@/lib/cn'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { MicroBar } from '@/components/ui/Progress'

/** Score -> severity band used for ecosystem-level risk (matches the overview: 70+ is high). */
export function riskBand(score: number): Severity {
  return score >= 85 ? 'critical' : score >= 70 ? 'high' : score >= 40 ? 'medium' : score >= 15 ? 'low' : 'info'
}

/** Small side-by-side comparison of all four ecosystems. Each cell selects that ecosystem. */
export function EcosystemCompare({
  summaries, active, onSelect,
}: { summaries: Partial<Record<Ecosystem, EcosystemSummary>>; active: Ecosystem; onSelect: (e: Ecosystem) => void }) {
  return (
    <div role="group" aria-label="Compare ecosystems" className="grid grid-cols-2 overflow-hidden rounded-r3 border border-hair bg-card shadow-card lg:grid-cols-4">
      {ECOSYSTEMS.map((e, i) => {
        const s = summaries[e]
        const isActive = e === active
        const band = s ? riskBand(s.risk_score) : 'info'
        return (
          <button
            key={e} type="button" onClick={() => onSelect(e)} aria-pressed={isActive}
            aria-label={`${ECOSYSTEM_META[e].label}: ${s ? `${s.total} dependencies, risk ${s.risk_score}` : 'no dependencies'}`}
            className={cn(
              'relative flex flex-col gap-3 px-5 py-4 text-left transition-colors duration-comp ease-ripple hover:bg-white/[.025]',
              i % 2 === 1 && 'border-l border-white/[.05]', i >= 1 && 'lg:border-l lg:border-white/[.05]', i >= 2 && 'max-lg:border-t max-lg:border-white/[.05]',
              isActive && 'bg-white/[.03]',
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <EcosystemMark ecosystem={e} size={15} /> {ECOSYSTEM_META[e].label}
              </span>
              <span className="tnum text-[12px] text-ink-3">{s ? s.total : 0} deps</span>
            </span>
            <span className="flex items-end justify-between gap-3">
              <span className="tnum text-[26px] font-semibold leading-none tracking-[-0.03em]" style={{ color: s && s.total ? sevColor(band) : 'rgb(var(--c-ink-4))' }}>
                {s && s.total ? s.risk_score : '—'}
              </span>
              <span className="mb-1 w-20" aria-hidden>
                {s && s.total > 0 ? (
                  <MicroBar height={4} parts={SEVERITY_ORDER.map((sv) => ({ value: s.severity_counts[sv], color: sevColor(sv) }))} />
                ) : (
                  <span className="block h-1 rounded-full bg-white/[.05]" />
                )}
              </span>
            </span>
            {isActive && <span aria-hidden className="absolute inset-x-5 bottom-0 h-[2px] rounded-full bg-accent-soft" />}
          </button>
        )
      })}
    </div>
  )
}
