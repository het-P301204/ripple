import type { Category, PublicStatus, Resolution } from '@/types/scan'

/** Heading used on the finding detail page. */
export const CATEGORY_TITLE: Record<Category, string> = {
  dependency_confusion: 'Dependency Confusion Candidate',
  typosquatting: 'Typosquatting Candidate',
  suspicious_metadata: 'Suspicious Package Metadata',
  registry_exposure: 'Registry Exposure',
}

/** Title-case label used for the category tabs. */
export const CATEGORY_TAB: Record<Category, string> = {
  dependency_confusion: 'Dependency Confusion',
  typosquatting: 'Typosquatting',
  suspicious_metadata: 'Suspicious Metadata',
  registry_exposure: 'Registry Exposure',
}

export const PUBLIC_STATUS_LABEL: Record<PublicStatus | string, string> = {
  registered: 'Registered publicly',
  not_found: 'Not registered publicly',
  unknown: 'Unknown',
  error: 'Lookup failed',
}

export const RESOLUTION_LABEL: Record<Resolution | string, string> = {
  exact: 'Exact pin',
  hashed: 'Pinned with integrity hash',
  range: 'Version range',
  vcs: 'VCS reference',
  local: 'Local path',
  unknown: 'Unknown',
}

export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`
