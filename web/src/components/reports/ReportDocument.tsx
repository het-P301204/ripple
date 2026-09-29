import { memo, useMemo } from 'react'
import type { Finding, ScanResult, Severity } from '@/types/scan'
import { CATEGORY_META, ECOSYSTEM_META, SEVERITY_META, SEVERITY_RANK } from '@/lib/meta'
import { fmtDate, fmtDuration, fmtNumber, plural } from '@/lib/format'
import '@/lib/report-print.css'

export const RESPONSIBLE_USE =
  'For authorised security assessment only. RIPPLE is read-only: it never registers, publishes, installs or executes packages.'

export type ReportTheme = 'dark' | 'paper'
export const REPORT_TOP_FINDINGS = 8

const MODE_LABEL = { demo: 'Demo dataset', offline: 'Offline analysis', live: 'Live registries' } as const

/** Standing caveats, adapted to how this scan was produced. */
export function limitationsFor(scan: ScanResult): string[] {
  const out: string[] = []
  if (scan.mode === 'demo') out.push('This is RIPPLE’s bundled demo dataset. Every package, maintainer and registry record in it is synthetic.')
  else if (scan.mode === 'offline') out.push('Offline analysis: public registries were not queried. Findings rely on lockfile evidence and bundled popularity data, so registration dates, download counts and maintainer history are unavailable.')
  else out.push('Live analysis: public registries were queried with read-only GET requests. Results reflect registry state at scan time and can change.')
  out.push('Findings are risk signals, not proof of compromise. Review each one, and its evidence, before acting.')
  const unverified = scan.packages.filter((p) => p.status === 'unverified').length
  if (unverified) out.push(`${plural(unverified, 'package')} could not be verified against a registry and ${unverified === 1 ? 'is' : 'are'} excluded from registry-based checks.`)
  return out
}

const topFindings = (scan: ScanResult, n: number): Finding[] =>
  [...scan.findings].sort((a, b) => b.risk_score - a.risk_score || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).slice(0, n)

/** Gradient-free brand mark: safe to duplicate in the DOM and inside display:none ancestors while printing. */
const ReportMark = () => (
  <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
    <circle cx="16" cy="16" r="11.5" stroke="#8B5CF6" strokeOpacity=".4" strokeWidth="1.5" />
    <circle cx="16" cy="16" r="7" stroke="#8B5CF6" strokeWidth="1.8" />
    <circle cx="16" cy="16" r="3" fill="#8B5CF6" />
  </svg>
)

const SevTag = ({ s, label }: { s: Severity; label?: string }) => <span className="rp-sev" data-sev={s}>{label ?? SEVERITY_META[s].label}</span>

/**
 * The executive report. `theme="dark"` is the in-app rendering; `theme="paper"` is the light,
 * print-safe version (used for the "Print view" and mounted off-screen for window.print()).
 */
export const ReportDocument = memo(function ReportDocument({ scan, theme }: { scan: ScanResult; theme: ReportTheme }) {
  const s = scan.summary
  const top = useMemo(() => topFindings(scan, REPORT_TOP_FINDINGS), [scan])
  const limits = useMemo(() => limitationsFor(scan), [scan])
  const surface = (Object.keys(CATEGORY_META) as Array<keyof typeof s.attack_surface>).map((k) => ({ k, n: s.attack_surface[k], meta: CATEGORY_META[k] }))
  const maxSurface = Math.max(1, ...surface.map((r) => r.n))
  const counts: Severity[] = ['critical', 'high', 'medium', 'low']

  return (
    <article className="rp-doc" data-theme={theme} aria-label={`RIPPLE report for ${scan.project}`}>
      <div className="rp-brand">
        <span className="rp-brand-name"><ReportMark /> RIPPLE</span>
        <span className="rp-brand-tag">Supply-chain attack-surface report</span>
      </div>

      <h2 className="rp-title rp-mono">{scan.project}</h2>
      <p className="rp-sub">
        {plural(s.total_dependencies, 'dependency', 'dependencies')} across {plural(s.ecosystems, 'ecosystem')}, scanned {fmtDate(scan.created_at)}.
      </p>

      <dl className="rp-meta">
        <div><dt>Mode</dt><dd>{MODE_LABEL[scan.mode]}</dd></div>
        <div><dt>Duration</dt><dd>{fmtDuration(scan.duration_ms)}</dd></div>
        <div><dt>Lockfiles</dt><dd className="rp-mono" style={{ fontSize: '.88em' }}>{scan.source.files.length ? scan.source.files.join(', ') : scan.source.kind}</dd></div>
        <div><dt>Scan ID</dt><dd className="rp-mono" style={{ fontSize: '.88em' }}>{scan.id}</dd></div>
      </dl>

      {/* -------- overall risk -------- */}
      <section className="rp-section" aria-label="Overall risk">
        <h3 className="rp-h2">Overall risk</h3>
        <div className="rp-risk">
          <div>
            <div className="rp-score" style={{ color: `var(--rp-${{ critical: 'crit', high: 'high', medium: 'med', low: 'low', info: 'info' }[s.risk_label]})` }}>
              <b>{s.risk_score}</b><span>/ 100</span>
            </div>
            <div style={{ marginTop: '.7em' }}><SevTag s={s.risk_label} label={`${SEVERITY_META[s.risk_label].label} risk`} /></div>
          </div>
          <div className="rp-counts" role="list" aria-label="Findings by severity">
            {counts.map((c) => (
              <div key={c} className="rp-count" data-sev={c} role="listitem">
                <b>{s.severity_counts[c]}</b>
                <span>{SEVERITY_META[c].label}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="rp-lead">
          RIPPLE identified <b>{s.total_findings}</b> attack-surface {s.total_findings === 1 ? 'signal' : 'signals'}
          {s.internal_looking > 0 && <> and <b>{s.internal_looking}</b> internal-looking {s.internal_looking === 1 ? 'package' : 'packages'} that a public registry could shadow</>}.
        </p>
        {s.score_drivers.length > 0 && (
          <ul className="rp-drivers">{s.score_drivers.slice(0, 4).map((d, i) => <li key={i}>{d}</li>)}</ul>
        )}
      </section>

      {/* -------- attack surface -------- */}
      <section className="rp-section" aria-label="Attack surface">
        <h3 className="rp-h2">Attack surface</h3>
        <ul className="rp-surface">
          {surface.map((r) => (
            <li key={r.k}>
              <div><strong>{r.meta.label}</strong><small>{r.meta.blurb}</small></div>
              <div className="rp-bar" aria-hidden><i style={{ width: `${(r.n / maxSurface) * 100}%` }} /></div>
              <span className="rp-n">{r.n}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* -------- top findings -------- */}
      <section className="rp-section rp-break-before" aria-label="Top findings">
        <h3 className="rp-h2">Highest-risk findings</h3>
        <p className="rp-lead">
          {top.length === 0 ? 'No exposed package signals detected.' : <>The {top.length === 1 ? 'finding' : `${top.length} findings`} most worth reviewing first{s.total_findings > top.length ? `, of ${s.total_findings} in total` : ''}.</>}
        </p>
        <ol className="rp-findings">
          {top.map((f, i) => (
            <li key={f.id} className="rp-finding" data-sev={f.severity}>
              <div className="rp-f-head">
                <SevTag s={f.severity} />
                <h4 className="rp-f-title" style={{ margin: 0 }}>{i + 1}. {f.title}</h4>
                <span className="rp-f-score">Risk {f.risk_score}</span>
              </div>
              <p className="rp-f-pkg">
                <span className="rp-mono">{f.package}{f.version ? `@${f.version}` : ''}</span> · {ECOSYSTEM_META[f.ecosystem].label} · {CATEGORY_META[f.category].label} · <span className="rp-mono">{f.id}</span> · {Math.round(f.confidence * 100)}% confidence
              </p>
              <p className="rp-f-sum">{f.summary}</p>
              {(f.drivers.length > 0 || f.remediation.length > 0) && (
                <div className="rp-f-cols">
                  {f.drivers.length > 0 && (
                    <div>
                      <h5>Risk drivers</h5>
                      <ul>{f.drivers.slice(0, 4).map((d, j) => <li key={j}><span className="rp-pts" style={d.points < 0 ? { color: 'var(--rp-low)' } : undefined}>{d.points > 0 ? '+' : ''}{d.points}</span><span>{d.label}</span></li>)}</ul>
                    </div>
                  )}
                  {f.remediation.length > 0 && (
                    <div>
                      <h5>Remediation</h5>
                      <ul className="rp-fix">{f.remediation.slice(0, 3).map((r, j) => <li key={j}><b>{r.title}.</b> {r.detail}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* -------- ecosystems -------- */}
      <section className="rp-section" aria-label="Ecosystems">
        <h3 className="rp-h2">By ecosystem</h3>
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>
                <th>Ecosystem</th><th>Lockfiles</th><th className="r">Deps</th><th className="r">Direct</th><th className="r">Internal</th><th className="r">Findings</th><th className="r">Risk</th>
              </tr>
            </thead>
            <tbody>
              {scan.ecosystems.map((e) => {
                const n = e.severity_counts.critical + e.severity_counts.high + e.severity_counts.medium + e.severity_counts.low + e.severity_counts.info
                return (
                  <tr key={e.ecosystem}>
                    <td><strong>{ECOSYSTEM_META[e.ecosystem].label}</strong></td>
                    <td className="rp-mono">{e.lockfiles.join(', ') || '—'}</td>
                    <td className="r">{fmtNumber(e.total)}</td>
                    <td className="r">{fmtNumber(e.direct)}</td>
                    <td className="r">{fmtNumber(e.internal_looking)}</td>
                    <td className="r">{fmtNumber(n)}</td>
                    <td className="r"><b>{e.risk_score}</b></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* -------- limitations -------- */}
      <section className="rp-section" aria-label="Warnings and limitations">
        <h3 className="rp-h2">Warnings and limitations</h3>
        <ul className="rp-list">
          {scan.warnings.map((w, i) => <li key={`w${i}`} data-warn>{w}</li>)}
          {limits.map((l, i) => <li key={`l${i}`}>{l}</li>)}
        </ul>
        <p className="rp-note"><b>Responsible use.</b> {RESPONSIBLE_USE}</p>
      </section>

      <footer className="rp-foot">
        <span>Generated by RIPPLE v{scan.version}</span>
        <span className="rp-mono">{scan.id}</span>
        <span>{fmtDate(scan.created_at)}</span>
      </footer>
    </article>
  )
})
