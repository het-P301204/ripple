import type { ScanHistoryEntry, ScanResult } from '@/types/scan'

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** "Today", "Yesterday", "Sep 27", or "Sep 27, 2025" for other years. */
export function fmtScanDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

export const modeLabel = (mode: string) => (mode === 'demo' ? 'Demo' : mode === 'live' ? 'Live' : 'Offline')
export const modeTone = (mode: string): 'amber' | 'accent' | 'neutral' => (mode === 'demo' ? 'amber' : mode === 'live' ? 'accent' : 'neutral')

/** History row for a scan that only exists in the store (server unreachable or list not refreshed yet). */
export function entryFromScan(s: ScanResult): ScanHistoryEntry {
  return {
    id: s.id,
    project: s.project,
    created_at: s.created_at,
    mode: s.mode,
    dependencies: s.summary.total_dependencies,
    findings: s.summary.total_findings,
    risk_score: s.summary.risk_score,
    risk_label: s.summary.risk_label,
    ecosystems: s.ecosystems.map((e) => e.ecosystem),
  }
}
