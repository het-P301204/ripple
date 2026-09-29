import type { ScanResult, Severity } from '@/types/scan'

/** Client-side exporters — the offline-demo fallback for /api/scans/{id}/export. */

export function toJSON(scan: ScanResult): string {
  return JSON.stringify(scan, null, 2)
}

/**
 * CSV cell with OWASP "CSV injection" protection. Package names, titles, etc. are attacker-influenced and a
 * spreadsheet evaluates any cell that starts with = + - @ (or TAB / CR, which some apps strip before evaluating).
 * Such cells are prefixed with a single quote so they stay literal text. Numbers are emitted as-is.
 */
export const csvCell = (v: unknown): string => {
  let s = v == null ? '' : String(v)
  // Spreadsheets may skip leading whitespace / zero-width / bidi characters before deciding a cell is a formula
  const bare = s.replace(/^[\s​-‏‪-‮⁠-⁤﻿]+/, '')
  if (typeof v !== 'number' && (/^[=+\-@\t\r\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) || /^[=+\-@]/.test(bare))) s = `'${s}`
  else if (typeof v === 'number' && !Number.isFinite(v)) s = ''
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(scan: ScanResult): string {
  const head = ['id', 'severity', 'risk_score', 'confidence', 'category', 'ecosystem', 'package', 'version', 'title', 'attack_vector', 'registry', 'rule_id']
  const rows = scan.findings.map((f) =>
    [f.id, f.severity, f.risk_score, f.confidence, f.category, f.ecosystem, f.package, f.version, f.title, f.attack_vector, f.registry, f.rule_id].map(csvCell).join(','),
  )
  // CRLF is the RFC 4180 record separator and what Excel expects
  return [head.join(','), ...rows].join('\r\n') + '\r\n'
}

const SARIF_LEVEL: Record<Severity, string> = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' }

export function toSARIF(scan: ScanResult): string {
  const rules = Array.from(new Map(scan.findings.map((f) => [f.rule_id, f])).values()).map((f) => ({
    id: f.rule_id, name: f.category, shortDescription: { text: f.category.replace(/_/g, ' ') },
  }))
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'RIPPLE', version: scan.version, informationUri: 'https://github.com/ripple', rules } },
      results: scan.findings.map((f) => ({
        ruleId: f.rule_id, level: SARIF_LEVEL[f.severity] ?? 'note',
        message: { text: `${f.title} — ${f.package}@${f.version}. ${f.summary}` },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.dependency_source } } }],
        properties: { severity: f.severity, risk_score: f.risk_score, confidence: f.confidence, ecosystem: f.ecosystem },
      })),
    }],
  }
  return JSON.stringify(sarif, null, 2)
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]!)
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '0')

/**
 * Content-Security-Policy for any HTML document we open from a `blob:` URL. A blob URL inherits the *opening app's
 * origin*, so a script smuggled into a report (ours or the server's) would run with the dashboard's origin. This
 * policy allows nothing but inline styles, which is all a static report needs.
 */
export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"

/** Inject the report CSP (and a no-referrer policy) as the first children of <head>. Idempotent. */
export function hardenHtml(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}"><meta name="referrer" content="no-referrer">`
  if (html.includes(REPORT_CSP)) return html
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, (m) => m + meta)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, (m) => `${m}<head>${meta}</head>`)
  return `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>${html}</body></html>`
}

/** Print-ready standalone HTML report (open in a new tab -> Save as PDF). Every interpolation is escaped. */
export function toHTML(scan: ScanResult): string {
  const rows = scan.findings
    .slice()
    .sort((a, b) => b.risk_score - a.risk_score)
    .map((f) => `<tr><td>${esc(String(f.severity).toUpperCase())}</td><td class="m">${esc(f.package)}@${esc(f.version)}</td><td>${esc(f.ecosystem)}</td><td>${esc(f.title)}</td><td>${n(f.risk_score)}</td></tr>`)
    .join('')
  const when = new Date(scan.created_at)
  const whenText = Number.isNaN(when.getTime()) ? '—' : when.toLocaleString()
  const sc = scan.summary.severity_counts
  return hardenHtml(`<!doctype html><html><head><meta charset="utf-8"><title>RIPPLE report — ${esc(scan.project)}</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;color:#15171a;max-width:920px;margin:40px auto;padding:0 24px}
h1{font-size:26px;margin:0}.sub{color:#666;margin:4px 0 24px}.score{font-size:48px;font-weight:700}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e3e3e6;padding:8px 10px;text-align:left;font-size:13px;overflow-wrap:anywhere}.m{font-family:ui-monospace,Menlo,monospace}
@media print{body{margin:0}}</style></head><body>
<h1>RIPPLE — supply-chain attack surface</h1><p class="sub">${esc(scan.project)} · ${esc(whenText)} · ${n(scan.summary.total_dependencies)} dependencies</p>
<div class="score">${n(scan.summary.risk_score)}<span style="font-size:16px;color:#666"> / 100 risk</span></div>
<p>${n(scan.summary.total_findings)} signals identified: ${n(sc.critical)} critical, ${n(sc.high)} high, ${n(sc.medium)} medium, ${n(sc.low)} low.</p>
<table><thead><tr><th>Severity</th><th>Package</th><th>Ecosystem</th><th>Finding</th><th>Risk</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`)
}
