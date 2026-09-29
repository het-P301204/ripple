import type { Category, Ecosystem, Finding, ScanResult, Severity } from '@/types/scan'
import { ECOSYSTEMS, SEVERITY_RANK } from '@/lib/meta'

export const CATEGORIES: Category[] = ['dependency_confusion', 'typosquatting', 'suspicious_metadata', 'registry_exposure']

export interface SurfaceData {
  ecos: Ecosystem[]
  /** findings per category x ecosystem */
  cells: Record<Category, Record<Ecosystem, Finding[]>>
  catTotals: Record<Category, number>
  ecoTotals: Record<Ecosystem, number>
  catWorst: Record<Category, Severity | null>
  cellMax: number
  total: number
}

const emptyByEco = (): Record<Ecosystem, Finding[]> => ({ npm: [], pypi: [], go: [], rust: [] })

/** Derive the category x ecosystem exposure grid from findings (what is drawn is exactly what can be opened). */
export function buildSurface(scan: ScanResult): SurfaceData {
  const cells = Object.fromEntries(CATEGORIES.map((c) => [c, emptyByEco()])) as SurfaceData['cells']
  for (const f of scan.findings) cells[f.category]?.[f.ecosystem]?.push(f)
  const present = new Set<Ecosystem>([...scan.ecosystems.map((e) => e.ecosystem), ...scan.findings.map((f) => f.ecosystem)])
  const ecos = ECOSYSTEMS.filter((e) => present.has(e))
  const catTotals = {} as Record<Category, number>
  const catWorst = {} as Record<Category, Severity | null>
  const ecoTotals: Record<Ecosystem, number> = { npm: 0, pypi: 0, go: 0, rust: 0 }
  let cellMax = 0
  let total = 0
  for (const c of CATEGORIES) {
    let n = 0
    let worst: Severity | null = null
    for (const e of ecos) {
      const fs = cells[c][e]
      n += fs.length
      ecoTotals[e] += fs.length
      cellMax = Math.max(cellMax, fs.length)
      for (const f of fs) if (!worst || SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst]) worst = f.severity
    }
    catTotals[c] = n
    catWorst[c] = worst
    total += n
  }
  return { ecos, cells, catTotals, ecoTotals, catWorst, cellMax, total }
}

/** Findings ordered for the "top exposed" list: risk first, then severity. */
export function topFindings(scan: ScanResult, category?: Category | null): Finding[] {
  return scan.findings
    .filter((f) => !category || f.category === category)
    .sort((a, b) => b.risk_score - a.risk_score || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

/** Point on a horizontal-tangent cubic S-curve (P0=(x0,y0), P1=(mx,y0), P2=(mx,y1), P3=(x1,y1)) at parameter t. */
export function curvePoint(x0: number, y0: number, x1: number, y1: number, t: number) {
  const mx = (x0 + x1) / 2
  const u = 1 - t
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
  return { x: a * x0 + b * mx + c * mx + d * x1, y: (a + b) * y0 + (c + d) * y1 }
}

export const linkPath = (x0: number, y0: number, x1: number, y1: number) => {
  const mx = (x0 + x1) / 2
  return `M${x0.toFixed(1)},${y0.toFixed(1)}C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
}
