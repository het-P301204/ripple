import type { Category, Ecosystem, Severity } from '@/types/scan'

/** Severity ordering, highest first. */
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 }

export const SEVERITY_META: Record<Severity, { label: string; rgb: string; bg: string; border: string; text: string }> = {
  critical: { label: 'Critical', rgb: 'var(--sev-critical)', bg: 'var(--sev-critical-bg)', border: 'var(--sev-critical-border)', text: 'var(--sev-critical-text)' },
  high: { label: 'High', rgb: 'var(--sev-high)', bg: 'var(--sev-high-bg)', border: 'var(--sev-high-border)', text: 'var(--sev-high-text)' },
  medium: { label: 'Medium', rgb: 'var(--sev-medium)', bg: 'var(--sev-medium-bg)', border: 'var(--sev-medium-border)', text: 'var(--sev-medium-text)' },
  low: { label: 'Low', rgb: 'var(--sev-low)', bg: 'var(--sev-low-bg)', border: 'var(--sev-low-border)', text: 'var(--sev-low-text)' },
  info: { label: 'Info', rgb: 'var(--sev-info)', bg: 'var(--sev-info-bg)', border: 'var(--sev-info-border)', text: 'var(--sev-info-text)' },
}

/** CSS colour string for a severity, with optional alpha. */
export const sevColor = (s: Severity, alpha = 1) => `rgb(${SEVERITY_META[s].rgb} / ${alpha})`

export const ECOSYSTEM_META: Record<Ecosystem, { label: string; registry: string; color: string; lockfiles: string[] }> = {
  npm: { label: 'npm', registry: 'registry.npmjs.org', color: '#F0506E', lockfiles: ['package-lock.json', 'yarn.lock'] },
  pypi: { label: 'PyPI', registry: 'pypi.org', color: '#60A5FA', lockfiles: ['requirements.txt', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock', 'uv.lock'] },
  go: { label: 'Go', registry: 'proxy.golang.org', color: '#5EEAD4', lockfiles: ['go.mod', 'go.sum'] },
  rust: { label: 'Rust', registry: 'crates.io', color: '#FDBA74', lockfiles: ['Cargo.lock'] },
}
export const ECOSYSTEMS: Ecosystem[] = ['npm', 'pypi', 'go', 'rust']

export const CATEGORY_META: Record<Category, { label: string; short: string; blurb: string; route: string }> = {
  dependency_confusion: {
    label: 'Dependency confusion',
    short: 'Confusion',
    blurb: 'Internal-looking names that a public registry could shadow.',
    route: '/findings?category=dependency_confusion',
  },
  typosquatting: {
    label: 'Typosquatting',
    short: 'Typosquats',
    blurb: 'Names one keystroke away from popular packages.',
    route: '/findings?category=typosquatting',
  },
  suspicious_metadata: {
    label: 'Suspicious metadata',
    short: 'Metadata',
    blurb: 'Install scripts, fresh registrations, maintainer churn.',
    route: '/findings?category=suspicious_metadata',
  },
  registry_exposure: {
    label: 'Registry exposure',
    short: 'Exposure',
    blurb: 'Plain-http registries, missing integrity hashes, VCS sources.',
    route: '/findings?category=registry_exposure',
  },
}

/** Lockfile filename -> ecosystem (client-side fallback when /api/detect is unreachable). */
export function detectEcosystemFromName(filename: string): { ecosystem: Ecosystem | null; kind: string | null } {
  const base = filename.split(/[\\/]/).pop()!.toLowerCase()
  const table: Array<[RegExp, Ecosystem, string]> = [
    [/^package-lock\.json$/, 'npm', 'package-lock.json'],
    [/^npm-shrinkwrap\.json$/, 'npm', 'npm-shrinkwrap.json'],
    [/^yarn\.lock$/, 'npm', 'yarn.lock'],
    [/^requirements[\w.-]*\.txt$/, 'pypi', 'requirements.txt'],
    [/^pipfile\.lock$/, 'pypi', 'Pipfile.lock'],
    [/^pyproject\.toml$/, 'pypi', 'pyproject.toml'],
    [/^poetry\.lock$/, 'pypi', 'poetry.lock'],
    [/^uv\.lock$/, 'pypi', 'uv.lock'],
    [/^go\.mod$/, 'go', 'go.mod'],
    [/^go\.sum$/, 'go', 'go.sum'],
    [/^cargo\.lock$/, 'rust', 'Cargo.lock'],
  ]
  for (const [re, eco, kind] of table) if (re.test(base)) return { ecosystem: eco, kind }
  return { ecosystem: null, kind: null }
}

export const KNOWN_LOCKFILE_NAMES = [
  'package-lock.json', 'yarn.lock', 'requirements.txt', 'Pipfile.lock', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'go.mod', 'go.sum', 'Cargo.lock',
]
