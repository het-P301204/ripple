import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ArrowUpRight, X } from 'lucide-react'
import type { Category, Finding, Package, ScanResult } from '@/types/scan'
import { CATEGORY_META, SEVERITY_META, sevColor } from '@/lib/meta'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'
import { SeverityBadge } from '@/components/ui/SeverityBadge'
import { StateGlyph } from '@/components/ui/States'
import { CharDiff } from './CharDiff'
import './charts.css'

interface Step { kicker: string; title: React.ReactNode; sub: string; mono?: boolean }

const RESOLUTION: Record<string, string> = {
  exact: 'pinned to an exact version', hashed: 'pinned with an integrity hash', range: 'resolved from a version range',
  vcs: 'fetched from a VCS source', local: 'read from a local path', unknown: 'resolved in an unknown way',
}

/** Build the three steps of the conceptual path for a finding: your project, the exposed package, and what reaches it. */
export function pathSteps(f: Finding, scan: ScanResult, pkg: Package | undefined): [Step, Step, Step] {
  const isOriginal = scan.lookalikes.some((g) => g.original === f.package && g.ecosystem === f.ecosystem)
  const project: Step = { kicker: 'Your project', title: scan.project, sub: `Declared in ${f.dependency_source}`, mono: false }
  const pkgStep: Step = {
    kicker: f.category === 'dependency_confusion' ? 'Internal package' : 'Exposed package',
    title: <>{f.package} <span className="text-ink-3">{f.version}</span></>,
    sub: pkg ? `${pkg.internal_looking ? 'Internal-looking name, ' : ''}${RESOLUTION[pkg.resolution] ?? 'resolved from the lockfile'}` : f.resolution_type,
    mono: true,
  }
  switch (f.category as Category) {
    case 'dependency_confusion':
      return [project, pkgStep, {
        kicker: 'Public registry', title: f.registry,
        sub: f.public_status === 'not_found' ? 'The name is unclaimed. Anyone can publish it.' : 'A package with this name already exists publicly.', mono: true,
      }]
    case 'typosquatting': {
      const other = f.related_package
      return [project, pkgStep, {
        kicker: isOriginal ? 'Lookalike in the wild' : 'Popular package it imitates',
        title: other ? <CharDiff original={isOriginal ? f.package : other} candidate={isOriginal ? other : f.package} mode={isOriginal ? 'candidate' : 'original'} /> : 'A popular package',
        sub: isOriginal ? 'Registered under a near-identical name.' : 'One small edit from the real name.', mono: true,
      }]
    }
    case 'suspicious_metadata': {
      const s = pkg?.metadata?.install_scripts
      const script = s ? (['preinstall', 'install', 'postinstall', 'prepare'] as const).find((k) => s[k]) : undefined
      const net = pkg?.metadata?.network_indicators?.[0]
      const ev = f.evidence[0]
      return [project, pkgStep, {
        kicker: 'Install-time behaviour',
        title: script ? script : net ?? ev?.value ?? 'Suspicious metadata',
        sub: script ? 'Runs automatically when the package installs.' : net ? 'Network indicator found in the package.' : ev?.label ?? f.title, mono: true,
      }]
    }
    default:
      return [project, pkgStep, { kicker: 'Registry or source', title: f.registry, sub: f.title, mono: true }]
  }
}

function Connector({ animated, color }: { animated: boolean; color: string }) {
  return (
    <>
      <svg className="hidden h-6 w-14 shrink-0 self-center md:block" viewBox="0 0 56 24" aria-hidden>
        <line x1="2" y1="12" x2="46" y2="12" stroke={color} strokeWidth="1.4" className={animated ? 'as-dash' : undefined} strokeDasharray={animated ? undefined : '0'} />
        <path d="M44 7l7 5-7 5" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg className="mx-auto h-9 w-6 shrink-0 md:hidden" viewBox="0 0 24 36" aria-hidden>
        <line x1="12" y1="2" x2="12" y2="26" stroke={color} strokeWidth="1.4" className={animated ? 'as-dash' : undefined} strokeDasharray={animated ? undefined : '0'} />
        <path d="M7 24l5 7 5-7" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  )
}

function StepCard({ step, exposed, sev, ripple }: { step: Step; exposed?: boolean; sev?: Finding['severity']; ripple?: boolean }) {
  return (
    <div
      className={cn('relative min-w-0 flex-1 rounded-r3 border px-4 py-3.5', exposed ? 'bg-elevated' : 'border-white/[.08] bg-card')}
      style={exposed && sev ? { borderColor: sevColor(sev, 0.5) } : undefined}
    >
      {ripple && sev && [0, 1, 2].map((k) => <span key={k} aria-hidden className="as-ring" style={{ ['--rc' as string]: sevColor(sev, 0.7), ['--rd' as string]: `${k * 320}ms` }} />)}
      <p className="text-[10.5px] font-medium uppercase tracking-[.12em] text-ink-3">{step.kicker}</p>
      <p className={cn('mt-1.5 break-words text-[14px] font-medium leading-snug text-ink', step.mono && 'mono')}>{step.title}</p>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{step.sub}</p>
    </div>
  )
}

/**
 * The conceptual attack path for the selected finding: Your project ── Exposed package ──▶ what reaches it
 * (public registry, lookalike, install script or plain-http source). The link out to the counterpart carries
 * travelling dashes and the package emits severity-coloured ripples.
 */
export function AttackPath({
  finding, category, scan, pkg, extra, onClear,
}: { finding: Finding | null; category: Category; scan: ScanResult; pkg?: Package; extra: number; onClear: () => void }) {
  const reduced = !!useReducedMotion()
  const meta = CATEGORY_META[category]
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
      exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: EASE }}
      className="overflow-hidden"
    >
      <div className="border-t border-white/[.06] px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Attack path · {meta.label}</p>
            {finding ? (
              <h3 className="mt-2 flex flex-wrap items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
                <SeverityBadge severity={finding.severity} />
                <span className="min-w-0">{finding.title}</span>
              </h3>
            ) : (
              <h3 className="mt-2 text-[15px] font-semibold tracking-[-0.01em]">{meta.label}</h3>
            )}
          </div>
          <div className="flex items-center gap-2">
            {finding && (
              <Link to={`/findings/${encodeURIComponent(finding.id)}`} className="inline-flex h-8 items-center gap-1.5 rounded-r2 border border-white/[.1] bg-white/[.04] px-3 text-[12.5px] font-medium hover:bg-white/[.07]">
                Open finding <ArrowUpRight size={14} aria-hidden />
              </Link>
            )}
            <button type="button" onClick={onClear} aria-label="Clear selection" className="grid h-8 w-8 place-items-center rounded-r2 text-ink-3 hover:bg-white/[.07] hover:text-ink"><X size={16} /></button>
          </div>
        </div>

        {finding ? (
          <>
            <div className="mt-5 flex flex-col items-stretch gap-1 md:flex-row md:gap-0" key={finding.id}>
              {(() => {
                const [a, b, c] = pathSteps(finding, scan, pkg)
                const col = sevColor(finding.severity, 0.8)
                return (
                  <>
                    <StepCard step={a} />
                    <Connector animated={false} color="rgba(255,255,255,.22)" />
                    <StepCard step={b} exposed sev={finding.severity} ripple />
                    <Connector animated={!reduced} color={col} />
                    <StepCard step={c} />
                  </>
                )
              })()}
            </div>
            <p className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-ink-2">{finding.attack_vector}</p>
            <p className="mt-2 text-[12px] text-ink-3">
              Risk <span className="tnum text-ink-3">{finding.risk_score}</span> · {SEVERITY_META[finding.severity].label}
              {extra > 0 && <> · {extra} more in this category</>}
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center px-4 py-8 text-center">
            <StateGlyph size={64} />
            <p className="mt-4 text-[14px] font-medium">No exposed package signals detected</p>
            <p className="mt-1 max-w-sm text-[13px] text-ink-3">Nothing in this scan matches {meta.label.toLowerCase()}. {meta.blurb}</p>
          </div>
        )}
      </div>
    </motion.div>
  )
}
