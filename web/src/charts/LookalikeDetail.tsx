import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowUpRight, Waypoints } from 'lucide-react'
import type { LookalikeCandidate, LookalikeGroup } from '@/types/scan'
import { fmtDate, fmtNumber, plural } from '@/lib/format'
import { EASE } from '@/lib/motion'
import { Badge } from '@/components/ui/Badge'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { CopyButton } from '@/components/ui/CopyButton'
import { CharDiff } from './CharDiff'
import { SeverityRing } from './SeverityRing'
import { editDistance } from './diff'
import { mutationInfo } from './lookalike'

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="mt-1 text-[13.5px] text-ink">{children}</dd>
    </div>
  )
}

function pctOf(n: number | null, of: number | null): string | null {
  if (n == null || of == null || of <= 0) return null
  const p = (n / of) * 100
  return p < 0.01 ? 'under 0.01% of the original' : `${p < 1 ? p.toFixed(2) : p.toFixed(1)}% of the original`
}

/** Detail card for one lookalike: similarity, edit distance, mutation, registration facts, and why it scored as it did. */
export function LookalikeDetail({
  group, candidate: c, scanAt, findingId, inGraph,
}: { group: LookalikeGroup; candidate: LookalikeCandidate; scanAt?: string; findingId?: string | null; inGraph?: boolean }) {
  const reduced = !!useReducedMotion()
  const mut = mutationInfo(c.mutation)
  const edits = c.distance ?? editDistance(group.original, c.name)
  const regDays = c.registered_at ? Math.round(((scanAt ? Date.parse(scanAt) : Date.now()) - Date.parse(c.registered_at)) / 86_400_000) : null
  const share = pctOf(c.weekly_downloads, group.original_weekly_downloads)

  return (
    <motion.section
      key={c.name}
      aria-label={`Details for ${c.name}`}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.36, ease: EASE }}
      className="rounded-r4 border border-white/[.08] bg-card p-5 shadow-card md:p-6"
    >
      <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="mono text-[18px] font-semibold tracking-[-0.01em]">{c.name}</h3>
            <CopyButton value={c.name} label="Copy lookalike name" />
            <SeverityBadge severity={c.severity} />
            <Badge tone={c.registered ? 'amber' : 'neutral'}>{c.registered ? 'Registered' : 'Unregistered'}</Badge>
          </div>
          <p className="mt-2 text-[13px] text-ink-3">
            Lookalike of <span className="mono text-ink-2">{group.original}</span> · {inGraph ? 'present in your lockfile' : 'not in your lockfile'}
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-r3 border border-white/[.07] bg-black/20 px-4 py-3">
          <SeverityRing severity={c.severity} value={c.suspicion_score} size={52} stroke={4} label={`Suspicion score ${c.suspicion_score} of 100`} />
          <div>
            <p className="text-[12px] text-ink-3">Suspicion score</p>
            <p className="tnum text-[13.5px] text-ink">{c.suspicion_score} / 100</p>
          </div>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/[.06] pt-5 md:grid-cols-4">
        <Fact label="Similarity">
          <div className="flex items-center gap-2.5">
            <span className="tnum font-medium">{(c.similarity * 100).toFixed(0)}%</span>
            <span className="h-1.5 w-full max-w-[96px] overflow-hidden rounded-full bg-white/[.07]" role="presentation">
              <motion.span
                className="block h-full origin-left rounded-full bg-gradient-to-r from-accent to-magenta-soft"
                style={{ width: `${c.similarity * 100}%` }}
                initial={{ scaleX: reduced ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease: EASE }}
              />
            </span>
          </div>
        </Fact>
        <Fact label="Edit distance"><span className="tnum">{plural(edits, 'edit')}</span> <span className="text-ink-3">from the original</span></Fact>
        <Fact label="Registered">
          {c.registered_at ? (
            <>
              {fmtDate(c.registered_at, false)}
              {regDays != null && regDays >= 0 && <span className="mt-0.5 block text-[12px] text-ink-3">{plural(regDays, 'day')} before this scan</span>}
            </>
          ) : <span className="text-ink-3">Not registered. Open to claim.</span>}
        </Fact>
        <Fact label="Weekly downloads">
          {c.weekly_downloads != null ? (
            <>
              <span className="tnum">{fmtNumber(c.weekly_downloads)}</span>
              {share && <span className="mt-0.5 block text-[12px] text-ink-3">{share}</span>}
            </>
          ) : <span className="text-ink-3">Not available</span>}
        </Fact>
        <Fact label="Mutation type" className="col-span-2">
          <span className="font-medium">{mut.label}</span>
          <span className="mt-0.5 block text-[12px] text-ink-3">{mut.hint}</span>
          <span className="mt-2.5 block"><CharDiff original={group.original} candidate={c.name} mode="stacked" /></span>
        </Fact>
        <Fact label="Maintainers">
          {c.maintainers.length ? (
            <span className="flex flex-wrap gap-1.5">{c.maintainers.map((m) => <Badge key={m} mono>{m}</Badge>)}</span>
          ) : <span className="text-ink-3">None on record</span>}
        </Fact>
        <Fact label="Install scripts">
          {c.install_scripts.length ? (
            <span className="flex flex-wrap gap-1.5">{c.install_scripts.map((s) => <Badge key={s} tone="magenta" mono>{s}</Badge>)}</span>
          ) : <span className="text-ink-3">None detected</span>}
        </Fact>
      </dl>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4 border-t border-white/[.06] pt-5">
        <section aria-label="Suspicion drivers" className="min-w-0 flex-1">
          <h4 className="text-[12px] font-medium text-ink-2">What raised the score</h4>
          {c.drivers.length ? (
            <ul className="mt-2 space-y-1.5">
              {c.drivers.map((d) => (
                <li key={d} className="flex items-start gap-2.5 text-[13px] text-ink-2">
                  <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft" />{d}
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-[13px] text-ink-3">No scoring drivers recorded.</p>}
        </section>
        {(findingId || inGraph) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {findingId && (
              <Link to={`/findings/${encodeURIComponent(findingId)}`} className="inline-flex h-9 items-center gap-1.5 rounded-r2 border border-white/[.1] bg-white/[.04] px-3.5 text-[13px] font-medium text-ink hover:bg-white/[.07]">
                Open finding <ArrowUpRight size={14} aria-hidden />
              </Link>
            )}
            {inGraph && (
              <Link to={`/graph?focus=${encodeURIComponent(c.name)}`} className="inline-flex h-9 items-center gap-1.5 rounded-r2 border border-white/[.1] bg-white/[.04] px-3.5 text-[13px] font-medium text-ink hover:bg-white/[.07]">
                <Waypoints size={14} aria-hidden /> Show in graph
              </Link>
            )}
          </div>
        )}
      </div>
    </motion.section>
  )
}
