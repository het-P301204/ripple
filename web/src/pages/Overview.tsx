import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Boxes, Calendar, Clock, Eye, Globe2, Info, Layers, Lock, PackageSearch, Type,
} from 'lucide-react'
import type { Severity } from '@/types/scan'
import { useScan, useScanIndex } from '@/hooks/useScan'
import { CATEGORY_META, ECOSYSTEMS, ECOSYSTEM_META, SEVERITY_META, SEVERITY_ORDER, sevColor } from '@/lib/meta'
import { fmtDate, fmtDuration, plural } from '@/lib/format'
import { EASE, staggerParent, useMotion } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { Landing } from '@/components/landing/Landing'
import { FindingCard } from '@/components/FindingCard'
import { RippleRings } from '@/components/brand/RippleRings'
import { Badge } from '@/components/ui/Badge'
import { SeverityBadge, SeverityDot } from '@/components/ui/SeverityBadge'
import { EcosystemMark } from '@/components/ui/EcosystemPill'
import { CountUp } from '@/components/ui/CountUp'
import { MicroBar, ProgressRing, RadialScore } from '@/components/ui/Progress'
import { PageHeader, Section, StatCard } from '@/components/ui/PageHeader'
import { Tooltip } from '@/components/ui/Tooltip'
import { Button } from '@/components/ui/Button'
import { SkeletonCards } from '@/components/ui/Skeleton'

export default function Overview() {
  const { scan, loading } = useScan()
  if (!scan) return loading ? <SkeletonCards count={4} height={220} /> : <Landing />
  return <ScanOverview />
}

function ScanOverview() {
  const { scan } = useScan()
  const { sortedFindings } = useScanIndex()
  const { item } = useMotion()
  if (!scan) return null
  const s = scan.summary
  const top = sortedFindings.slice(0, 5)

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={scan.project}
        meta={
          <>
            <Badge tone={scan.mode === 'demo' ? 'amber' : 'neutral'}>{scan.mode === 'demo' ? 'Demo dataset' : scan.mode === 'live' ? 'Live registries' : 'Offline analysis'}</Badge>
            <span className="inline-flex items-center gap-1.5"><Calendar size={13} aria-hidden /> {fmtDate(scan.created_at)}</span>
            <span className="inline-flex items-center gap-1.5"><Clock size={13} aria-hidden /> {fmtDuration(scan.duration_ms)}</span>
            <span className="inline-flex items-center gap-1.5"><Layers size={13} aria-hidden /> {plural(scan.source.files.length, 'lockfile')}</span>
          </>
        }
      />

      {scan.warnings.length > 0 && <WarningsBanner warnings={scan.warnings} />}

      <Hero />

      {/* key metrics */}
      <Section className="mt-8" title="Key metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="sm:col-span-2 xl:col-span-2">
            <StatCard
              delay={0.05} to="/packages" icon={<Boxes size={15} />} label="Dependencies" value={s.total_dependencies}
              description="Packages resolved across all lockfiles."
              context={`${s.direct_dependencies} direct · ${s.total_dependencies - s.direct_dependencies} transitive`}
              indicator={
                <div className="w-28 sm:w-40">
                  <MicroBar height={6} parts={scan.ecosystems.map((e) => ({ value: e.total, color: ECOSYSTEM_META[e.ecosystem].color }))} />
                  <div className="mt-2 flex gap-2.5">{scan.ecosystems.map((e) => (
                    <span key={e.ecosystem} className="flex items-center gap-1 text-[10.5px] text-ink-3"><EcosystemMark ecosystem={e.ecosystem} size={11} />{e.total}</span>
                  ))}</div>
                </div>
              }
            />
          </div>
          <StatCard
            delay={0.1} to="/packages" icon={<Globe2 size={15} />} label="Public packages" value={s.public_packages}
            description="Registered on a public registry."
            context={`${Math.round((s.public_packages / Math.max(1, s.total_dependencies)) * 100)}% of dependencies`}
            indicator={<ProgressRing value={s.public_packages / Math.max(1, s.total_dependencies)} size={34} stroke={3.5} />}
          />
          <StatCard
            delay={0.15} to="/packages" icon={<Lock size={15} />} label="Internal-looking" value={s.internal_looking}
            description="Names that suggest private packages."
            context="Prime dependency-confusion targets"
            indicator={<ProgressRing value={s.internal_looking / Math.max(1, s.total_dependencies)} size={34} stroke={3.5} color="rgb(var(--c-magenta-soft))" />}
          />
          <StatCard
            delay={0.2} to={CATEGORY_META.dependency_confusion.route} icon={<PackageSearch size={15} />} label="Confusion candidates" value={s.confusion_candidates}
            description="Could be shadowed on a public registry."
            context={catContext(scan.findings, 'dependency_confusion')}
            indicator={<CatBar cat="dependency_confusion" />}
          />
          <StatCard
            delay={0.25} to={CATEGORY_META.typosquatting.route} icon={<Type size={15} />} label="Typosquatting candidates" value={s.typosquat_candidates}
            description="Lookalikes of popular packages."
            context={`${plural(scan.lookalikes.length, 'lookalike group')} tracked`}
            indicator={<CatBar cat="typosquatting" />}
          />
          <StatCard
            delay={0.3} to={CATEGORY_META.suspicious_metadata.route} icon={<Eye size={15} />} label="Suspicious metadata" value={s.suspicious_metadata}
            description="Install scripts, new packages, maintainer churn."
            context={catContext(scan.findings, 'suspicious_metadata')}
            indicator={<CatBar cat="suspicious_metadata" />}
          />
          <StatCard
            delay={0.35} to="/ecosystems" icon={<Layers size={15} />} label="Ecosystems" value={s.ecosystems}
            description="Registries in scope."
            context={ECOSYSTEMS.filter((e) => scan.ecosystems.some((x) => x.ecosystem === e)).map((e) => ECOSYSTEM_META[e].label).join(' · ')}
          />
        </div>
      </Section>

      {/* attack surface */}
      <Section className="mt-12" title="Attack surface" description="Where the signals concentrate. Select a row to filter the findings.">
        <AttackSurfaceBars />
      </Section>

      {/* highest risk */}
      <Section
        className="mt-12" title="Highest-risk findings" description="The five signals most worth reviewing first."
        action={<Link to="/findings" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:text-white">View all {s.total_findings} <ArrowRight size={14} /></Link>}
      >
        <motion.div variants={staggerParent(0.07, 0.05)} initial="hidden" animate="show" className="space-y-3">
          {top.map((f, i) => (
            <motion.div key={f.id} variants={item}><FindingCard finding={f} rank={i + 1} /></motion.div>
          ))}
        </motion.div>
        {top.length === 0 && (
          <div className="rounded-r3 border border-hair bg-card p-10 text-center text-ink-3">No exposed package signals detected.</div>
        )}
      </Section>
    </>
  )
}

function catContext(findings: import('@/types/scan').Finding[], cat: import('@/types/scan').Category) {
  const fs = findings.filter((f) => f.category === cat)
  const crit = fs.filter((f) => f.severity === 'critical').length
  const high = fs.filter((f) => f.severity === 'high').length
  if (!fs.length) return 'None found'
  return [crit && `${crit} critical`, high && `${high} high`].filter(Boolean).join(' · ') || 'Medium and below'
}

function CatBar({ cat }: { cat: import('@/types/scan').Category }) {
  const { scan } = useScan()
  const fs = (scan?.findings ?? []).filter((f) => f.category === cat)
  return (
    <div className="w-14" aria-hidden>
      <MicroBar height={5} parts={SEVERITY_ORDER.map((sv) => ({ value: fs.filter((f) => f.severity === sv).length, color: sevColor(sv) }))} />
    </div>
  )
}

/* ---------------------------------------------------------------------------------------------- */

function Hero() {
  const { scan } = useScan()
  const navigate = useNavigate()
  const reduced = !!useReducedMotion()
  if (!scan) return null
  const s = scan.summary
  const counts: Severity[] = ['critical', 'high', 'medium', 'low']
  const label = SEVERITY_META[s.risk_label]

  return (
    <motion.section
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}
      aria-label="Supply chain exposure"
      className="relative overflow-hidden rounded-r5 border border-white/[.08] bg-card shadow-card"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 90% at 88% 40%, rgb(var(--c-accent) / .11), transparent 70%), radial-gradient(40% 60% at 0% 0%, rgb(var(--c-magenta) / .04), transparent 70%)' }} />
      <div className="relative grid items-center gap-8 p-6 md:p-10 lg:grid-cols-[1fr_auto] lg:gap-14">
        <div className="min-w-0">
          <p className="eyebrow">Supply chain exposure</p>
          <h2 className="mt-3 max-w-[22ch] text-[28px] font-semibold leading-[1.12] tracking-[-0.035em] md:text-[36px]">
            Your project contains <span className="text-accent-soft"><CountUp value={s.total_findings} duration={0.9} delay={0.2} /></span> identified attack-surface signals.
          </h2>
          {scan.findings[0] && (
            <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-ink-3">
              Mostly driven by <span className="mono text-ink-2">{scan.findings[0].package}</span>
              {' '}({scan.findings[0].risk_score}) &mdash; {scan.findings[0].title.replace(/\.+$/, '')}.
            </p>
          )}

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {counts.map((sv, i) => {
              const m = SEVERITY_META[sv]
              const n = s.severity_counts[sv]
              return (
                <motion.button
                  key={sv} type="button"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 + i * 0.07, ease: EASE }}
                  onClick={() => navigate(`/findings?severity=${sv}`)}
                  aria-label={`${n} ${m.label} findings. Open filtered list`}
                  className="group rounded-r3 border border-white/[.07] bg-black/25 p-4 text-left transition-[border-color,background,transform] duration-comp ease-ripple hover:-translate-y-0.5 hover:bg-black/35"
                  style={{ ['--h' as string]: m.border }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = m.border)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
                >
                  <span className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[.12em]" style={{ color: m.text }}>
                    <SeverityDot severity={sv} pulse /> {m.label}
                  </span>
                  <span className="mt-2 block text-[30px] font-semibold leading-none tracking-[-0.03em]"><CountUp value={n} duration={0.8} delay={0.35 + i * 0.07} /></span>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* radial score */}
        <div className="relative mx-auto grid place-items-center lg:mx-0">
          <RippleRings size={440} period={8} />
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-0 m-auto h-[110%] w-[110%] rounded-full" style={{ background: 'radial-gradient(circle, rgb(var(--c-accent) / .22), transparent 70%)' }} />
            <RadialScore value={s.risk_score} size={248}>
              {(n) => (
                <div className="flex flex-col items-center">
                  <span className="text-[64px] font-semibold leading-none tracking-[-0.05em]" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(n)}</span>
                  <span className="mt-2 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-[.2em] text-ink-3">
                    RISK SCORE
                    <Tooltip content="A 0–100 blend of every finding, weighted by severity and detection confidence, with diminishing returns for repeated signals. Critical findings move it most. Above 70 is high.">
                      <button type="button" aria-label="How the risk score is calculated" className="grid h-4 w-4 place-items-center rounded-full text-ink-4 hover:text-ink-2"><Info size={12} /></button>
                    </Tooltip>
                  </span>
                  <span className="mt-2.5"><SeverityBadge severity={s.risk_label} label={`${label.label} risk`} /></span>
                </div>
              )}
            </RadialScore>
          </div>
        </div>
      </div>
    </motion.section>
  )
}

/* ---------------------------------------------------------------------------------------------- */

function AttackSurfaceBars() {
  const { scan } = useScan()
  const reduced = !!useReducedMotion()
  if (!scan) return null
  const a = scan.summary.attack_surface
  const rows = (Object.keys(CATEGORY_META) as Array<keyof typeof a>).map((k) => ({ key: k, n: a[k], meta: CATEGORY_META[k] }))
  const max = Math.max(1, ...rows.map((r) => r.n))
  return (
    <div className="overflow-hidden rounded-r4 border border-hair bg-card shadow-card">
      {rows.map((r, i) => {
        const fs = scan.findings.filter((f) => f.category === r.key)
        const worst = SEVERITY_ORDER.find((sv) => fs.some((f) => f.severity === sv)) ?? 'info'
        return (
          <Link
            key={r.key} to={r.meta.route}
            className={cn('group grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 px-5 py-4 transition-colors duration-micro hover:bg-white/[.025] md:grid-cols-[240px_1fr_auto] md:px-6', i > 0 && 'border-t border-white/[.05]')}
          >
            <div className="min-w-0">
              <div className="text-[14px] font-medium">{r.meta.label}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">{r.meta.blurb}</div>
            </div>
            <div className="order-3 col-span-2 md:order-none md:col-span-1">
              <div className="h-2 overflow-hidden rounded-full bg-white/[.05]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, rgb(var(--c-accent)), ${r.n ? sevColor(worst) : 'rgb(var(--c-accent-soft))'})`, transformOrigin: 'left' }}
                  initial={{ scaleX: reduced ? 1 : 0 }} animate={{ scaleX: r.n / max }} transition={{ duration: 0.9, delay: 0.15 + i * 0.08, ease: EASE }}
                />
              </div>
            </div>
            <div className="flex items-center gap-3 justify-self-end">
              <span className="tnum text-[20px] font-semibold tracking-[-0.02em]">{r.n}</span>
              {r.n > 0 && <SeverityBadge severity={worst} size="sm" />}
              <ArrowUpRight size={16} className="text-ink-4 transition-colors group-hover:text-accent-soft" aria-hidden />
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function WarningsBanner({ warnings }: { warnings: string[] }) {
  const { refreshHealth } = useScan()
  return (
    <div role="alert" className="mb-5 flex items-start gap-3 rounded-r3 border border-amber/25 bg-amber/[.06] p-4">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px]">
        <p className="font-medium text-ink">Registry unavailable</p>
        <ul className="mt-1 space-y-0.5 text-ink-3">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        <p className="mt-1 text-ink-3">Your local lockfile analysis is still available.</p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => void refreshHealth()}>Retry</Button>
    </div>
  )
}
