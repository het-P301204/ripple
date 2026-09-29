import { useMemo } from 'react'
import { useRipple } from '@/lib/store'
import { SEVERITY_RANK } from '@/lib/meta'
import type { Category, Ecosystem, Finding, Package, ScanResult, Severity } from '@/types/scan'

/**
 * Main data hook. Returns the whole store:
 * `scan` (ScanResult | null), `history`, `health`, `offline`, `job` (live JobStatus),
 * `loadDemo()`, `loadScan(id)`, `startScan(files, options)`, `exportScan(format)`, …
 * See src/lib/store.tsx for the full shape.
 */
export const useScan = useRipple

export interface ScanIndex {
  packageById: Map<string, Package>
  packageByName: Map<string, Package[]>
  findingById: Map<string, Finding>
  findingsByPackage: Map<string, Finding[]>
  /** findings sorted by risk_score desc, then severity */
  sortedFindings: Finding[]
}

function buildIndex(scan: ScanResult | null): ScanIndex {
  const packageById = new Map<string, Package>()
  const packageByName = new Map<string, Package[]>()
  const findingById = new Map<string, Finding>()
  const findingsByPackage = new Map<string, Finding[]>()
  scan?.packages.forEach((p) => {
    packageById.set(p.id, p)
    const l = packageByName.get(p.name)
    if (l) l.push(p)
    else packageByName.set(p.name, [p])
  })
  scan?.findings.forEach((f) => {
    findingById.set(f.id, f)
    const l = findingsByPackage.get(f.package_id)
    if (l) l.push(f)
    else findingsByPackage.set(f.package_id, [f])
  })
  const sortedFindings = [...(scan?.findings ?? [])].sort(
    (a, b) => b.risk_score - a.risk_score || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  )
  return { packageById, packageByName, findingById, findingsByPackage, sortedFindings }
}

/** One index per scan object, shared by every component that asks (the per-hook useMemo rebuilt it once per consumer). */
const indexCache = new WeakMap<ScanResult, ScanIndex>()
const EMPTY_INDEX = buildIndex(null)

/** Memoised lookup tables for the current scan. */
export function useScanIndex(override?: ScanResult | null): ScanIndex {
  const current = useRipple().scan
  const scan: ScanResult | null = override === undefined ? current : override
  return useMemo(() => {
    if (!scan) return EMPTY_INDEX
    let idx = indexCache.get(scan)
    if (!idx) { idx = buildIndex(scan); indexCache.set(scan, idx) }
    return idx
  }, [scan])
}

export interface FindingFilter {
  severity?: Severity | Severity[] | null
  category?: Category | null
  ecosystem?: Ecosystem | null
  query?: string
  packageId?: string | null
}

/** Filter + sort findings (risk desc). Pure selector; pass URL-derived filters. */
export function useFindings(filter: FindingFilter = {}): Finding[] {
  const { sortedFindings } = useScanIndex()
  const { severity, category, ecosystem, query, packageId } = filter
  return useMemo(() => {
    const sev = severity ? (Array.isArray(severity) ? severity : [severity]) : null
    const q = query?.trim().toLowerCase()
    return sortedFindings.filter(
      (f) =>
        (!sev || sev.includes(f.severity)) &&
        (!category || f.category === category) &&
        (!ecosystem || f.ecosystem === ecosystem) &&
        (!packageId || f.package_id === packageId) &&
        (!q || `${f.package} ${f.title} ${f.summary} ${f.attack_vector}`.toLowerCase().includes(q)),
    )
  }, [sortedFindings, severity, category, ecosystem, query, packageId])
}

/** Single finding by id (from route param). */
export function useFinding(id: string | undefined): Finding | undefined {
  const { findingById } = useScanIndex()
  return id ? findingById.get(id) : undefined
}

/** Package lookup by id, or by name (first match; pass ecosystem to disambiguate). */
export function usePackage(idOrName: string | undefined, ecosystem?: Ecosystem): Package | undefined {
  const { packageById, packageByName } = useScanIndex()
  if (!idOrName) return undefined
  return packageById.get(idOrName) ?? packageByName.get(idOrName)?.find((p) => !ecosystem || p.ecosystem === ecosystem)
}
