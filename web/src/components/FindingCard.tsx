import { Link } from 'react-router-dom'
import { ArrowUpRight, Crosshair } from 'lucide-react'
import type { Finding } from '@/types/scan'
import { CATEGORY_META, sevColor } from '@/lib/meta'
import { fmtPercent } from '@/lib/format'
import { cn } from '@/lib/cn'
import { SeverityBadge } from './ui/SeverityBadge'
import { EcosystemPill } from './ui/EcosystemPill'

/**
 * The brief's finding card. Whole card is a link to /findings/:id (keyboard + click).
 * Severity, package (mono), version, ecosystem, attack vector, risk, confidence, short explanation, key evidence.
 */
export function FindingCard({ finding: f, className, rank }: { finding: Finding; className?: string; rank?: number }) {
  const ev = f.evidence[0]
  return (
    <Link
      to={`/findings/${encodeURIComponent(f.id)}`}
      aria-label={`${f.severity} finding: ${f.package} ${f.version}. ${f.title}`}
      className={cn(
        'group relative block overflow-hidden rounded-r3 border border-hair bg-card p-5 shadow-card',
        'transition-[transform,border-color,background] duration-comp ease-ripple hover:-translate-y-0.5 hover:border-white/[.14] hover:bg-elevated',
        className,
      )}
    >
      {/* severity-tinted corner light, only visible on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-0 transition-opacity duration-comp group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, ${sevColor(f.severity, 0.16)}, transparent 68%)` }}
      />
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
        {rank != null && <span className="tnum w-4 text-[12px] font-medium text-ink-4">{rank}</span>}
        <SeverityBadge severity={f.severity} />
        <span className="mono min-w-0 max-w-full text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{f.package}</span>
        <span className="mono min-w-0 max-w-full text-[12.5px] text-ink-3 [overflow-wrap:anywhere]">{f.version}</span>
        <EcosystemPill ecosystem={f.ecosystem} />
        <div className="ml-auto hidden items-center gap-5 sm:flex">
          <Metric label="Risk" value={String(f.risk_score)} />
          <Metric label="Confidence" value={fmtPercent(f.confidence)} />
          <ArrowUpRight size={16} className="text-ink-4 transition-colors group-hover:text-accent-soft" aria-hidden />
        </div>
      </div>
      <h3 className="relative mt-3 text-[15px] font-semibold tracking-[-0.01em] text-ink [overflow-wrap:anywhere]">{f.title}</h3>
      <p className="relative mt-1.5 line-clamp-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{f.summary}</p>
      <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
        <span className="inline-flex items-center gap-1.5 text-ink-3">
          <Crosshair size={13} aria-hidden /> {CATEGORY_META[f.category].label}
        </span>
        {ev && (
          <span className="mono inline-flex min-w-0 max-w-full items-center gap-2 rounded-r1 border border-white/[.06] bg-black/25 px-2.5 py-1 text-[12px]">
            <span className="shrink-0 text-ink-4">{ev.label}</span>
            <span className="truncate text-ink-2">{ev.value}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-4 sm:hidden">
          <Metric label="Risk" value={String(f.risk_score)} />
          <Metric label="Conf." value={fmtPercent(f.confidence)} />
        </span>
      </div>
    </Link>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col items-end leading-none">
      <span className="tnum text-[15px] font-semibold text-ink">{value}</span>
      <span className="mt-1 text-[10px] uppercase tracking-[.1em] text-ink-4">{label}</span>
    </span>
  )
}
