import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type ReactNode,
} from 'react'
import type { Ecosystem } from '@/types/scan'
import { ECOSYSTEM_META, SEVERITY_RANK } from '@/lib/meta'
import { Camera, NO_INSET, type Inset } from './camera'
import { GraphLayout } from './layout'
import { GraphEdge, GraphNode } from './GraphNode'
import { HoverTip, type HoverTipHandle } from './HoverTip'
import type { GEdge, GNode, GraphView, NodeVis, Pt } from './types'
import './graph.css'

export interface GraphHandle {
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
}

export interface CenterRequest { id: string; nonce: number; zoom?: number; ifHidden?: boolean }

export interface GraphCanvasProps {
  view: GraphView
  /** visual state per node id (selected / related / dim). Missing ids fall back to normal/ctx (or dim while `focusActive`). */
  vis: Map<string, NodeVis>
  focusActive: boolean
  selectedId: string | null
  anchors: Map<Ecosystem, Pt>
  reduced: boolean
  /** area covered by floating UI (detail panel) — fit/centre keep clear of it */
  inset?: Inset
  /** changing this re-arms auto-fit for the next settle (mode / filter changes) */
  refitKey: string
  centerRequest?: CenterRequest | null
  ariaLabel?: string
  onSelect: (id: string | null) => void
  onCluster: (id: string) => void
  children?: ReactNode
}

/** Keeps items rendered for `ms` after they leave `items`, flagged as exiting, so removal can fade. Render-phase safe (idempotent). */
function useLingering<T extends { key: string }>(items: T[], ms: number): Array<{ item: T; exiting: boolean }> {
  const last = useRef<{ items: T[]; map: Map<string, T> }>({ items: [], map: new Map() })
  const ghosts = useRef(new Map<string, { item: T; until: number }>())
  const [, bump] = useState(0)
  if (last.current.items !== items) {
    const cur = new Map(items.map((i) => [i.key, i]))
    const now = Date.now()
    last.current.map.forEach((v, k) => { if (!cur.has(k)) ghosts.current.set(k, { item: v, until: now + ms }) })
    cur.forEach((_, k) => ghosts.current.delete(k))
    last.current = { items, map: cur }
  }
  const now = Date.now()
  ghosts.current.forEach((g, k) => { if (g.until < now - 20) ghosts.current.delete(k) })
  const soonest = ghosts.current.size ? Math.min(...[...ghosts.current.values()].map((g) => g.until)) : 0
  useEffect(() => {
    if (!soonest) return
    const t = window.setTimeout(() => bump((n) => n + 1), Math.max(30, soonest - Date.now() + 40))
    return () => window.clearTimeout(t)
  }, [soonest])
  return [...items.map((item) => ({ item, exiting: false })), ...[...ghosts.current.values()].map((g) => ({ item: g.item, exiting: true }))]
}

const labelLevelOf = (k: number) => (k < 0.85 ? 0 : k < 1.7 ? 1 : k < 2.6 ? 2 : 3)

export const GraphCanvas = forwardRef<GraphHandle, GraphCanvasProps>(function GraphCanvas(
  { view, vis, focusActive, selectedId, anchors, reduced, inset = NO_INSET, refitKey, centerRequest, ariaLabel, onSelect, onCluster, children }, handle,
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tipRef = useRef<HoverTipHandle>(null)
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const edgeEls = useRef(new Map<string, { el: SVGLineElement; s: string; t: string }>())
  const prevIds = useRef<Set<string>>(new Set())
  const pulsed = useRef<Set<string>>(new Set())
  const intro = useRef(true)
  const autoFit = useRef(true)
  const needsFirstFit = useRef(true)
  const pending = useRef<CenterRequest | null>(null)
  const suppressClick = useRef(false)
  const insetRef = useRef(inset)
  insetRef.current = inset
  const viewRef = useRef(view)
  viewRef.current = view
  const cbRef = useRef({ onSelect, onCluster })
  cbRef.current = { onSelect, onCluster }
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const [labelLevel, setLabelLevel] = useState(1)
  const [ecoLabels, setEcoLabels] = useState<Array<{ eco: Ecosystem; x: number; y: number }>>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [width, setWidth] = useState(0)

  // ---- engine objects (created once) ---------------------------------------------------------
  const camera = useMemo(() => new Camera(), [])
  const paintRef = useRef<() => void>(() => {})
  const settleRef = useRef<() => void>(() => {})
  const layout = useMemo(() => new GraphLayout({ onFrame: () => paintRef.current(), onSettle: () => settleRef.current() }), [])
  useEffect(() => () => { layout.stop(); camera.stop() }, [layout, camera])

  const paintNode = useCallback((id: string, el: SVGGElement) => {
    const p = layout.pos.get(id)
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) el.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
  }, [layout])
  const paintEdge = useCallback((s: string, t: string, el: SVGLineElement) => {
    const a = layout.pos.get(s), b = layout.pos.get(t)
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) return
    el.setAttribute('x1', a.x.toFixed(1)); el.setAttribute('y1', a.y.toFixed(1))
    el.setAttribute('x2', b.x.toFixed(1)); el.setAttribute('y2', b.y.toFixed(1))
  }, [layout])
  paintRef.current = () => {
    nodeEls.current.forEach((el, id) => paintNode(id, el))
    edgeEls.current.forEach((e) => paintEdge(e.s, e.t, e.el))
  }

  const registerNode = useCallback((id: string, el: SVGGElement | null) => {
    if (el) { nodeEls.current.set(id, el); paintNode(id, el) } else nodeEls.current.delete(id)
  }, [paintNode])
  const registerEdge = useCallback((key: string, el: SVGLineElement | null, s: string, t: string) => {
    if (el) { edgeEls.current.set(key, { el, s, t }); paintEdge(s, t, el) } else edgeEls.current.delete(key)
  }, [paintEdge])

  const tryCenter = useCallback((final: boolean) => {
    const req = pending.current
    if (!req) return
    const p = layout.pos.get(req.id)
    if (!p) return
    if (req.ifHidden && camera.isVisible(p.x, p.y, insetRef.current)) { if (final) pending.current = null; return }
    camera.centerOn(p.x, p.y, insetRef.current, Math.max(camera.k, req.zoom ?? 1.05), !reducedRef.current)
    if (final) pending.current = null
  }, [layout, camera])

  settleRef.current = () => {
    paintRef.current()
    // ecosystem island captions
    const by = new Map<Ecosystem, { x: number; y: number; n: number }>()
    for (const s of layout.activeNodes()) {
      const c = by.get(s.eco) ?? { x: 0, y: 1e9, n: 0 }
      c.x += s.x; c.y = Math.min(c.y, s.y - s.r); c.n += 1
      by.set(s.eco, c)
    }
    const labels: Array<{ eco: Ecosystem; x: number; y: number }> = []
    by.forEach((c, eco) => { if (c.n >= 4) labels.push({ eco, x: c.x / c.n, y: c.y - 22 }) })
    setEcoLabels(labels)
    if (pending.current) tryCenter(true)
    else if (autoFit.current) camera.fit(layout.bounds(), insetRef.current, !reducedRef.current)
    intro.current = false
  }

  // ---- camera <-> React (coarse only) --------------------------------------------------------
  const lastLevel = useRef(1)
  const lastEk = useRef(1)
  useLayoutEffect(() => {
    camera.reduced = reduced
    camera.onChange = (c) => {
      const lvl = labelLevelOf(c.k)
      if (lvl !== lastLevel.current) { lastLevel.current = lvl; setLabelLevel(lvl) }
      const ek = Math.round(Math.min(2.4, Math.max(0.7, c.k)) * 5) / 5
      if (ek !== lastEk.current) { lastEk.current = ek; rootRef.current?.style.setProperty('--ek', String(ek)) }
      tipRef.current?.hide()
    }
    return () => { camera.onChange = undefined }
  }, [camera, reduced])

  const vpRef = useCallback((el: SVGGElement | null) => camera.attach(el), [camera])

  // ---- view swap -----------------------------------------------------------------------------
  useEffect(() => { autoFit.current = true }, [refitKey])
  useLayoutEffect(() => {
    layout.reduced = reduced
    layout.setAnchors(anchors)
    const r = rootRef.current?.getBoundingClientRect()
    if (r && r.width > 0) { camera.resize(r.width, r.height); setWidth(r.width) }
    layout.setView(view)
    paintRef.current()
    if (needsFirstFit.current && camera.w > 0) {
      camera.fit(layout.predictBounds(view), insetRef.current, false)
      needsFirstFit.current = false
    }
    prevIds.current = new Set(view.nodes.map((n) => n.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
  useEffect(() => { view.nodes.forEach((n) => { if (n.severity === 'critical') pulsed.current.add(n.id) }) }, [view])

  // ---- size ----------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0) return
      camera.resize(r.width, r.height)
      setWidth(r.width)
      if (needsFirstFit.current) {
        camera.fit(layout.predictBounds(viewRef.current), insetRef.current, false)
        needsFirstFit.current = false
      } else if (autoFit.current && layout.isSettled) camera.fit(layout.bounds(), insetRef.current, false)
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [camera, layout])

  // ---- floating UI came or went (detail panel): re-frame if the user hasn't taken over the camera -------
  useEffect(() => {
    if (autoFit.current && layout.isSettled && camera.w > 0) camera.fit(layout.bounds(), insetRef.current, !reducedRef.current)
  }, [inset.left, inset.right, inset.top, inset.bottom, layout, camera])

  // ---- external "centre on node" requests ----------------------------------------------------
  useEffect(() => {
    if (!centerRequest) return
    pending.current = centerRequest
    tryCenter(centerRequest.ifHidden === true)
  }, [centerRequest, tryCenter])

  // ---- pointer / wheel gestures --------------------------------------------------------------
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const pts = new Map<number, Pt>()
    let dragging = false
    let moved = false
    let start: Pt = { x: 0, y: 0 }
    let pinch: { d: number; mx: number; my: number } | null = null
    const rel = (e: PointerEvent | WheelEvent): Pt => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
    const userMoved = () => { autoFit.current = false; pending.current = null }
    const cap = (id: number) => { try { svg.setPointerCapture(id) } catch { /* ignore */ } }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = rel(e)
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      camera.zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.011 : 0.0016)))
      userMoved()
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      pts.set(e.pointerId, rel(e))
      start = rel(e)
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
        dragging = true; moved = true
        pts.forEach((_, id) => cap(id))
      }
    }
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId)
      if (!prev) return
      const cur = rel(e)
      pts.set(e.pointerId, cur)
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        camera.zoomAt(mx, my, d / pinch.d)
        camera.panBy(mx - pinch.mx, my - pinch.my)
        pinch = { d, mx, my }
        userMoved()
        return
      }
      if (!dragging) {
        if (Math.hypot(cur.x - start.x, cur.y - start.y) < 4) return
        dragging = true; moved = true
        cap(e.pointerId)
        svg.classList.add('is-panning')
      }
      camera.panBy(cur.x - prev.x, cur.y - prev.y)
      userMoved()
    }
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      if (pts.size < 2) pinch = null
      if (pts.size === 0) {
        if (moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false }, 0) }
        dragging = false; moved = false
        svg.classList.remove('is-panning')
      }
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    svg.addEventListener('pointerdown', onDown)
    svg.addEventListener('pointermove', onMove)
    svg.addEventListener('pointerup', onUp)
    svg.addEventListener('pointercancel', onUp)
    return () => {
      svg.removeEventListener('wheel', onWheel)
      svg.removeEventListener('pointerdown', onDown)
      svg.removeEventListener('pointermove', onMove)
      svg.removeEventListener('pointerup', onUp)
      svg.removeEventListener('pointercancel', onUp)
    }
  }, [camera])

  // ---- imperative API ------------------------------------------------------------------------
  useImperativeHandle(handle, () => ({
    zoomIn: () => { autoFit.current = false; camera.zoomStep(1.35, insetRef.current) },
    zoomOut: () => { autoFit.current = false; camera.zoomStep(1 / 1.35, insetRef.current) },
    fit: () => { autoFit.current = true; pending.current = null; camera.fit(layout.bounds(), insetRef.current, !reducedRef.current) },
  }), [camera, layout])

  // ---- node interaction ----------------------------------------------------------------------
  const nodeById = useMemo(() => new Map(view.nodes.map((n) => [n.id, n])), [view])
  const nodeByIdRef = useRef(nodeById)
  nodeByIdRef.current = nodeById

  const activate = useCallback((id: string) => {
    if (suppressClick.current) return
    const n = nodeByIdRef.current.get(id)
    if (!n) return
    tipRef.current?.hide()
    if (n.kind === 'cluster') cbRef.current.onCluster(id)
    else cbRef.current.onSelect(id)
  }, [])

  const onHover = useCallback((id: string | null) => {
    if (!id) { tipRef.current?.hide(); return }
    if (svgRef.current?.classList.contains('is-panning')) return
    const n = nodeByIdRef.current.get(id)
    const p = layout.pos.get(id)
    if (!n || !p) return
    const s = camera.toScreen(p.x, p.y)
    tipRef.current?.show(n, s.x, s.y, n.r * camera.k)
  }, [layout, camera])

  const focusNode = useCallback((id: string) => {
    const el = nodeEls.current.get(id)
    el?.focus({ preventScroll: true })
    const p = layout.pos.get(id)
    if (p && !camera.isVisible(p.x, p.y, insetRef.current, 20)) camera.centerOn(p.x, p.y, insetRef.current, camera.k, !reducedRef.current)
  }, [layout, camera])

  const onNodeKey = useCallback((e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); activate(id); return }
    if (e.key === 'Escape') { e.stopPropagation(); cbRef.current.onSelect(null); return }
    const dirs: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }
    const d = dirs[e.key]
    if (!d) return
    e.preventDefault(); e.stopPropagation()
    const a = layout.pos.get(id)
    if (!a) return
    let best: string | null = null
    let bestScore = Infinity
    for (const n of viewRef.current.nodes) {
      if (n.id === id) continue
      const p = layout.pos.get(n.id)
      if (!p) continue
      const dx = p.x - a.x, dy = p.y - a.y
      const along = dx * d[0] + dy * d[1]
      const perp = Math.abs(dx * d[1] - dy * d[0])
      if (along <= 1 || perp > along * 1.7) continue
      const score = along + perp * 1.4
      if (score < bestScore) { bestScore = score; best = n.id }
    }
    if (best) focusNode(best)
  }, [layout, activate, focusNode])

  const onRootKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const step = 70
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (pan[e.key]) { e.preventDefault(); autoFit.current = false; camera.panBy(pan[e.key][0], pan[e.key][1]); return }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); autoFit.current = false; camera.zoomStep(1.35, insetRef.current) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); autoFit.current = false; camera.zoomStep(1 / 1.35, insetRef.current) }
    else if (e.key === '0') { e.preventDefault(); autoFit.current = true; camera.fit(layout.bounds(), insetRef.current, !reducedRef.current) }
    else if (e.key === 'Escape') cbRef.current.onSelect(null)
  }, [camera, layout])

  const onBackground = useCallback((e: React.MouseEvent) => {
    if (suppressClick.current) return
    if ((e.target as Element).closest('.rg-pos')) return
    cbRef.current.onSelect(null)
  }, [])

  // ---- render lists --------------------------------------------------------------------------
  const nodeItems = useMemo(() => view.nodes.map((n) => ({ key: n.id, n })), [view])
  const edgeItems = useMemo(() => view.edges.map((e) => ({ key: e.key, e })), [view])
  const nodeList = useLingering(nodeItems, 300)
  const edgeList = useLingering(edgeItems, 300)

  const delays = useMemo(() => {
    const m = new Map<string, number>()
    const prev = prevIds.current
    const fresh = view.nodes.filter((n) => !prev.has(n.id)).sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))
    const per = intro.current ? Math.min(9, 640 / Math.max(1, fresh.length)) : Math.min(14, 200 / Math.max(1, fresh.length))
    fresh.forEach((n, i) => m.set(n.id, Math.round(i * per)))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const defaultActive = useMemo(() => {
    let best: GNode | null = null
    for (const n of view.nodes) if (n.kind === 'pkg' && (!best || n.risk > best.risk)) best = n
    return best?.id ?? view.nodes[0]?.id ?? null
  }, [view])
  const activeId = focusId && nodeById.has(focusId) ? focusId : selectedId && nodeById.has(selectedId) ? selectedId : defaultActive

  const visOf = (id: string): NodeVis => vis.get(id) ?? (focusActive ? 'dim' : view.ctx.has(id) ? 'ctx' : 'normal')
  const small = view.nodes.length <= 42
  const showLabel = (n: GNode, v: NodeVis) => {
    if (n.kind === 'cluster' || v === 'dim' || v === 'ctx') return false
    if (v === 'selected' || v === 'related') return true
    if (small || labelLevel >= 2) return true
    const rank = SEVERITY_RANK[n.severity]
    return labelLevel === 1 ? rank >= 2 || (n.direct && n.flagged) : rank >= 3
  }
  const edgeState = (e: GEdge): 'normal' | 'hot' | 'dim' | 'ctx' => {
    const a = visOf(e.source), b = visOf(e.target)
    if (focusActive) return (a === 'selected' || a === 'related') && (b === 'selected' || b === 'related') ? 'hot' : 'dim'
    return a === 'ctx' || b === 'ctx' ? 'ctx' : 'normal'
  }

  return (
    <div
      ref={rootRef}
      className={view.nodes.length > 90 ? 'rg-root rg-big absolute inset-0' : 'rg-root absolute inset-0'}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel ?? 'Dependency graph. Arrow keys pan, plus and minus zoom, zero fits the view. Tab moves into the packages; arrow keys then move between them.'}
      onKeyDown={onRootKey}
    >
      <svg ref={svgRef} className="rg-svg h-full w-full" onClick={onBackground}>
        <g ref={vpRef}>
          <g aria-hidden="true">
            {edgeList.map(({ item, exiting }) => (
              <GraphEdge
                key={item.key} e={item.e} state={edgeState(item.e)} exiting={exiting}
                delay={Math.round(260 + (delays.get(item.e.target) ?? 0))} register={registerEdge}
              />
            ))}
          </g>
          <g aria-hidden="true">
            {ecoLabels.map((l) => (
              <text key={l.eco} className="rg-eco-label" x={l.x} y={l.y} style={{ opacity: labelLevel >= 3 || focusActive ? 0 : 1 }}>{ECOSYSTEM_META[l.eco].label}</text>
            ))}
          </g>
          <g role="group" aria-label="Packages">
            {nodeList.map(({ item, exiting }) => {
              const n = item.n
              const v = visOf(n.id)
              return (
                <GraphNode
                  key={item.key} n={n} vis={v} exiting={exiting} active={n.id === activeId} label={showLabel(n, v)}
                  delay={delays.get(n.id) ?? 0} pulse={!pulsed.current.has(n.id)}
                  register={registerNode} onActivate={activate} onKey={onNodeKey} onHover={onHover} onFocusNode={setFocusId}
                />
              )
            })}
          </g>
        </g>
      </svg>
      <HoverTip ref={tipRef} width={width || 800} />
      {children}
    </div>
  )
})
