import type { Ecosystem, Settings } from '@/types/scan'
import { api, ApiError } from './api'

/** Defaults mirror ripple/config.py (DEFAULT_REGISTRIES, ScannerSettings, Thresholds). */
export const DEFAULT_REGISTRIES: Record<Ecosystem, string> = {
  npm: 'https://registry.npmjs.org',
  pypi: 'https://pypi.org',
  go: 'https://proxy.golang.org',
  rust: 'https://crates.io',
}

export const DEFAULT_SETTINGS: Settings = {
  registries: { ...DEFAULT_REGISTRIES },
  scanner: {
    max_edit_distance: 2,
    rate_limit_rps: 5,
    timeout_s: 10,
    cache_ttl_s: 3600,
    thresholds: { critical: 80, high: 60, medium: 35, low: 15 },
    internal_scopes: [],
  },
  output: { default_format: 'rich' },
}

export const LIMITS = {
  rate: { min: 0.5, max: 50 },
  timeout: { min: 1, max: 120 },
  cache: { min: 0, max: 7 * 86400 },
  scopeLen: 128,
  scopeCount: 50,
} as const

export const CACHE_PRESETS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Off' },
  { value: 900, label: '15 min' },
  { value: 3600, label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 86400, label: '1 day' },
  { value: 604800, label: '7 days' },
]

const LS_KEY = 'ripple.settings'
const lsGet = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); return true } catch { return false } }

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Merge an unknown payload over the defaults, dropping anything malformed. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>
  const d = DEFAULT_SETTINGS
  const regs = { ...d.registries }
  for (const k of Object.keys(regs) as Ecosystem[]) {
    const v = r.registries?.[k]
    if (typeof v === 'string' && v.trim()) regs[k] = v.trim()
  }
  const sc = (r.scanner ?? {}) as Partial<Settings['scanner']>
  const th = (sc.thresholds ?? {}) as Partial<Settings['scanner']['thresholds']>
  const fmt = r.output?.default_format
  return {
    registries: regs,
    scanner: {
      max_edit_distance: Math.min(3, Math.max(1, Math.round(num(sc.max_edit_distance, d.scanner.max_edit_distance)))),
      rate_limit_rps: num(sc.rate_limit_rps, d.scanner.rate_limit_rps),
      timeout_s: num(sc.timeout_s, d.scanner.timeout_s),
      cache_ttl_s: num(sc.cache_ttl_s, d.scanner.cache_ttl_s),
      thresholds: {
        critical: num(th.critical, d.scanner.thresholds.critical),
        high: num(th.high, d.scanner.thresholds.high),
        medium: num(th.medium, d.scanner.thresholds.medium),
        low: num(th.low, d.scanner.thresholds.low),
      },
      internal_scopes: Array.isArray(sc.internal_scopes) ? sc.internal_scopes.filter((s): s is string => typeof s === 'string') : [],
    },
    output: { default_format: fmt === 'rich' || fmt === 'json' || fmt === 'sarif' || fmt === 'csv' ? fmt : d.output.default_format },
  }
}

/** Same rule as the server (`^https?://…`, no whitespace, ≤300 chars). */
export function registryUrlError(url: string): string | null {
  const v = url.trim()
  if (!v) return 'Enter a registry URL.'
  if (v.length > 300) return 'That URL is too long (300 characters max).'
  if (/\s/.test(v)) return 'URLs can’t contain spaces.'
  if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(v)) return 'Use a full URL starting with https:// or http://.'
  let u: URL
  try { u = new URL(v) } catch { return 'That doesn’t look like a valid URL.' }
  // credentials in a URL would be persisted in localStorage / shown in the UI / logged by proxies
  if (u.username || u.password) return 'Don’t put a username or password in the URL.'
  return null
}

export const isPlainHttp = (url: string) => /^http:\/\//i.test(url.trim())

export interface SettingsErrors {
  registries: Partial<Record<Ecosystem, string>>
  rate_limit_rps?: string
  timeout_s?: string
  cache_ttl_s?: string
  thresholds?: string
}

export function validateSettings(s: Settings): SettingsErrors {
  const e: SettingsErrors = { registries: {} }
  for (const k of Object.keys(s.registries) as Ecosystem[]) {
    const m = registryUrlError(s.registries[k])
    if (m) e.registries[k] = m
  }
  const sc = s.scanner
  if (!(sc.rate_limit_rps > 0 && sc.rate_limit_rps <= LIMITS.rate.max)) e.rate_limit_rps = `Choose a rate between ${LIMITS.rate.min} and ${LIMITS.rate.max} requests per second.`
  if (!(sc.timeout_s > 0 && sc.timeout_s <= LIMITS.timeout.max)) e.timeout_s = `Choose a timeout between ${LIMITS.timeout.min} and ${LIMITS.timeout.max} seconds.`
  if (!(sc.cache_ttl_s >= 0 && sc.cache_ttl_s <= LIMITS.cache.max)) e.cache_ttl_s = 'Cache duration must be between 0 seconds and 7 days.'
  const t = sc.thresholds
  if (!(t.critical > t.high && t.high > t.medium && t.medium > t.low && t.low >= 0 && t.critical <= 100)) {
    e.thresholds = 'Thresholds must descend: critical > high > medium > low ≥ 0.'
  }
  return e
}

export const hasErrors = (e: SettingsErrors) =>
  Object.keys(e.registries).length > 0 || !!(e.rate_limit_rps || e.timeout_s || e.cache_ttl_s || e.thresholds)

export const settingsEqual = (a: Settings, b: Settings) => JSON.stringify(normalizeSettings(a)) === JSON.stringify(normalizeSettings(b))

export function readLocalSettings(): Settings | null {
  const raw = lsGet(LS_KEY)
  if (!raw) return null
  try { return normalizeSettings(JSON.parse(raw)) } catch { return null }
}
export const writeLocalSettings = (s: Settings) => lsSet(LS_KEY, JSON.stringify(s))

export type SettingsSource = 'server' | 'local' | 'default'

/** GET /api/settings; fall back to what was saved locally, then to defaults. */
export async function loadSettings(): Promise<{ settings: Settings; source: SettingsSource }> {
  try {
    return { settings: normalizeSettings(await api.settings()), source: 'server' }
  } catch {
    const local = readLocalSettings()
    return local ? { settings: local, source: 'local' } : { settings: normalizeSettings(null), source: 'default' }
  }
}

/**
 * PUT /api/settings. If the server can't be reached the values are kept in localStorage instead
 * (`source: 'local'`). A server-side validation error is re-thrown so the UI can show its message.
 */
export async function persistSettings(s: Settings): Promise<{ settings: Settings; source: 'server' | 'local' }> {
  try {
    const saved = normalizeSettings(await api.saveSettings(s))
    writeLocalSettings(saved)
    return { settings: saved, source: 'server' }
  } catch (e) {
    if (e instanceof ApiError && !e.unreachable) throw e
    writeLocalSettings(s)
    return { settings: s, source: 'local' }
  }
}

/** Severity band for a score under the given thresholds (mirrors severity_for_score). */
export function bandFor(score: number, t: Settings['scanner']['thresholds']): 'critical' | 'high' | 'medium' | 'low' | 'info' {
  if (score >= t.critical) return 'critical'
  if (score >= t.high) return 'high'
  if (score >= t.medium) return 'medium'
  if (score >= t.low) return 'low'
  return 'info'
}

/** CLI flags that reproduce the scanner settings on one run. */
export function cliFlagsFor(s: Settings): string {
  const parts: string[] = []
  parts.push(`--rate-limit ${s.scanner.rate_limit_rps}`, `--timeout ${s.scanner.timeout_s}`)
  // POSIX single-quote every user-supplied value: this string is meant to be copy-pasted into a shell
  for (const sc of s.scanner.internal_scopes) parts.push(`--internal-scope '${sc.replace(/'/g, "'\\''")}'`)
  return parts.join(' ')
}
