// Mirror of ripple/models/*.py — the API contract. Keep in sync.

export type Ecosystem = 'npm' | 'pypi' | 'go' | 'rust'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type Category = 'dependency_confusion' | 'typosquatting' | 'suspicious_metadata' | 'registry_exposure'
export type Resolution = 'exact' | 'hashed' | 'range' | 'vcs' | 'local' | 'unknown'
export type PublicStatus = 'registered' | 'not_found' | 'unknown' | 'error'
export type PackageStatus = 'clean' | 'flagged' | 'unverified'

export interface InstallScripts {
  preinstall: string | null
  install: string | null
  postinstall: string | null
  prepare: string | null
  build_script: boolean
}

export interface PackageMetadata {
  registered_at: string | null
  latest_version: string | null
  latest_published_at: string | null
  versions_count: number | null
  weekly_downloads: number | null
  maintainers: string[]
  maintainer_changes: number
  install_scripts: InstallScripts
  network_indicators: string[]
  repository_url: string | null
  description: string | null
  deprecated: boolean
  version_gap: number | null
  age_days: number | null
}

export interface Package {
  id: string
  name: string
  version: string
  spec: string | null
  ecosystem: Ecosystem
  registry: string
  registry_source: string | null
  resolution: Resolution
  integrity: string | null
  dev: boolean
  direct: boolean
  depth: number
  dependencies: string[]
  dependents_count: number
  source_file: string
  public_status: PublicStatus
  internal_looking: boolean
  internal_reasons: string[]
  metadata: PackageMetadata | null
  risk_score: number
  severity: Severity
  status: PackageStatus
  finding_ids: string[]
  confusion: boolean
  typosquat: boolean
  metadata_flag: boolean
  registry_exposure: boolean
}

export interface EvidenceItem { label: string; value: string; mono: boolean }
export interface RiskDriver { label: string; points: number; detail: string }
export interface Remediation { title: string; detail: string }

export interface Finding {
  id: string
  package_id: string
  package: string
  version: string
  ecosystem: Ecosystem
  category: Category
  title: string
  severity: Severity
  risk_score: number
  confidence: number // 0..1
  summary: string
  why_flagged: string
  attack_vector: string
  evidence: EvidenceItem[]
  drivers: RiskDriver[]
  remediation: Remediation[]
  resolution_type: string
  dependency_source: string
  registry: string
  detected_at: string
  public_status: string
  related_package: string | null
  rule_id: string
}

export interface SeverityCounts { critical: number; high: number; medium: number; low: number; info: number }
export interface AttackSurface {
  dependency_confusion: number
  typosquatting: number
  suspicious_metadata: number
  registry_exposure: number
}

export interface EcosystemSummary {
  ecosystem: Ecosystem
  lockfiles: string[]
  registry: string
  total: number
  direct: number
  public: number
  internal_looking: number
  confusion: number
  typosquat: number
  suspicious: number
  exposure: number
  registry_coverage: number
  risk_score: number
  severity_counts: SeverityCounts
}

export interface ScanSummary {
  total_dependencies: number
  direct_dependencies: number
  public_packages: number
  internal_looking: number
  confusion_candidates: number
  typosquat_candidates: number
  suspicious_metadata: number
  registry_exposure: number
  ecosystems: number
  total_findings: number
  risk_score: number
  risk_label: Severity
  severity_counts: SeverityCounts
  attack_surface: AttackSurface
  score_drivers: string[]
}

export interface Edge { source: string; target: string; kind: 'depends' | 'dev' }

export interface LookalikeCandidate {
  name: string
  mutation: string
  similarity: number
  distance: number
  registered: boolean
  registered_at: string | null
  weekly_downloads: number | null
  maintainers: string[]
  install_scripts: string[]
  suspicion_score: number
  severity: Severity
  drivers: string[]
}

export interface LookalikeGroup {
  original: string
  original_package_id: string
  ecosystem: Ecosystem
  original_weekly_downloads: number | null
  candidates: LookalikeCandidate[]
}

export interface ScanOptions {
  checks: string[]
  ecosystem: Ecosystem | null
  live: boolean
  max_edit_distance: number
  rate_limit_rps: number
  timeout_s: number
  cache_ttl_s: number
  internal_scopes: string[]
  registry_overrides: Record<string, string>
}

export interface ScanResult {
  id: string
  project: string
  created_at: string
  duration_ms: number
  mode: 'offline' | 'live' | 'demo'
  version: string
  source: { kind: 'demo' | 'file' | 'folder'; files: string[] }
  options: ScanOptions
  summary: ScanSummary
  ecosystems: EcosystemSummary[]
  packages: Package[]
  findings: Finding[]
  edges: Edge[]
  lookalikes: LookalikeGroup[]
  warnings: string[]
}

export interface ScanHistoryEntry {
  id: string
  project: string
  created_at: string
  mode: string
  dependencies: number
  findings: number
  risk_score: number
  risk_label: Severity
  ecosystems: Ecosystem[]
}

export interface ProgressStage {
  id: string
  label: string
  state: 'pending' | 'active' | 'done' | 'error' | 'skipped'
  detail: string
}

export interface JobStatus {
  job_id: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  stages: ProgressStage[]
  scan_id: string | null
  error: string | null
  error_code: 'unsupported_lockfile' | 'registry_unavailable' | 'parse_error' | 'internal' | null
}

export interface DetectResult {
  filename: string
  ecosystem: Ecosystem | null
  supported: boolean
  kind: string | null          // "package-lock.json", "requirements.txt", ...
  dependency_count: number | null
  error: string | null
}

export interface Health {
  status: 'ok'
  version: string
  mode: 'offline' | 'live'
  registries: Record<Ecosystem, { url: string; state: 'unchecked' | 'ok' | 'unreachable' }>
}

export interface Settings {
  registries: Record<Ecosystem, string>
  scanner: {
    max_edit_distance: number
    rate_limit_rps: number
    timeout_s: number
    cache_ttl_s: number
    thresholds: { critical: number; high: number; medium: number; low: number }
    internal_scopes: string[]
  }
  output: { default_format: 'rich' | 'json' | 'sarif' | 'csv' }
}
