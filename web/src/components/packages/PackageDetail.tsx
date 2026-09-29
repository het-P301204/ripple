import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { Finding, Package } from '@/types/scan'
import { fmtCompact, fmtDate } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { SeverityDot } from '@/components/ui/SeverityBadge'
import { RESOLUTION_LABEL } from '@/components/findings/labels'

const MAX_LIST = 6

function NameList({ title, pkgs, count, empty }: { title: string; pkgs: string[]; count: number; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-2.5">{title} <span className="tnum ml-1 normal-case tracking-normal text-ink-3">{count}</span></p>
      {pkgs.length ? (
        <ul role="list" className="space-y-1">
          {pkgs.slice(0, MAX_LIST).map((n) => (
            <li key={n}>
              <Link
                to={`/packages?q=${encodeURIComponent(n)}`}
                onClick={(e) => e.stopPropagation()}
                className="mono block truncate rounded-md py-0.5 text-[12.5px] text-ink-2 transition-colors hover:text-accent-soft"
              >
                {n}
              </Link>
            </li>
          ))}
          {pkgs.length > MAX_LIST && <li className="text-[12px] text-ink-3">+{pkgs.length - MAX_LIST} more</li>}
        </ul>
      ) : (
        <p className="text-[12.5px] text-ink-3">{count > 0 ? `${count} in this scan.` : empty}</p>
      )}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-ink-3">{label}</dt>
      <dd className="mt-1 min-w-0 text-[13px] text-ink-2">{children}</dd>
    </div>
  )
}

/** Expanded package row: dependencies, dependents, internal-looking reasons, registry metadata and related findings. */
export function PackageDetail({
  pkg: p, dependencies, dependents, findings,
}: { pkg: Package; dependencies: string[]; dependents: string[]; findings: Finding[] }) {
  const m = p.metadata
  const scripts = m ? (['preinstall', 'install', 'postinstall', 'prepare'] as const).filter((k) => m.install_scripts[k]) : []
  return (
    <div className="w-full space-y-6 text-left" onClick={(e) => e.stopPropagation()}>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
        <NameList title="Dependencies" pkgs={dependencies} count={p.dependencies.length} empty="No dependencies recorded." />
        <NameList title="Dependents" pkgs={dependents} count={Math.max(dependents.length, p.dependents_count)} empty="Nothing else in this scan depends on it." />
        <div className="min-w-0">
          <p className="eyebrow mb-2.5">Internal-looking</p>
          {p.internal_reasons.length ? (
            <ul role="list" className="space-y-1.5">
              {p.internal_reasons.map((r) => <li key={r} className="flex gap-2 text-[12.5px] text-ink-2"><span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-magenta-soft" />{r}</li>)}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">The name doesn’t look private.</p>
          )}
        </div>
      </div>

      <div className="border-t border-white/[.05] pt-5">
        <p className="eyebrow mb-3">Registry metadata</p>
        {m ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <Fact label="Registered">{fmtDate(m.registered_at, false)}{m.age_days != null && <span className="text-ink-3"> · {m.age_days}d old</span>}</Fact>
            <Fact label="Weekly downloads"><span className="tnum">{fmtCompact(m.weekly_downloads)}</span></Fact>
            <Fact label="Maintainers">
              {m.maintainers.length ? <span className="mono text-[12.5px] [overflow-wrap:anywhere]">{m.maintainers.join(', ')}</span> : '—'}
              {m.maintainer_changes > 0 && <Badge tone="amber" className="ml-2 h-5 text-[10.5px]">{m.maintainer_changes} recent {m.maintainer_changes === 1 ? 'change' : 'changes'}</Badge>}
            </Fact>
            <Fact label="Install scripts">
              {scripts.length ? (
                <span className="space-y-1">
                  {scripts.map((k) => (
                    <span key={k} className="mono block truncate text-[12px]"><span className="text-ink-3">{k}</span> {m.install_scripts[k]}</span>
                  ))}
                </span>
              ) : m.install_scripts.build_script ? 'Build script only' : 'None'}
            </Fact>
          </dl>
        ) : (
          <p className="text-[12.5px] text-ink-3">No registry metadata. The package wasn’t looked up, or it isn’t published on a public registry.</p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
          <Fact label="Resolution"><Badge mono>{RESOLUTION_LABEL[p.resolution] ?? p.resolution}</Badge></Fact>
          <Fact label="Version spec"><span className="mono text-[12.5px]">{p.spec ?? '—'}</span></Fact>
          <Fact label="Source file"><span className="mono block truncate text-[12.5px]">{p.source_file}</span></Fact>
          <Fact label="Integrity">
            {p.integrity ? (
              <span className="flex items-center gap-1"><span className="mono block min-w-0 truncate text-[12px]" title={p.integrity}>{p.integrity}</span><CopyButton value={p.integrity} label="Copy integrity hash" /></span>
            ) : (
              <span className="text-amber">No integrity hash</span>
            )}
          </Fact>
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[.05] pt-4">
        <p className="eyebrow">Findings</p>
        {findings.length ? (
          <ul role="list" className="flex min-w-0 flex-1 flex-wrap gap-2">
            {findings.map((f) => (
              <li key={f.id} className="min-w-0 max-w-full">
                <Link
                  to={`/findings/${encodeURIComponent(f.id)}`} onClick={(e) => e.stopPropagation()}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/[.08] bg-white/[.03] px-3 py-1 text-[12px] text-ink-2 transition-colors hover:border-white/[.16] hover:text-ink"
                >
                  <SeverityDot severity={f.severity} />
                  <span className="truncate">{f.title}</span>
                  <ArrowUpRight size={12} className="shrink-0 text-ink-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">No findings for this package.</p>
        )}
      </div>
    </div>
  )
}
