import { useMemo } from 'react'
import type { ScanResult, Severity } from '@/types/scan'
import { ECOSYSTEM_META, SEVERITY_RANK } from '@/lib/meta'

/* Palette copied from ripple/reports/rich.py so the preview matches the real terminal output. */
const C = { violet: '#A78BFA', magenta: '#F472B6', dim: '#8B8F98', text: '#E6E7EA', border: '#4B4E57' }
const SEV: Record<Severity, string> = { critical: '#F0506E', high: '#F97316', medium: '#F59E0B', low: '#A3E635', info: '#9CA3AF' }

type Span = { t: string; c?: string; b?: boolean }
type Line = Span[]

const pad = (s: string | number, n: number, right = false) => {
  const v = String(s)
  const cut = v.length > n ? `${v.slice(0, n - 1)}…` : v
  return right ? cut.padStart(n) : cut.padEnd(n)
}
const bar = (n: number, of: number, w: number) => {
  const f = Math.min(w, Math.max(0, Math.round((w * (Number.isFinite(n) ? n : 0)) / Math.max(1, of))))
  return { full: '█'.repeat(f), empty: '░'.repeat(w - f) }
}

/** Build the same tables `ripple report latest` prints, from the loaded scan. */
export function buildTerminalLines(scan: ScanResult, top = 5): Line[] {
  const s = scan.summary
  const L: Line[] = []
  const b = (t: string): Span => ({ t, c: C.border })
  const risk = bar(s.risk_score, 100, 30)

  L.push([{ t: 'Overall risk  ', c: C.dim }, { t: `${s.risk_score}/100`, c: SEV[s.risk_label], b: true }, { t: '  ' }, { t: risk.full, c: SEV[s.risk_label] }, { t: risk.empty, c: C.border }, { t: `  ${s.risk_label.toUpperCase()}`, c: SEV[s.risk_label] }])
  L.push([])

  // severity table
  const W = [8, 8, 10]
  const rule = (l: string, m: string, r: string) => b(`${l}${W.map((w) => '─'.repeat(w + 2)).join(m)}${r}`)
  L.push([{ t: 'Severity summary', c: C.violet, b: true }])
  L.push([rule('╭', '┬', '╮')])
  L.push([b('│ '), { t: pad('Severity', W[0]), c: C.dim }, b(' │ '), { t: pad('Findings', W[1], true), c: C.dim }, b(' │ '), { t: pad('Share', W[2]), c: C.dim }, b(' │')])
  L.push([rule('├', '┼', '┤')])
  ;(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).forEach((k) => {
    const n = s.severity_counts[k]
    const sh = bar(n, Math.max(1, s.total_findings), 10)
    L.push([b('│ '), { t: pad(k.toUpperCase(), W[0]), c: SEV[k] }, b(' │ '), { t: pad(n, W[1], true), c: n ? SEV[k] : C.dim }, b(' │ '), { t: sh.full, c: SEV[k] }, { t: sh.empty, c: C.border }, b(' │')])
  })
  L.push([rule('╰', '┴', '╯')])
  L.push([])

  // top findings table
  const F = [8, 8, 5, 26, 6]
  const frule = (l: string, m: string, r: string) => b(`${l}${F.map((w) => '─'.repeat(w + 2)).join(m)}${r}`)
  const rows = [...scan.findings].sort((a, c) => c.risk_score - a.risk_score || SEVERITY_RANK[c.severity] - SEVERITY_RANK[a.severity]).slice(0, top)
  L.push([{ t: 'Top findings', c: C.violet, b: true }])
  L.push([frule('╭', '┬', '╮')])
  L.push([b('│ '), { t: pad('ID', F[0]), c: C.dim }, b(' │ '), { t: pad('Sev', F[1]), c: C.dim }, b(' │ '), { t: pad('Score', F[2], true), c: C.dim }, b(' │ '), { t: pad('Package', F[3]), c: C.dim }, b(' │ '), { t: pad('Eco', F[4]), c: C.dim }, b(' │')])
  L.push([frule('├', '┼', '┤')])
  rows.forEach((f) => {
    const pkg = `${f.package}${f.version ? `@${f.version}` : ''}`
    L.push([b('│ '), { t: pad(f.id, F[0]), c: C.violet }, b(' │ '), { t: pad(f.severity.toUpperCase(), F[1]), c: SEV[f.severity] }, b(' │ '), { t: pad(f.risk_score, F[2], true), c: SEV[f.severity] }, b(' │ '), { t: pad(pkg, F[3]), c: C.text }, b(' │ '), { t: pad(ECOSYSTEM_META[f.ecosystem].label, F[4]), c: C.dim }, b(' │')])
  })
  L.push([frule('╰', '┴', '╯')])
  const extra = scan.findings.length - rows.length
  if (extra > 0) L.push([{ t: `  · ${extra} more finding(s). Use \`ripple analyze latest --finding <ID>\` or export the full report.`, c: C.dim }])
  return L
}

/** Static, real-data preview of the CLI's rich report. Not a live terminal. */
export function TerminalPreview({ scan }: { scan: ScanResult }) {
  const lines = useMemo(() => buildTerminalLines(scan), [scan])
  const summary = `Terminal report preview: overall risk ${scan.summary.risk_score} out of 100, ${scan.summary.total_findings} findings, top ${Math.min(5, scan.findings.length)} listed.`
  return (
    <div className="overflow-hidden rounded-r2 border border-white/[.07] bg-[#0B0C0E]">
      <div className="flex items-center gap-2 border-b border-white/[.05] px-3.5 py-2 text-[11px] text-ink-3">
        <span aria-hidden className="flex gap-1">{[0, 1, 2].map((i) => <i key={i} className="block h-2 w-2 rounded-full bg-white/[.1]" />)}</span>
        <span className="mono">ripple report latest</span>
      </div>
      <div
        role="img" aria-label={summary} tabIndex={0}
        className="mono overflow-x-auto px-3.5 py-3 text-[11px] leading-[1.5] text-[#E6E7EA]"
      >
        {lines.map((ln, i) => (
          <div key={i} className="whitespace-pre" style={{ minHeight: '1.5em' }}>
            {ln.map((sp, j) => <span key={j} style={{ color: sp.c, fontWeight: sp.b ? 600 : undefined }}>{sp.t}</span>)}
          </div>
        ))}
      </div>
    </div>
  )
}
