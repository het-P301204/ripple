import {
  forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from 'd3-force'
import type { Ecosystem } from '@/types/scan'
import type { Bounds, GEdge, GraphModel, GraphView, Pt } from './types'

export interface SimNode extends SimulationNodeDatum {
  id: string
  r: number
  eco: Ecosystem
  cluster: boolean
  x: number
  y: number
}
interface SimLink extends SimulationLinkDatum<SimNode> { cluster: boolean; ra: number; rb: number }

export interface LayoutCallbacks {
  /** positions changed — write transforms (no React state!) */
  onFrame: () => void
  /** simulation cooled and is now frozen */
  onSettle: () => void
}

/** Above this many nodes the layout is computed off-screen (chunked over frames) and then tweened in. */
export const STATIC_LAYOUT_THRESHOLD = 300

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

/** Deterministic hash -> [0,1). */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13
  return ((h >>> 0) % 100000) / 100000
}

/** Seeded LCG for d3's jiggle so layouts are reproducible. */
function lcg(seed = 1) {
  let s = seed >>> 0
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296 }
}

/**
 * One anchor per ecosystem, arranged on an ellipse so each ecosystem forms its own island.
 * Stable across views (depends on the full model only), so filters never reshuffle the map.
 */
export function ecosystemAnchors(model: GraphModel): Map<Ecosystem, Pt> {
  const ecos = model.ecos
  const n = ecos.length
  const total = Math.max(1, model.order.length)
  const R = n <= 1 ? 0 : 46 + 17 * Math.sqrt(total)
  const out = new Map<Ecosystem, Pt>()
  ecos.forEach((e, i) => {
    if (n === 1) return out.set(e, { x: 0, y: 0 })
    const a = -Math.PI / 2 + Math.PI / n + (i * 2 * Math.PI) / n
    out.set(e, { x: Math.cos(a) * R * 1.22, y: Math.sin(a) * R * 0.92 })
  })
  return out
}

/**
 * d3-force wrapped so that
 *  - it never runs on React's render path: ticks are batched per animation frame and only ever write to DOM
 *    transforms through `onFrame`;
 *  - it settles and freezes (no idle ticking);
 *  - very large graphs (>300 nodes) are pre-computed across frames without painting, then tweened in as a static layout;
 *  - it is deterministic (seeded jiggle, hash-based spawn jitter) and incremental (nodes that stay keep their place).
 */
export class GraphLayout {
  /** persistent positions, including nodes that have left the view (their last place) */
  readonly pos = new Map<string, SimNode>()
  reduced = false
  private active: SimNode[] = []
  private activeIds = new Set<string>()
  private anchors = new Map<Ecosystem, Pt>()
  private memberOf = new Map<string, string>()
  private sim: Simulation<SimNode, undefined>
  private links = forceLink<SimNode, SimLink>().id((d) => d.id)
  private raf = 0
  private token = 0
  private first = true
  private settled = true

  constructor(private cb: LayoutCallbacks) {
    this.sim = forceSimulation<SimNode>()
      .randomSource(lcg(7))
      .alphaDecay(1 - Math.pow(0.001, 1 / 210))
      .velocityDecay(0.42)
      .force('link', this.links.distance((l) => 22 + (l.ra + l.rb) * 0.9 + (l.cluster ? 6 : 0)).strength((l) => (l.cluster ? 0.7 : 0.5)))
      .force('charge', forceManyBody<SimNode>().strength((d) => (d.cluster ? -70 : -34)).distanceMax(230).theta(0.9))
      .force('collide', forceCollide<SimNode>().radius((d) => d.r + 3.5).strength(0.85).iterations(1))
      .force('x', forceX<SimNode>((d) => this.anchors.get(d.eco)?.x ?? 0).strength(0.07))
      .force('y', forceY<SimNode>((d) => this.anchors.get(d.eco)?.y ?? 0).strength(0.09))
      .stop()
  }

  get isSettled() { return this.settled }

  setAnchors(a: Map<Ecosystem, Pt>) { this.anchors = a }

  /** Rough final extent, before the simulation has spread out (used to frame the intro). */
  predictBounds(view: GraphView): Bounds {
    const per = new Map<Ecosystem, number>()
    for (const n of view.nodes) per.set(n.eco, (per.get(n.eco) ?? 0) + 1)
    let b: Bounds | null = null
    per.forEach((count, eco) => {
      const a = this.anchors.get(eco) ?? { x: 0, y: 0 }
      const rad = 22 + 9.5 * Math.sqrt(count)
      const bb = { minX: a.x - rad * 1.15, maxX: a.x + rad * 1.15, minY: a.y - rad, maxY: a.y + rad }
      b = b ? { minX: Math.min(b.minX, bb.minX), maxX: Math.max(b.maxX, bb.maxX), minY: Math.min(b.minY, bb.minY), maxY: Math.max(b.maxY, bb.maxY) } : bb
    })
    return b ?? { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  }

  bounds(): Bounds {
    if (!this.active.length) return { minX: -100, maxX: 100, minY: -100, maxY: 100 }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of this.active) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue
      minX = Math.min(minX, n.x - n.r); maxX = Math.max(maxX, n.x + n.r)
      minY = Math.min(minY, n.y - n.r); maxY = Math.max(maxY, n.y + n.r + 12)
    }
    return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: -100, maxX: 100, minY: -100, maxY: 100 }
  }

  activeNodes(): readonly SimNode[] { return this.active }

  stop() {
    this.token++
    cancelAnimationFrame(this.raf)
    this.sim.stop()
  }

  /** Swap the visible graph. Nodes that stay keep their positions; newcomers spawn next to what they belong to. */
  setView(view: GraphView) {
    this.stop()
    const prevActive = this.activeIds
    const nextIds = new Set(view.nodes.map((n) => n.id))

    // adjacency within the incoming view (for spawn placement)
    const adj = new Map<string, string[]>()
    const link = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b) }
    for (const e of view.edges) { link(e.source, e.target); link(e.target, e.source) }

    const list: SimNode[] = []
    const entering: Array<{ sn: SimNode; id: string; members?: string[] }> = []
    for (const n of view.nodes) {
      let sn = this.pos.get(n.id)
      if (!sn) {
        sn = { id: n.id, r: n.r, eco: n.eco, cluster: n.kind === 'cluster', x: 0, y: 0, vx: 0, vy: 0 }
        this.pos.set(n.id, sn)
      }
      sn.r = n.r
      sn.cluster = n.kind === 'cluster'
      sn.eco = n.eco
      if (!prevActive.has(n.id)) entering.push({ sn, id: n.id, members: n.members })
      list.push(sn)
    }

    // ---- spawn points -----------------------------------------------------------------
    const placed = new Set<string>(list.filter((s) => prevActive.has(s.id)).map((s) => s.id))
    const jitter = (id: string, rad: number): Pt => {
      const a = hash01(id, 1) * Math.PI * 2
      const d = rad * (0.4 + 0.6 * hash01(id, 2))
      return { x: Math.cos(a) * d, y: Math.sin(a) * d }
    }
    const spawnFrom = (sn: SimNode, at: Pt, rad: number) => {
      const j = jitter(sn.id, rad)
      sn.x = at.x + j.x; sn.y = at.y + j.y; sn.vx = 0; sn.vy = 0
      placed.add(sn.id)
    }
    const pending = [...entering]
    // pass 1: clusters from their members, packages from the cluster they were inside
    for (let i = pending.length - 1; i >= 0; i--) {
      const { sn, id, members } = pending[i]
      let done = false
      if (members?.length) {
        const known = members.map((m) => this.pos.get(m)).filter((p): p is SimNode => !!p && prevActive.has(p.id))
        if (known.length) {
          spawnFrom(sn, { x: known.reduce((a, p) => a + p.x, 0) / known.length, y: known.reduce((a, p) => a + p.y, 0) / known.length }, 6)
          done = true
        }
      } else {
        const cid = this.memberOf.get(id)
        const c = cid ? this.pos.get(cid) : undefined
        if (c && prevActive.has(c.id)) { spawnFrom(sn, c, sn.r * 2.4); done = true }
      }
      if (done) pending.splice(i, 1)
    }
    // pass 2: next to an already placed neighbour; fall back to the ecosystem anchor
    for (let guard = 0; guard < 6 && pending.length; guard++) {
      let progress = false
      for (let i = pending.length - 1; i >= 0; i--) {
        const { sn, id } = pending[i]
        const nb = (adj.get(id) ?? []).find((x) => placed.has(x))
        if (nb) { spawnFrom(sn, this.pos.get(nb)!, 16 + sn.r); pending.splice(i, 1); progress = true }
      }
      if (!progress) break
    }
    for (const { sn } of pending) {
      const a = this.anchors.get(sn.eco) ?? { x: 0, y: 0 }
      spawnFrom(sn, a, this.first ? 12 : 60)
    }

    this.memberOf = new Map()
    for (const n of view.nodes) if (n.members) for (const m of n.members) this.memberOf.set(m, n.id)

    // ---- simulation setup --------------------------------------------------------------
    this.active = list
    this.activeIds = nextIds
    this.sim.nodes(list)
    const byId = new Map(list.map((s) => [s.id, s]))
    const links: SimLink[] = view.edges.map((e: GEdge) => ({
      source: e.source, target: e.target, cluster: e.kind === 'cluster',
      ra: byId.get(e.source)?.r ?? 5, rb: byId.get(e.target)?.r ?? 5,
    }))
    this.links.links(links)
    const alpha = this.first ? 1 : Math.max(0.24, Math.min(0.6, 0.2 + entering.length * 0.012))
    const wasFirst = this.first
    this.first = false
    this.sim.alpha(alpha)
    this.settled = false

    if (this.reduced) {
      this.runSync()
      this.cb.onFrame()
      this.settled = true
      this.cb.onSettle()
      return
    }
    if (list.length > STATIC_LAYOUT_THRESHOLD) this.runStatic(list)
    else this.runAnimated(wasFirst)
  }

  private runSync() {
    let guard = 0
    while (this.sim.alpha() >= this.sim.alphaMin() && guard++ < 600) this.sim.tick()
  }

  /** ≤300 nodes: a short pre-warm, then 3 ticks per frame written straight to the DOM until cool. */
  private runAnimated(prewarm: boolean) {
    const tok = this.token
    if (prewarm) for (let i = 0; i < 18; i++) this.sim.tick()
    this.cb.onFrame()
    const step = () => {
      if (tok !== this.token) return
      for (let i = 0; i < 3 && this.sim.alpha() >= this.sim.alphaMin(); i++) this.sim.tick()
      this.cb.onFrame()
      if (this.sim.alpha() < this.sim.alphaMin()) {
        this.settled = true
        this.cb.onSettle()
        return
      }
      this.raf = requestAnimationFrame(step)
    }
    this.raf = requestAnimationFrame(step)
  }

  /** >300 nodes: solve in ≤9ms slices without painting, then interpolate from the old positions to the solved ones. */
  private runStatic(list: SimNode[]) {
    const tok = this.token
    const from = list.map((n) => ({ x: n.x, y: n.y }))
    this.cb.onFrame()
    const solve = () => {
      if (tok !== this.token) return
      const t0 = performance.now()
      while (this.sim.alpha() >= this.sim.alphaMin() && performance.now() - t0 < 9) this.sim.tick()
      if (this.sim.alpha() >= this.sim.alphaMin()) { this.raf = requestAnimationFrame(solve); return }
      const to = list.map((n) => ({ x: n.x, y: n.y }))
      const start = performance.now()
      const DUR = 650
      const play = () => {
        if (tok !== this.token) return
        const p = Math.min(1, (performance.now() - start) / DUR)
        const e = ease(p)
        for (let i = 0; i < list.length; i++) {
          list[i].x = from[i].x + (to[i].x - from[i].x) * e
          list[i].y = from[i].y + (to[i].y - from[i].y) * e
        }
        this.cb.onFrame()
        if (p < 1) { this.raf = requestAnimationFrame(play); return }
        this.settled = true
        this.cb.onSettle()
      }
      this.raf = requestAnimationFrame(play)
    }
    this.raf = requestAnimationFrame(solve)
  }

  /** Run to completion right now (tests, reduced motion). */
  settleNow() {
    this.stop()
    this.runSync()
    this.settled = true
  }
}
