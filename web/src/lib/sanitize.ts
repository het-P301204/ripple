import type {
  Category, DetectResult, Ecosystem, EcosystemSummary, Edge, EvidenceItem, Finding, Health, InstallScripts,
  JobStatus, LookalikeCandidate, LookalikeGroup, Package, PackageMetadata, PackageStatus, ProgressStage,
  PublicStatus, Resolution, ScanHistoryEntry, ScanOptions, ScanResult, ScanSummary, Severity, SeverityCounts,
} from '@/types/scan'

/**
 * Defensive normalisation of everything that arrives from the API, the bundled demo, or (in future) an uploaded
 * result file. Every string in a scan is attacker-influenced (package names, descriptions, evidence, scripts,
 * maintainers), and any field may be missing, null, or the wrong type. The UI is written against the strict types in
 * `types/scan.ts`; this module is the one place that makes that true at runtime:
 *
 *  - enums are coerced to a known member (unknown severity -> 'info', unknown category -> 'suspicious_metadata'),
 *  - records that cannot be rendered at all (unknown ecosystem, no id/name) are dropped and reported in `warnings`,
 *  - numbers are finite and clamped, arrays are arrays, nested objects exist,
 *  - ids are unique (React keys, route params, Map lookups).
 *
 * Strings are kept verbatim (React escapes them on render); only their type is enforced.
 */

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
export const ECOSYSTEM_IDS: readonly Ecosystem[] = ['npm', 'pypi', 'go', 'rust']
export const CATEGORY_IDS: readonly Category[] = ['dependency_confusion', 'typosquatting', 'suspicious_metadata', 'registry_exposure']
const RESOLUTIONS: readonly Resolution[] = ['exact', 'hashed', 'range', 'vcs', 'local', 'unknown']
const PUBLIC_STATUSES: readonly PublicStatus[] = ['registered', 'not_found', 'unknown', 'error']
const PACKAGE_STATUSES: readonly PackageStatus[] = ['clean', 'flagged', 'unverified']

/** Hard ceiling for any single string, so a hostile 50 MB "description" cannot freeze layout. */
const MAX_STR = 50_000
const clip = (s: string) => (s.length > MAX_STR ? s.slice(0, MAX_STR) + '…' : s)

const str = (v: unknown, d = ''): string =>
  typeof v === 'string' ? clip(v) : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? String(v) : d
const strN = (v: unknown): string | null => (typeof v === 'string' ? clip(v) : null)
const num = (v: unknown, d = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : d
}
const numN = (v: unknown): number | null => {
  if (v == null) return null
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}
const count = (v: unknown, d = 0) => Math.max(0, num(v, d))
const unit = (v: unknown, d = 0) => Math.min(1, Math.max(0, num(v, d)))
// +Infinity (e.g. JSON `1e999`) is a *maximal* risk, not a missing one: never let a hostile value hide as 0
const score = (v: unknown, d = 0) => (v === Infinity ? 100 : Math.min(100, Math.max(0, num(v, d))))
const bool = (v: unknown, d = false) => (typeof v === 'boolean' ? v : d)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : d)
const oneOfN = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(clip) : [])
const list = <T>(v: unknown, fn: (x: unknown, i: number) => T | null): T[] => {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  v.forEach((x, i) => { const r = fn(x, i); if (r != null) out.push(r) })
  return out
}
const recOf = (v: unknown): Rec => (isRec(v) ? v : {})

/** Iso-ish timestamp or ''. Invalid dates are kept as the raw string; formatters handle NaN dates. */
const ts = (v: unknown) => str(v, '')

/** Make ids unique while preserving order (first wins its original id). */
function uniquer() {
  const seen = new Set<string>()
  return (id: string) => {
    if (!seen.has(id)) { seen.add(id); return id }
    let n = 2
    while (seen.has(`${id}~${n}`)) n++
    const u = `${id}~${n}`
    seen.add(u)
    return u
  }
}

function sevCounts(v: unknown): SeverityCounts {
  const r = recOf(v)
  return { critical: count(r.critical), high: count(r.high), medium: count(r.medium), low: count(r.low), info: count(r.info) }
}

function scripts(v: unknown): InstallScripts {
  const r = recOf(v)
  return { preinstall: strN(r.preinstall), install: strN(r.install), postinstall: strN(r.postinstall), prepare: strN(r.prepare), build_script: bool(r.build_script) }
}

function metadata(v: unknown): PackageMetadata | null {
  if (!isRec(v)) return null
  return {
    registered_at: strN(v.registered_at), latest_version: strN(v.latest_version), latest_published_at: strN(v.latest_published_at),
    versions_count: numN(v.versions_count), weekly_downloads: numN(v.weekly_downloads),
    maintainers: strArr(v.maintainers), maintainer_changes: count(v.maintainer_changes),
    install_scripts: scripts(v.install_scripts), network_indicators: strArr(v.network_indicators),
    repository_url: strN(v.repository_url), description: strN(v.description), deprecated: bool(v.deprecated),
    version_gap: numN(v.version_gap), age_days: numN(v.age_days),
  }
}

function pkg(v: unknown, uniq: (s: string) => string, dropped: { n: number }): Package | null {
  if (!isRec(v)) { dropped.n++; return null }
  const ecosystem = oneOfN(v.ecosystem, ECOSYSTEM_IDS)
  const name = str(v.name)
  const rawId = str(v.id) || (name ? `${ecosystem}:${name}@${str(v.version)}` : '')
  if (!ecosystem || !rawId || !name) { dropped.n++; return null }
  return {
    id: uniq(rawId), name, version: str(v.version), spec: strN(v.spec), ecosystem,
    registry: str(v.registry), registry_source: strN(v.registry_source),
    resolution: oneOf(v.resolution, RESOLUTIONS, 'unknown'), integrity: strN(v.integrity),
    dev: bool(v.dev), direct: bool(v.direct), depth: count(v.depth),
    dependencies: strArr(v.dependencies), dependents_count: count(v.dependents_count),
    source_file: str(v.source_file), public_status: oneOf(v.public_status, PUBLIC_STATUSES, 'unknown'),
    internal_looking: bool(v.internal_looking), internal_reasons: strArr(v.internal_reasons),
    metadata: metadata(v.metadata), risk_score: score(v.risk_score), severity: oneOf(v.severity, SEVERITIES, 'info'),
    status: oneOf(v.status, PACKAGE_STATUSES, 'unverified'), finding_ids: strArr(v.finding_ids),
    confusion: bool(v.confusion), typosquat: bool(v.typosquat), metadata_flag: bool(v.metadata_flag), registry_exposure: bool(v.registry_exposure),
  }
}

function evidence(v: unknown): EvidenceItem | null {
  if (!isRec(v)) return null
  return { label: str(v.label), value: str(v.value), mono: bool(v.mono) }
}

function finding(v: unknown, uniq: (s: string) => string, dropped: { n: number }): Finding | null {
  if (!isRec(v)) { dropped.n++; return null }
  const ecosystem = oneOfN(v.ecosystem, ECOSYSTEM_IDS)
  const id = str(v.id)
  if (!ecosystem || !id) { dropped.n++; return null }
  return {
    id: uniq(id), package_id: str(v.package_id), package: str(v.package), version: str(v.version), ecosystem,
    category: oneOf(v.category, CATEGORY_IDS, 'suspicious_metadata'), title: str(v.title), severity: oneOf(v.severity, SEVERITIES, 'info'),
    risk_score: score(v.risk_score), confidence: unit(v.confidence), summary: str(v.summary), why_flagged: str(v.why_flagged),
    attack_vector: str(v.attack_vector),
    evidence: list(v.evidence, evidence),
    drivers: list(v.drivers, (d) => (isRec(d) ? { label: str(d.label), points: num(d.points), detail: str(d.detail) } : null)),
    remediation: list(v.remediation, (r) => (isRec(r) ? { title: str(r.title), detail: str(r.detail) } : null)),
    resolution_type: str(v.resolution_type), dependency_source: str(v.dependency_source), registry: str(v.registry),
    detected_at: ts(v.detected_at), public_status: str(v.public_status, 'unknown'), related_package: strN(v.related_package), rule_id: str(v.rule_id),
  }
}

function ecoSummary(v: unknown): EcosystemSummary | null {
  if (!isRec(v)) return null
  const ecosystem = oneOfN(v.ecosystem, ECOSYSTEM_IDS)
  if (!ecosystem) return null
  return {
    ecosystem, lockfiles: strArr(v.lockfiles), registry: str(v.registry),
    total: count(v.total), direct: count(v.direct), public: count(v.public), internal_looking: count(v.internal_looking),
    confusion: count(v.confusion), typosquat: count(v.typosquat), suspicious: count(v.suspicious), exposure: count(v.exposure),
    registry_coverage: num(v.registry_coverage), risk_score: score(v.risk_score), severity_counts: sevCounts(v.severity_counts),
  }
}

function summary(v: unknown): ScanSummary {
  const r = recOf(v)
  const sa = recOf(r.attack_surface)
  return {
    total_dependencies: count(r.total_dependencies), direct_dependencies: count(r.direct_dependencies), public_packages: count(r.public_packages),
    internal_looking: count(r.internal_looking), confusion_candidates: count(r.confusion_candidates), typosquat_candidates: count(r.typosquat_candidates),
    suspicious_metadata: count(r.suspicious_metadata), registry_exposure: count(r.registry_exposure), ecosystems: count(r.ecosystems),
    total_findings: count(r.total_findings), risk_score: score(r.risk_score), risk_label: oneOf(r.risk_label, SEVERITIES, 'info'),
    severity_counts: sevCounts(r.severity_counts),
    attack_surface: {
      dependency_confusion: count(sa.dependency_confusion), typosquatting: count(sa.typosquatting),
      suspicious_metadata: count(sa.suspicious_metadata), registry_exposure: count(sa.registry_exposure),
    },
    score_drivers: strArr(r.score_drivers),
  }
}

function candidate(v: unknown): LookalikeCandidate | null {
  if (!isRec(v)) return null
  const name = str(v.name)
  if (!name) return null
  return {
    name, mutation: str(v.mutation), similarity: unit(v.similarity), distance: count(v.distance), registered: bool(v.registered),
    registered_at: strN(v.registered_at), weekly_downloads: numN(v.weekly_downloads), maintainers: strArr(v.maintainers),
    install_scripts: strArr(v.install_scripts), suspicion_score: score(v.suspicion_score), severity: oneOf(v.severity, SEVERITIES, 'info'),
    drivers: strArr(v.drivers),
  }
}

function lookalike(v: unknown): LookalikeGroup | null {
  if (!isRec(v)) return null
  const ecosystem = oneOfN(v.ecosystem, ECOSYSTEM_IDS)
  const original = str(v.original)
  if (!ecosystem || !original) return null
  return {
    original, original_package_id: str(v.original_package_id), ecosystem, original_weekly_downloads: numN(v.original_weekly_downloads),
    candidates: dedupeBy(list(v.candidates, candidate), (c) => c.name),
  }
}

/** Keep the first item per key (React keys and URL params are built from names, so duplicates would collide). */
function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true })
}

function options(v: unknown): ScanOptions {
  const r = recOf(v)
  const ro = recOf(r.registry_overrides)
  const overrides: Record<string, string> = {}
  for (const k of Object.keys(ro)) if (typeof ro[k] === 'string') overrides[k] = ro[k] as string
  return {
    checks: strArr(r.checks), ecosystem: oneOfN(r.ecosystem, ECOSYSTEM_IDS), live: bool(r.live),
    max_edit_distance: num(r.max_edit_distance, 2), rate_limit_rps: num(r.rate_limit_rps, 5), timeout_s: num(r.timeout_s, 10),
    cache_ttl_s: num(r.cache_ttl_s, 3600), internal_scopes: strArr(r.internal_scopes), registry_overrides: overrides,
  }
}

/** Throws a plain Error when the payload is not an object at all (caller maps that to a generic error state). */
export function normalizeScan(raw: unknown): ScanResult {
  if (!isRec(raw)) throw new TypeError('Scan payload is not an object')
  const id = str(raw.id)
  if (!id) throw new TypeError('Scan payload has no id')
  const dropped = { n: 0 }
  const uniqP = uniquer()
  const uniqF = uniquer()
  const packages = list(raw.packages, (p) => pkg(p, uniqP, dropped))
  const findings = list(raw.findings, (f) => finding(f, uniqF, dropped))
  const pkgIds = new Set(packages.map((p) => p.id))
  // package.finding_ids only matter when they resolve
  const findingIds = new Set(findings.map((f) => f.id))
  packages.forEach((p) => { p.finding_ids = p.finding_ids.filter((x) => findingIds.has(x)) })
  packages.forEach((p) => { p.dependencies = p.dependencies.filter((d) => pkgIds.has(d)) })
  const edges = list<Edge>(raw.edges, (e) => {
    if (!isRec(e) || typeof e.source !== 'string' || typeof e.target !== 'string') return null
    if (!pkgIds.has(e.source) || !pkgIds.has(e.target)) return null
    return { source: e.source, target: e.target, kind: e.kind === 'dev' ? 'dev' : 'depends' }
  })
  const src = recOf(raw.source)
  const warnings = strArr(raw.warnings)
  if (dropped.n) warnings.push(`${dropped.n} malformed record${dropped.n === 1 ? ' was' : 's were'} skipped.`)
  const mode = raw.mode === 'live' || raw.mode === 'demo' ? raw.mode : 'offline'
  return {
    id, project: str(raw.project, 'Untitled project') || 'Untitled project', created_at: ts(raw.created_at), duration_ms: count(raw.duration_ms),
    mode, version: str(raw.version), source: { kind: src.kind === 'demo' || src.kind === 'folder' ? src.kind : 'file', files: strArr(src.files) },
    options: options(raw.options), summary: summary(raw.summary),
    ecosystems: dedupeBy(list(raw.ecosystems, ecoSummary), (e) => e.ecosystem), packages, findings, edges,
    lookalikes: dedupeBy(list(raw.lookalikes, lookalike), (g) => `${g.ecosystem}:${g.original}`), warnings,
  }
}

export function normalizeHistory(raw: unknown): ScanHistoryEntry[] {
  const uniq = uniquer()
  return list(raw, (v) => {
    if (!isRec(v)) return null
    const id = str(v.id)
    if (!id) return null
    return {
      id: uniq(id), project: str(v.project, 'Untitled project'), created_at: ts(v.created_at), mode: str(v.mode, 'offline'),
      dependencies: count(v.dependencies), findings: count(v.findings), risk_score: score(v.risk_score),
      risk_label: oneOf(v.risk_label, SEVERITIES, 'info'),
      ecosystems: Array.isArray(v.ecosystems) ? v.ecosystems.filter((e): e is Ecosystem => (ECOSYSTEM_IDS as readonly unknown[]).includes(e)) : [],
    }
  })
}

const STAGE_STATES: ProgressStage['state'][] = ['pending', 'active', 'done', 'error', 'skipped']
const JOB_STATUSES: JobStatus['status'][] = ['queued', 'running', 'done', 'error']
const JOB_ERRORS = ['unsupported_lockfile', 'registry_unavailable', 'parse_error', 'internal'] as const

export function normalizeJob(raw: unknown): JobStatus {
  if (!isRec(raw)) throw new TypeError('Job payload is not an object')
  return {
    job_id: str(raw.job_id),
    status: oneOf(raw.status, JOB_STATUSES, 'running'),
    progress: unit(raw.progress),
    stages: list(raw.stages, (s, i) => (isRec(s) ? { id: str(s.id, `stage-${i}`), label: str(s.label), state: oneOf(s.state, STAGE_STATES, 'pending'), detail: str(s.detail) } : null)),
    scan_id: strN(raw.scan_id), error: strN(raw.error), error_code: oneOfN(raw.error_code, JOB_ERRORS),
  }
}

export function normalizeDetect(raw: unknown): DetectResult[] {
  return list(raw, (v) => {
    if (!isRec(v)) return null
    const ecosystem = oneOfN(v.ecosystem, ECOSYSTEM_IDS)
    return {
      filename: str(v.filename), ecosystem, supported: bool(v.supported) && !!ecosystem, kind: strN(v.kind),
      dependency_count: numN(v.dependency_count), error: strN(v.error),
    }
  })
}

export function normalizeHealth(raw: unknown): Health {
  const r = recOf(raw)
  const regs = recOf(r.registries)
  const registries = {} as Health['registries']
  for (const e of ECOSYSTEM_IDS) {
    const x = recOf(regs[e])
    registries[e] = { url: str(x.url), state: oneOf(x.state, ['unchecked', 'ok', 'unreachable'] as const, 'unchecked') }
  }
  return { status: 'ok', version: str(r.version), mode: r.mode === 'live' ? 'live' : 'offline', registries }
}

// ---------------------------------------------------------------------------------------------------------------
// URLs

/**
 * Returns the URL only when it is an absolute http(s) URL (no credentials), else null. Use for every href/src that
 * is built from scan data (repository_url etc.): blocks `javascript:`, `data:`, `vbscript:`, `blob:`, `file:`.
 */
export function safeHttpUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s || s.length > 2048) return null
  // strip git+ / .git decorations that registries commonly use
  const cleaned = s.replace(/^git\+/i, '')
  try {
    const u = new URL(cleaned)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null
    return u.href
  } catch { return null }
}

/** File name that is safe to hand to `<a download>` / a Content-Disposition round-trip. */
export function safeFilename(v: unknown, fallback: string): string {
  const s = typeof v === 'string' ? v : ''
  const cleaned = s.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-').replace(/^[.\s-]+/, '').slice(0, 120)
  return cleaned || fallback
}

/** Enum guard for URL params: returns the value only if it is one of `allowed`. */
export function pickParam<T extends string>(v: string | null | undefined, allowed: readonly T[]): T | null {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null
}
