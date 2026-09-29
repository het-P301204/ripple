import type { Ecosystem, ScanResult, Severity } from '@/types/scan'
import { ECOSYSTEMS, SEVERITY_RANK } from '@/lib/meta'
import { shapePath } from './nodeShape'
import type { GEdge, GNode, GraphModel, GraphView, ModelEdge, ViewOptions } from './types'

/** Below this many hidden packages under one parent, clustering is pointless: show them individually. */
const MIN_CLUSTER = 2

/** Build the immutable graph model (all packages, all relationships) from a scan. */
export function buildModel(scan: ScanResult): GraphModel {
  const nodes = new Map<string, GNode>()
  const out = new Map<string, string[]>()
  const inn = new Map<string, string[]>()
  const edges: ModelEdge[] = []
  const seen = new Set<string>()

  for (const p of scan.packages) {
    out.set(p.id, [])
    inn.set(p.id, [])
  }
  const add = (s: string, t: string, dev: boolean) => {
    if (s === t || !out.has(s) || !out.has(t)) return
    const key = `${s}>${t}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ key, source: s, target: t, dev })
    out.get(s)!.push(t)
    inn.get(t)!.push(s)
  }
  for (const e of scan.edges) add(e.source, e.target, e.kind === 'dev')
  for (const p of scan.packages) for (const d of p.dependencies) add(p.id, d, false)

  let maxDependents = 1
  for (const p of scan.packages) maxDependents = Math.max(maxDependents, p.dependents_count, inn.get(p.id)?.length ?? 0)

  const ecoCounts: Record<Ecosystem, number> = { npm: 0, pypi: 0, go: 0, rust: 0 }
  for (const p of scan.packages) {
    ecoCounts[p.ecosystem] += 1
    const dependents = Math.max(p.dependents_count, inn.get(p.id)?.length ?? 0)
    const risk = Math.max(0, Math.min(100, p.risk_score))
    const flagged = p.status === 'flagged' || p.finding_ids.length > 0 || (p.severity !== 'info' && p.risk_score > 0)
    const r = Math.min(13.5, 4.4 + 3 * Math.sqrt(dependents / maxDependents) + 5.2 * (risk / 100) + (p.direct ? 0.9 : 0))
    nodes.set(p.id, {
      id: p.id, kind: 'pkg', name: p.name, version: p.version, eco: p.ecosystem, severity: p.severity, risk: p.risk_score,
      r, direct: p.direct, dev: p.dev, internal: p.internal_looking, flagged, depth: p.depth,
      deps: p.dependencies.length, dependents, shape: shapePath(p.ecosystem, r), pkg: p,
    })
  }
  // draw order: low risk first, so the riskiest nodes paint on top (DOM order is stable across views)
  const order = scan.packages.map((p, i) => ({ id: p.id, r: p.risk_score, i })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.id)
  return {
    nodes, order, edges, out, inn, ecoCounts,
    ecos: ECOSYSTEMS.filter((e) => ecoCounts[e] > 0), maxDependents,
  }
}

/** Every package reachable upstream (dependents, dependents of dependents…) of `seeds`, restricted by `allow`. */
export function ancestorsOf(model: GraphModel, seeds: Iterable<string>, allow: (id: string) => boolean = () => true): Set<string> {
  const seen = new Set<string>()
  const stack: string[] = []
  for (const s of seeds) stack.push(s)
  while (stack.length) {
    const id = stack.pop()!
    for (const p of model.inn.get(id) ?? []) {
      if (seen.has(p) || !allow(p)) continue
      seen.add(p)
      stack.push(p)
    }
  }
  return seen
}

/** Breadth-first neighbourhood (dependencies and dependents) within `depth` hops. Includes the origin at 0. */
export function neighbourhood(model: GraphModel, origin: string, depth: number): Map<string, number> {
  const dist = new Map<string, number>()
  if (!model.nodes.has(origin)) return dist
  dist.set(origin, 0)
  let frontier = [origin]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const list of [model.out.get(id), model.inn.get(id)]) {
        for (const n of list ?? []) {
          if (dist.has(n)) continue
          dist.set(n, d)
          next.push(n)
        }
      }
    }
    frontier = next
  }
  return dist
}

function worstOf(ns: GNode[]): Severity {
  let best: Severity = 'info'
  for (const n of ns) if (SEVERITY_RANK[n.severity] > SEVERITY_RANK[best]) best = n.severity
  return best
}

/**
 * Derive what is on screen.
 *
 *  - `focused` (default): direct dependencies + every flagged package + the paths that lead to them.
 *  - `direct`: direct dependencies only.
 *  - `full`: everything.
 *
 * Whatever a mode leaves out is folded into cluster nodes (one per visible parent, or per ecosystem when a package has no
 * visible ancestor). Clusters expand on demand. An active severity filter hides instead of clustering: matches are shown
 * with their ancestors as dim context.
 */
export function computeView(model: GraphModel, o: ViewOptions): GraphView {
  const ecoOk = (id: string) => o.ecosystems.size === 0 || o.ecosystems.has(model.nodes.get(id)!.eco)
  const eligible = model.order.filter(ecoOk)
  const eligibleSet = new Set(eligible)
  const V = new Set<string>()
  const ctx = new Set<string>()
  const sevActive = o.severities.size > 0
  let matchCount = 0

  if (sevActive) {
    const core = eligible.filter((id) => o.severities.has(model.nodes.get(id)!.severity))
    matchCount = core.length
    core.forEach((id) => V.add(id))
    ancestorsOf(model, core, (id) => eligibleSet.has(id)).forEach((id) => {
      if (!V.has(id)) ctx.add(id)
      V.add(id)
    })
    o.reveal.forEach((id) => {
      if (!model.nodes.has(id) || V.has(id)) return
      V.add(id)
      ctx.add(id)
    })
  } else {
    for (const id of eligible) {
      const n = model.nodes.get(id)!
      if (o.mode === 'full' || n.direct || (o.mode === 'focused' && n.flagged)) V.add(id)
    }
    if (o.mode === 'focused') {
      const flagged = eligible.filter((id) => model.nodes.get(id)!.flagged)
      ancestorsOf(model, flagged, (id) => eligibleSet.has(id)).forEach((id) => V.add(id))
    }
    o.reveal.forEach((id) => { if (model.nodes.has(id)) V.add(id) })
    matchCount = V.size
  }

  // ---- clustering of everything hidden -------------------------------------------------------
  type Group = { id: string; anchor: string | null; eco: Ecosystem; members: string[] }
  let groups: Group[] = []
  if (!sevActive && V.size < eligible.length) {
    for (let iter = 0; iter < 12; iter++) {
      const hidden = eligible.filter((id) => !V.has(id)).sort((a, b) => model.nodes.get(a)!.depth - model.nodes.get(b)!.depth)
      const anchorOf = new Map<string, string | null>()
      const resolve = (id: string, guard: Set<string>): string | null => {
        if (anchorOf.has(id)) return anchorOf.get(id) ?? null
        if (guard.has(id)) return null
        guard.add(id)
        const ps = (model.inn.get(id) ?? []).filter((p) => eligibleSet.has(p)).sort((a, b) => model.nodes.get(a)!.depth - model.nodes.get(b)!.depth)
        let res: string | null = ps.find((p) => V.has(p)) ?? null
        if (res == null) for (const p of ps) { const r = resolve(p, guard); if (r) { res = r; break } }
        anchorOf.set(id, res)
        return res
      }
      const byId = new Map<string, Group>()
      for (const id of hidden) {
        const a = resolve(id, new Set())
        const eco = model.nodes.get(id)!.eco
        const gid = `c:${a ?? `eco:${eco}`}`
        let g = byId.get(gid)
        if (!g) { g = { id: gid, anchor: a, eco, members: [] }; byId.set(gid, g) }
        g.members.push(id)
      }
      groups = [...byId.values()]
      let changed = false
      for (const g of groups) {
        if (g.members.length < MIN_CLUSTER || o.expanded.has(g.id)) {
          for (const m of g.members) V.add(m)
          changed = true
        }
      }
      if (!changed) break
    }
    // groups that were promoted are no longer clusters
    groups = groups.filter((g) => g.members.length >= MIN_CLUSTER && !o.expanded.has(g.id) && g.members.every((m) => !V.has(m)))
  }

  // ---- assemble ----------------------------------------------------------------------------
  const nodes: GNode[] = []
  for (const id of model.order) if (V.has(id)) nodes.push(model.nodes.get(id)!)
  const clusterNodes: GNode[] = groups.map((g) => {
    const members = g.members.map((m) => model.nodes.get(m)!)
    const count = members.length
    const r = Math.min(17, 7.5 + 2.1 * Math.sqrt(count))
    return {
      id: g.id, kind: 'cluster' as const, name: `${count} packages`, version: '', eco: g.eco, severity: worstOf(members),
      risk: Math.max(0, ...members.map((m) => m.risk)), r, direct: false, dev: false, internal: false, flagged: false,
      depth: (model.nodes.get(g.anchor ?? '')?.depth ?? 0) + 1, deps: count, dependents: 0,
      shape: shapePath('cluster', r), members: g.members, anchor: g.anchor,
    }
  })
  nodes.push(...clusterNodes)

  const edges: GEdge[] = []
  for (const e of model.edges) if (V.has(e.source) && V.has(e.target)) edges.push({ key: e.key, source: e.source, target: e.target, kind: e.dev ? 'dev' : 'depends' })
  for (const c of clusterNodes) if (c.anchor && V.has(c.anchor)) edges.push({ key: `${c.anchor}>${c.id}`, source: c.anchor, target: c.id, kind: 'cluster' })

  const collapsedCount = clusterNodes.reduce((a, c) => a + (c.members?.length ?? 0), 0)
  return { nodes, edges, ctx, matchCount, packageCount: nodes.length - clusterNodes.length, collapsedCount, clusterCount: clusterNodes.length, sevActive }
}

/** Total nodes a full expansion would show — used to warn about heavy views. */
export function fullSize(model: GraphModel) { return model.order.length }
