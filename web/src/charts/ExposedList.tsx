import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { Category, Finding } from '@/types/scan'
import { CATEGORY_META, ECOSYSTEM_META } from '@/lib/meta'
import { cn } from '@/lib/cn'
import { SeverityDot } from '@/components/ui/SeverityBadge'

/** Side list of the most exposed packages. The row selects it on the attack path; the arrow opens the finding. */
export function ExposedList({
  findings, total, selectedId, category, onSelect, limit = 8,
}: { findings: Finding[]; total: number; selectedId: string | null; category: Category | null; onSelect: (f: Finding) => void; limit?: number }) {
  const shown = findings.slice(0, limit)
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-3 pt-5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Top exposed packages</h2>
        <p className="mt-1 text-[13px] text-ink-3">{category ? `Within ${CATEGORY_META[category].label.toLowerCase()}, by risk.` : 'Highest risk first. Select one to trace its path.'}</p>
      </div>
      {shown.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13.5px] text-ink-3">No exposed package signals detected.</p>
      ) : (
        <ul className="flex-1 space-y-0.5 px-2 pb-2" aria-label="Most exposed packages">
          {shown.map((f) => {
            const on = f.id === selectedId
            return (
              <li key={f.id}>
                <div className={cn('flex items-center rounded-r2 transition-colors duration-micro', on ? 'bg-accent/[.10]' : 'hover:bg-white/[.04]')}>
                  <button
                    type="button" aria-pressed={on} onClick={() => onSelect(f)}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-r2 px-3 py-2.5 text-left"
                  >
                    <SeverityDot severity={f.severity} />
                    <span className="min-w-0 flex-1">
                      <span className="mono block truncate text-[13px] font-medium">{f.package}</span>
                      <span className="block truncate text-[11.5px] text-ink-3">{CATEGORY_META[f.category].short} · {ECOSYSTEM_META[f.ecosystem].label}</span>
                    </span>
                    <span className="tnum text-[13px] font-semibold text-ink-2">{f.risk_score}</span>
                  </button>
                  <Link
                    to={`/findings/${encodeURIComponent(f.id)}`} aria-label={`Open finding: ${f.package}`}
                    className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-r2 text-ink-4 transition-colors duration-micro hover:bg-white/[.07] hover:text-accent-soft"
                  >
                    <ArrowUpRight size={15} aria-hidden />
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="border-t border-white/[.06] px-5 py-3.5">
        <Link to={category ? CATEGORY_META[category].route : '/findings'} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:text-white">
          View all {total} <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </div>
  )
}
