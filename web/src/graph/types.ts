import type { Ecosystem, Package, Severity } from '@/types/scan'

export type ViewMode = 'direct' | 'focused' | 'full'
export type NodeVis = 'normal' | 'dim' | 'selected' | 'related' | 'ctx'

/** A renderable graph node: a package, or a collapsed cluster of low-risk transitive packages. */
export interface GNode {
  id: string
  kind: 'pkg' | 'cluster'
  name: string
  version: string
  eco: Ecosystem
  severity: Severity
  risk: number
  r: number
  direct: boolean
  dev: boolean
  internal: boolean
  flagged: boolean
  depth: number
  /** direct dependency count */
  deps: number
  dependents: number
  shape: string
  pkg?: Package
  /** cluster only */
  members?: string[]
  anchor?: string | null
}

export interface ModelEdge { key: string; source: string; target: string; dev: boolean }
export interface GEdge { key: string; source: string; target: string; kind: 'depends' | 'dev' | 'cluster' }

export interface GraphModel {
  nodes: Map<string, GNode>
  order: string[]
  edges: ModelEdge[]
  out: Map<string, string[]>
  inn: Map<string, string[]>
  ecoCounts: Record<Ecosystem, number>
  ecos: Ecosystem[]
  maxDependents: number
}

export interface GraphView {
  nodes: GNode[]
  edges: GEdge[]
  /** context-only nodes (ancestors of filter matches) */
  ctx: Set<string>
  matchCount: number
  packageCount: number
  collapsedCount: number
  clusterCount: number
  sevActive: boolean
}

export interface ViewOptions {
  mode: ViewMode
  severities: Set<Severity>
  ecosystems: Set<Ecosystem>
  /** expanded cluster ids */
  expanded: Set<string>
  /** ids that must be visible (selection neighbourhood, search targets) */
  reveal: Set<string>
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Pt { x: number; y: number }
