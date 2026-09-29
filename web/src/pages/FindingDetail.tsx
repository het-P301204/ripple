import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Crosshair, FileSearch, GitBranch, ListChecks, Scale, ShieldAlert, Wrench } from 'lucide-react'
import { useScan, useScanIndex } from '@/hooks/useScan'
import { fmtRelative } from '@/lib/format'
import { EASE, staggerParent, useMotion } from '@/lib/motion'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { Badge } from '@/components/ui/Badge'
import { Button, LinkButton } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EcosystemPill } from '@/components/ui/EcosystemPill'
import { Kbd } from '@/components/ui/Kbd'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, StateGlyph } from '@/components/ui/States'
import { SeverityBadge, SeverityDot } from '@/components/ui/SeverityBadge'
import { Tooltip } from '@/components/ui/Tooltip'
import { EvidenceTable } from '@/components/findings/EvidenceTable'
import { Panel } from '@/components/findings/Panel'
import { RelatedPackages } from '@/components/findings/RelatedPackages'
import { RichText } from '@/components/findings/RichText'
import { RiskDrivers } from '@/components/findings/RiskDrivers'
import { RiskSummary } from '@/components/findings/RiskSummary'
import { CATEGORY_TITLE } from '@/components/findings/labels'

const toFinding = (id: string) => `/findings/${encodeURIComponent(id)}`

export default function FindingDetail() {
  const { id } = useParams<{ id: string }>()
  const { scan, loading } = useScan()
  const { findingById, sortedFindings } = useScanIndex()
  const navigate = useNavigate()
  const f = id ? findingById.get(id) : undefined

  const idx = useMemo(() => (f ? sortedFindings.findIndex((x) => x.id === f.id) : -1), [f, sortedFindings])
  const prev = idx > 0 ? sortedFindings[idx - 1] : undefined
  const next = idx >= 0 && idx < sortedFindings.length - 1 ? sortedFindings[idx + 1] : undefined

  // j / k move through findings in risk order
  useEffect(() => {
    if (!f) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'j' && next) navigate(toFinding(next.id))
      else if (e.key === 'k' && prev) navigate(toFinding(prev.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [f, next, prev, navigate])

  if (loading && !scan) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading finding">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <div className="grid gap-6 pt-4 lg:grid-cols-[340px_1fr]">
          <Skeleton className="h-[420px] rounded-r4" />
          <Skeleton className="h-[420px] rounded-r4" />
        </div>
      </div>
    )
  }
  if (!scan) {
    return (
      <>
        <PageHeader title="Finding" subtitle="Evidence, risk drivers and remediation for a single signal." />
        <NoScanEmptyState title="No scan loaded" description="Load a scan to inspect the evidence behind a finding." />
      </>
    )
  }
  if (!f) {
    return (
      <>
        <BackLink />
        <h1 className="sr-only">Finding not found</h1>
        <div className="mt-6 rounded-r4 border border-hair bg-card shadow-card">
          <EmptyState
            glyph={<StateGlyph tone="amber" broken />}
            title="Finding not found"
            description={<>There is no finding <span className="mono text-ink-2">{id}</span> in the loaded scan. It may belong to a different scan.</>}
            action={<LinkButton to="/findings" variant="primary" leading={<ArrowLeft size={16} />}>Back to findings</LinkButton>}
            secondary={<LinkButton to="/history" variant="secondary">Scan history</LinkButton>}
          />
        </div>
      </>
    )
  }

  return <Detail key={f.id} idx={idx} total={sortedFindings.length} prev={prev?.id} next={next?.id} />
}

function BackLink() {
  return (
    <Link to="/findings" className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-ink-3 transition-colors hover:text-ink">
      <ArrowLeft size={15} aria-hidden /> Findings
    </Link>
  )
}

function Detail({ idx, total, prev, next }: { idx: number; total: number; prev?: string; next?: string }) {
  const { id } = useParams<{ id: string }>()
  const { findingById, packageById } = useScanIndex()
  const navigate = useNavigate()
  const reduced = !!useReducedMotion()
  const { item } = useMotion()
  const f = findingById.get(id ?? '')!
  const pkg = packageById.get(f.package_id)
  const prevF = prev ? findingById.get(prev) : undefined
  const nextF = next ? findingById.get(next) : undefined

  return (
    <motion.div variants={staggerParent(0.06, 0.02)} initial="hidden" animate="show">
      {/* nav row */}
      <motion.div variants={item} className="mb-6 flex items-center justify-between gap-3">
        <BackLink />
        <div className="flex items-center gap-2">
          <span className="tnum mr-1 text-[12.5px] text-ink-3" aria-label={`Finding ${idx + 1} of ${total}`}>{idx + 1} <span className="text-ink-4">of</span> {total}</span>
          <Tooltip content={<span className="inline-flex items-center gap-2">Previous finding <Kbd>k</Kbd></span>}>
            <Button icon size="sm" variant="secondary" aria-label="Previous finding" disabled={!prev} onClick={() => prev && navigate(toFinding(prev))}><ChevronLeft size={16} /></Button>
          </Tooltip>
          <Tooltip content={<span className="inline-flex items-center gap-2">Next finding <Kbd>j</Kbd></span>}>
            <Button icon size="sm" variant="secondary" aria-label="Next finding" disabled={!next} onClick={() => next && navigate(toFinding(next))}><ChevronRight size={16} /></Button>
          </Tooltip>
        </div>
      </motion.div>

      {/* header */}
      <motion.header variants={item} className="pb-8">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={f.severity} />
          <EcosystemPill ecosystem={f.ecosystem} />
          <Badge mono>v{f.version}</Badge>
          <span className="text-[12.5px] text-ink-3">Detected {fmtRelative(f.detected_at)}</span>
        </div>
        <h1 className="mt-4 text-[28px] font-semibold leading-[1.12] tracking-[-0.035em] md:text-[34px]">{CATEGORY_TITLE[f.category]}</h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="mono break-all text-[17px] font-medium text-ink">{f.package}</span>
          <CopyButton value={f.package} label="Copy package name" />
        </div>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{f.title}</p>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{f.summary}</p>
      </motion.header>

      {/* risk + reasoning */}
      <motion.div variants={item} className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <RiskSummary finding={f} />
        <div className="space-y-6">
          <Panel title="Why this was flagged" description="The detection logic that fired" icon={<FileSearch size={16} />}>
            <p className="max-w-3xl text-[14.5px] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]"><RichText text={f.why_flagged} /></p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-3">
              <span className="inline-flex items-center gap-1.5"><Crosshair size={13} aria-hidden /> Rule <span className="mono text-ink-2">{f.rule_id}</span></span>
              <span className="inline-flex items-center gap-1.5"><Scale size={13} aria-hidden /> {Math.round(f.confidence * 100)}% confidence</span>
            </div>
          </Panel>
          <Panel title="Attack vector" description="How this weakness could be exploited, so you can close it" icon={<ShieldAlert size={16} />}>
            <p className="max-w-3xl text-[14.5px] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]"><RichText text={f.attack_vector} /></p>
          </Panel>
        </div>
      </motion.div>

      <motion.div variants={item} className="mt-6">
        <Panel title="Evidence" description="What RIPPLE observed about this package" icon={<ListChecks size={16} />}>
          <EvidenceTable finding={f} />
        </Panel>
      </motion.div>

      <motion.div variants={item} className="mt-6">
        <Panel title="Risk drivers" description="Every point in the score, and where it came from" icon={<Scale size={16} />}>
          <RiskDrivers drivers={f.drivers} score={f.risk_score} />
        </Panel>
      </motion.div>

      <motion.div variants={item} className="mt-6">
        <Panel title="Remediation" description={`${f.remediation.length} ${f.remediation.length === 1 ? 'step' : 'steps'}, in the order we recommend`} icon={<Wrench size={16} />}>
          {f.remediation.length ? (
            <ol className="grid gap-3">
              {f.remediation.map((r, i) => (
                <motion.li
                  key={r.title + i}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.42, ease: EASE, delay: Math.min(i, 5) * 0.06 }}
                  className="flex gap-4 rounded-r3 border border-white/[.06] bg-white/[.02] p-4 md:p-5"
                >
                  <span aria-hidden className="tnum grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent/25 bg-accent/10 text-[13px] font-semibold text-accent-soft">{i + 1}</span>
                  <div className="min-w-0">
                    <h3 className="text-[14.5px] font-semibold tracking-[-0.01em] text-ink">{r.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3"><RichText text={r.detail} /></p>
                  </div>
                </motion.li>
              ))}
            </ol>
          ) : (
            <p className="text-[13.5px] text-ink-3">No remediation steps were recorded for this finding.</p>
          )}
        </Panel>
      </motion.div>

      <motion.div variants={item} className="mt-6">
        <Panel
          title="Related packages" defaultOpen={f.category === 'typosquatting' || !!pkg?.dependencies.length || !!pkg?.dependents_count}
          description={pkg ? `${pkg.dependencies.length} dependencies · ${pkg.dependents_count} dependents` : 'Position in the dependency tree'} icon={<GitBranch size={16} />}
        >
          <RelatedPackages finding={f} />
        </Panel>
      </motion.div>

      {/* prev / next */}
      <motion.nav variants={item} aria-label="Adjacent findings" className="mt-10 grid gap-3 sm:grid-cols-2">
        {prevF ? (
          <Link to={toFinding(prevF.id)} className="group flex items-center gap-4 rounded-r3 border border-hair bg-card p-4 shadow-card transition-[border-color,background,transform] duration-comp ease-ripple hover:-translate-y-0.5 hover:border-white/[.14] hover:bg-elevated">
            <ArrowLeft size={16} className="shrink-0 text-ink-4 transition-colors group-hover:text-accent-soft" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-[.1em] text-ink-4">Higher risk</span>
              <span className="mt-1 flex items-center gap-2"><SeverityDot severity={prevF.severity} /><span className="mono truncate text-[13.5px] text-ink">{prevF.package}</span></span>
            </span>
          </Link>
        ) : <span className="hidden sm:block" />}
        {nextF ? (
          <Link to={toFinding(nextF.id)} className="group flex items-center justify-end gap-4 rounded-r3 border border-hair bg-card p-4 text-right shadow-card transition-[border-color,background,transform] duration-comp ease-ripple hover:-translate-y-0.5 hover:border-white/[.14] hover:bg-elevated">
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-[.1em] text-ink-4">Next by risk</span>
              <span className="mt-1 flex items-center justify-end gap-2"><span className="mono truncate text-[13.5px] text-ink">{nextF.package}</span><SeverityDot severity={nextF.severity} /></span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-ink-4 transition-colors group-hover:text-accent-soft" aria-hidden />
          </Link>
        ) : <span className="hidden sm:block" />}
      </motion.nav>
      <p className="mt-5 hidden items-center justify-center gap-2 text-[12px] text-ink-4 md:flex">
        <Kbd>k</Kbd> previous <Kbd>j</Kbd> next
      </p>
    </motion.div>
  )
}
