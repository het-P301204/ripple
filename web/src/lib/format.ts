const finite = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

export const fmtNumber = (n: number | null | undefined): string =>
  finite(n) ? new Intl.NumberFormat('en-US').format(n) : '—'

export function fmtCompact(n: number | null | undefined): string {
  if (!finite(n)) return '—'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function fmtDuration(ms: number): string {
  if (!finite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 59.95) return `${s.toFixed(1)} s`
  const t = Math.round(s) // whole seconds first, so 119.6 s reads "2m 0s", never "1m 60s"
  return `${Math.floor(t / 60)}m ${t % 60}s`
}

export function fmtDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return '—'
  const diff = Date.now() - d
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(iso, false)
}

export const fmtPercent = (v: number, digits = 0) => (finite(v) ? `${(v * 100).toFixed(digits)}%` : '—')
export const plural = (n: number, one: string, many = one + 's') => `${finite(n) ? n : 0} ${n === 1 ? one : many}`
export const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.min(hi, Math.max(lo, v)))
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Trigger a browser download for a string / blob. */
export function downloadBlob(data: BlobPart, filename: string, type: string) {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
