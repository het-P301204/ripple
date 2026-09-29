import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, FileCode2, PackageOpen, ScanSearch } from 'lucide-react'
import type { Ecosystem, EcosystemSummary, Finding, Package, ScanResult } from '@/types/scan'
import { ECOSYSTEM_META, SEVERITY_META, SEVERITY_ORDER, sevColor } from '@/lib/meta'
import { fmtPercent, plural } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { CountUp } from '@/components/ui/CountUp'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { ProgressRing } from '@/components/ui/Progress'
import { MicroBar } from '@/components/ui/Progress'
import { EmptyState } from '@/components/ui/States'
import { SeverityBadge, SeverityDot } from '@/components/ui/SeverityBadge'
import { StatCard } from '@/components/ui/PageHeader'
import { Tooltip } from '@/components/ui/Tooltip'
import { useScanModal } from '@/components/scan/ScanModalContext'
import { riskBand } from './EcosystemCompare'

const ring = (v: number) => Math.max(0, Math.min(1, v))

function CompactFinding({ f }: { f: Finding }) {
  return (
    <Link
      to={`/findings/${encodeURIComponent(f.id)}`}
      className="group flex items-center gap-3 rounded-r2 px-3 py-3 transition-colors duration-micro hover:bg-white/[.03]"
    >
      <SeverityBadge severity={f.severity} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[13px] font-medium text-ink">{f.package}</span>
        <span className="block truncate text-[12px] text-ink-3">{f.title}</span>
      </span>
      <span className="tnum text-[14px] font-semibold text-ink">{f.risk_score}</span>
      <ArrowUpRight size={14} className="text-ink-4 transition-colors group-hover:text-accent-soft" aria-hidden />
    </Link>
  )
}

function RiskyPackage({ p }: { p: Package }) {
  return (
    <Link
      to={`/packages?ecosystem=${p.ecosystem}&q=${encodeURIComponent(p.name)}`}
      className="group flex items-center gap-3 rounded-r2 px-3 py-3 transition-colors duration-micro hover:bg-white/[.03]"
    >
      <SeverityDot severity={p.severity} className="h-2 w-2" />
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[13px] font-medium text-ink">{p.name}</span>
        <span className="mono block text-[12px] text-ink-3">{p.version}</span>
      </span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[.06]" aria-hidden>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(3, p.risk_score)}%`, background: sevColor(p.severity) }} />
      </span>
      <span className="tnum w-7 text-right text-[14px] font-semibold text-ink">{p.risk_score}</span>
    </Link>
  )
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-r4 border border-hair bg-card p-2 shadow-card">
      <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Everything for one ecosystem tab. `summary` undefined (or total 0) renders the intentional empty state. */
export function EcosystemPanel({ eco, summary, scan }: { eco: Ecosystem; summary?: EcosystemSummary; scan: ScanResult }) {
  const { openScan } = useScanModal()
  const meta = ECOSYSTEM_META[eco]

  if (!summary || summary.total === 0) {
    return (
      <div className="rounded-r4 border border-hair bg-card shadow-card">
        <EmptyState
          glyph={<span className="grid h-16 w-16 place-items-center rounded-full border border-white/[.08] bg-white/[.03]"><PackageOpen size={26} className="text-ink-4" aria-hidden /></span>}
          title={`No ${meta.label} dependencies in this scan`}
          description={<>None of the scanned lockfiles resolved packages from <span className="mono text-ink-2">{meta.registry}</span>. Add {meta.lockfiles.join(', ')} to cover this ecosystem.</>}
          action={<Button variant="secondary" leading={<ScanSearch size={16} />} onClick={() => openScan()}>Start New Scan</Button>}
        />
      </div>
    )
  }

  const s = summary
  const band = riskBand(s.risk_score)
  const findings = scan.findings.filter((f) => f.ecosystem === eco).sort((a, b) => b.risk_score - a.risk_score)
  const risky = scan.packages.filter((p) => p.ecosystem === eco && p.risk_score > 0).sort((a, b) => b.risk_score - a.risk_score).slice(0, 6)
  const q = `?ecosystem=${eco}`
  const pct = (n: number) => `${Math.round((n / Math.max(1, s.total)) * 100)}% of ${meta.label}`

  return (
    <div className="space-y-6">
      {/* headline */}
      <div className="relative overflow-hidden rounded-r5 border border-white/[.08] bg-card p-6 shadow-card md:p-8">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(50% 90% at 92% 30%, ${meta.color}1c, transparent 70%)` }} />
        <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="eyebrow flex items-center gap-2"><EcosystemMark ecosystem={eco} size={14} /> {meta.label}</p>
            <h2 className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] md:text-[38px]">
              <CountUp value={s.total} duration={0.8} /> {s.total === 1 ? 'dependency' : 'dependencies'}
            </h2>
            <p className="mt-2 text-[14px] text-ink-3">{s.direct} direct · {s.total - s.direct} transitive</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {s.lockfiles.map((l) => (
                <Badge key={l} mono icon={<FileCode2 size={12} aria-hidden />}>{l}</Badge>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-1 text-[13px] text-ink-3">
              <span>Registry</span>
              <span className="mono ml-1 text-ink-2">{s.registry}</span>
              <CopyButton value={s.registry} label="Copy registry host" />
            </div>
          </div>

          <div className="flex items-center gap-8">
            <div className="flex flex-col items-center gap-2">
              <ProgressRing value={ring(s.risk_score / 100)} size={104} stroke={7} color={sevColor(band)}>
                <span className="tnum text-[26px] font-semibold tracking-[-0.03em]">{s.risk_score}</span>
              </ProgressRing>
              <Tooltip content={`A 0–100 blend of every ${meta.label} finding, weighted by severity and confidence.`}>
                <span tabIndex={0} className="text-[12px] text-ink-3">Ecosystem risk</span>
              </Tooltip>
              <SeverityBadge severity={band} size="sm" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <ProgressRing value={ring(s.registry_coverage)} size={104} stroke={7}>
                <span className="tnum text-[22px] font-semibold tracking-[-0.03em]">{fmtPercent(s.registry_coverage)}</span>
              </ProgressRing>
              <Tooltip content="Share of packages RIPPLE could look up on the public registry. Lower coverage means more of the risk is unverified.">
                <span tabIndex={0} className="text-[12px] text-ink-3">Registry coverage</span>
              </Tooltip>
              <span className="h-5" aria-hidden />
            </div>
          </div>
        </div>
      </div>

      {/* metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard delay={0.02} label="Total" value={s.total} context={`${s.direct} direct`} to={`/packages${q}`} />
        <StatCard delay={0.05} label="Public" value={s.public} context={pct(s.public)} to={`/packages${q}`} />
        <StatCard delay={0.08} label="Internal-looking" value={s.internal_looking} context="Prime confusion targets" to={`/packages${q}`} />
        <StatCard delay={0.11} label="Confusion candidates" value={s.confusion} context={s.confusion ? 'Could be shadowed publicly' : 'None found'} to={`/findings${q}&category=dependency_confusion`} />
        <StatCard delay={0.14} label="Typosquatting candidates" value={s.typosquat} context={s.typosquat ? 'Lookalike names in use' : 'None found'} to={`/findings${q}&category=typosquatting`} />
        <StatCard delay={0.17} label="Suspicious packages" value={s.suspicious} context={s.suspicious ? 'Scripts, age or maintainers' : 'None found'} to={`/findings${q}&category=suspicious_metadata`} />
        <StatCard delay={0.2} label="Registry exposure" value={s.exposure} context={s.exposure ? 'Weak sources or hashes' : 'None found'} to={`/findings${q}&category=registry_exposure`} />
        <div className="rounded-r3 border border-hair bg-card p-5 shadow-card">
          <p className="text-[12.5px] text-ink-3">Severity mix</p>
          <div className="mt-4">
            <MicroBar height={8} parts={SEVERITY_ORDER.map((sv) => ({ value: s.severity_counts[sv], color: sevColor(sv) }))} />
          </div>
          <ul role="list" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5">
            {SEVERITY_ORDER.filter((sv) => sv !== 'info' || s.severity_counts.info > 0).map((sv) => (
              <li key={sv} className="flex items-center gap-2 text-[12px] text-ink-3">
                <SeverityDot severity={sv} />
                {SEVERITY_META[sv].label}
                <span className="tnum ml-auto font-medium text-ink-2">{s.severity_counts[sv]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* top lists */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Top findings"
          action={findings.length > 0 && (
            <Link to={`/findings${q}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:text-white">
              View all {findings.length} <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        >
          {findings.length ? (
            <ul role="list" className="px-1 pb-1">{findings.slice(0, 5).map((f) => <li key={f.id}><CompactFinding f={f} /></li>)}</ul>
          ) : (
            <p className="px-4 pb-6 pt-4 text-[13.5px] text-ink-3">No exposed package signals detected in {meta.label}.</p>
          )}
        </Card>
        <Card
          title="Top risky packages"
          action={<Link to={`/packages${q}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:text-white">Explore {plural(s.total, 'package')} <ArrowRight size={14} aria-hidden /></Link>}
        >
          {risky.length ? (
            <ul role="list" className="px-1 pb-1">{risky.map((p) => <li key={p.id}><RiskyPackage p={p} /></li>)}</ul>
          ) : (
            <p className="px-4 pb-6 pt-4 text-[13.5px] text-ink-3">No risky packages in {meta.label}.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
