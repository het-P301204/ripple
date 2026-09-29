import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { Waypoints } from 'lucide-react'
import type { Ecosystem, ScanResult, Severity } from '@/types/scan'
import { useScan } from '@/hooks/useScan'
import { ECOSYSTEMS } from '@/lib/meta'
import { plural } from '@/lib/format'
import { useMedia } from '@/charts/hooks'
import { NoScanEmptyState } from '@/components/NoScanEmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, StateGlyph } from '@/components/ui/States'
import { Badge } from '@/components/ui/Badge'
import { useReducedMotion } from '@/lib/perf'
import { GraphCanvas, type CenterRequest, type GraphHandle } from '@/graph/GraphCanvas'
import { GraphFilters, GraphLegend, GraphSearch, GraphToolbar, type DepthValue } from '@/graph/GraphControls'
import { GraphSkeleton } from '@/graph/GraphSkeleton'
import { NodePanel } from '@/graph/NodePanel'
import { ecosystemAnchors } from '@/graph/layout'
import { buildModel, computeView, neighbourhood } from '@/graph/model'
import type { NodeVis, ViewMode } from '@/graph/types'
import type { Inset } from '@/graph/camera'

const HEADER = {
  eyebrow: 'Dependency graph',
  title: 'Dependency Graph',
  subtitle: 'How packages relate, and where risk concentrates.',
}

export default function DependencyGraph() {
  const { scan, loading } = useScan()
  if (!scan) {
    return (
      <>
        <PageHeader {...HEADER} />
        {loading ? <GraphSkeleton /> : <NoScanEmptyState description="Load a scan to map how its packages depend on each other." />}
      </>
    )
  }
  return <GraphPage key={scan.id} scan={scan} />
}

const parseList = <T extends string>(raw: string | null, allowed: readonly T[]): Set<T> =>
  new Set((raw ?? '').split(',').map((s) => s.trim()).filter((s): s is T => (allowed as readonly string[]).includes(s)))

function GraphPage({ scan }: { scan: ScanResult }) {
  const model = useMemo(() => buildModel(scan), [scan])
  const [params, setParams] = useSearchParams()
  const reduced = !!useReducedMotion()
  const mobile = useMedia('(max-width: 767px)')
  const graphRef = useRef<GraphHandle>(null)

  const resolveFocus = useCallback((raw: string | null) => {
    if (!raw) return null
    if (model.nodes.has(raw)) return raw
    for (const n of model.nodes.values()) if (n.name === raw) return n.id
    return null
  }, [model])

  const [mode, setMode] = useState<ViewMode>('focused')
  const [severities, setSeverities] = useState<Set<Severity>>(() => parseList(params.get('severity'), ['critical', 'high', 'medium', 'low', 'info'] as const))
  const [ecosystems, setEcosystems] = useState<Set<Ecosystem>>(() => parseList(params.get('ecosystem'), ECOSYSTEMS))
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pinned, setPinned] = useState<Set<string>>(() => { const f = resolveFocus(params.get('focus')); return new Set(f ? [f] : []) })
  const [selectedId, setSelectedId] = useState<string | null>(() => resolveFocus(params.get('focus')))
  const [depth, setDepth] = useState<DepthValue>(1)
  const [legendOpen, setLegendOpen] = useState(() => {
    try { return window.localStorage.getItem('ripple.graph.legend') === '1' && window.innerWidth >= 1024 } catch { return false }
  })
  const [center, setCenter] = useState<CenterRequest | null>(() => {
    const f = resolveFocus(params.get('focus'))
    return f ? { id: f, nonce: 1, zoom: 1.25 } : null
  })
  const nonce = useRef(1)

  // keep ?focus= in the URL so a focused package is linkable
  useEffect(() => {
    const cur = params.get('focus')
    const want = selectedId ? model.nodes.get(selectedId)?.name ?? null : null
    if ((cur ?? null) === want) return
    const next = new URLSearchParams(params)
    if (want) next.set('focus', want)
    else next.delete('focus')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const neigh = useMemo(() => (selectedId ? neighbourhood(model, selectedId, depth) : null), [model, selectedId, depth])
  const reveal = useMemo(() => {
    const s = new Set(pinned)
    neigh?.forEach((_, id) => s.add(id))
    return s
  }, [pinned, neigh])
  const view = useMemo(() => computeView(model, { mode, severities, ecosystems, expanded, reveal }), [model, mode, severities, ecosystems, expanded, reveal])

  const vis = useMemo(() => {
    const m = new Map<string, NodeVis>()
    if (!selectedId || !neigh) return m
    for (const n of view.nodes) {
      if (n.kind === 'cluster') m.set(n.id, n.anchor === selectedId || n.members?.some((x) => neigh.has(x)) ? 'related' : 'dim')
      else m.set(n.id, n.id === selectedId ? 'selected' : neigh.has(n.id) ? 'related' : 'dim')
    }
    return m
  }, [view, selectedId, neigh])

  const anchors = useMemo(() => ecosystemAnchors(model), [model])
  const selectedNode = selectedId ? model.nodes.get(selectedId) ?? null : null
  const refitKey = `${mode}|${[...severities].sort().join()}|${[...ecosystems].sort().join()}`

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) setCenter({ id, nonce: ++nonce.current, ifHidden: true, zoom: 1 })
  }, [])

  /** Navigate to a package from search or the detail panel: make sure it is visible, select it, bring it to the centre. */
  const focusPackage = useCallback((id: string) => {
    const n = model.nodes.get(id)
    if (!n) return
    if (severities.size && !severities.has(n.severity)) setSeverities(new Set())
    if (ecosystems.size && !ecosystems.has(n.eco)) setEcosystems(new Set())
    setPinned((p) => new Set(p).add(id))
    setSelectedId(id)
    setCenter({ id, nonce: ++nonce.current, zoom: 1.25 })
  }, [model, severities, ecosystems])

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n }
  const dirty = mode !== 'focused' || severities.size > 0 || ecosystems.size > 0 || expanded.size > 0 || pinned.size > 0 || selectedId != null
  const reset = () => {
    setMode('focused'); setSeverities(new Set()); setEcosystems(new Set()); setExpanded(new Set()); setPinned(new Set()); setSelectedId(null); setDepth(1)
    window.setTimeout(() => graphRef.current?.fit(), 60)
  }
  const openLegend = () => setLegendOpen((v) => { const n = !v; try { window.localStorage.setItem('ripple.graph.legend', n ? '1' : '0') } catch { /* ignore */ } return n })

  // keep the auto-fit clear of the floating search/filters (top) and toolbar (bottom), and of the detail panel
  const wide = useMedia('(min-width: 1024px)')
  const inset: Inset = useMemo(() => ({
    left: 0,
    right: selectedNode && !mobile ? 372 : 0,
    top: wide ? 88 : 120,
    bottom: selectedNode && mobile ? 300 : 64,
  }), [selectedNode !== null, mobile, wide]) // eslint-disable-line react-hooks/exhaustive-deps

  if (model.order.length === 0) {
    return (
      <>
        <PageHeader {...HEADER} />
        <EmptyState
          glyph={<StateGlyph />} title="No packages to graph"
          description="This scan did not resolve any dependencies. Check that the lockfile lists packages, then scan again."
        />
      </>
    )
  }

  const noEdges = model.edges.length === 0
  return (
    <>
      <PageHeader
        {...HEADER}
        meta={
          <>
            <span className="inline-flex items-center gap-1.5"><Waypoints size={13} aria-hidden /> {plural(model.order.length, 'package')}</span>
            <span>{plural(model.edges.length, 'relationship')}</span>
            <span>{plural(model.ecos.length, 'ecosystem')}</span>
          </>
        }
      />

      <div className="relative overflow-hidden rounded-r5 border border-white/[.08] bg-card shadow-card" style={{ height: 'clamp(540px, calc(100vh - 250px), 860px)' }}>
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 70% at 50% 45%, rgb(var(--c-accent) / .055), transparent 72%), radial-gradient(40% 50% at 100% 0%, rgb(var(--c-magenta) / .03), transparent 70%)' }} />
        <GraphCanvas
          ref={graphRef}
          view={view} vis={vis} focusActive={!!selectedId} selectedId={selectedId} anchors={anchors} reduced={reduced}
          inset={inset} refitKey={refitKey} centerRequest={center}
          onSelect={select}
          onCluster={(id) => setExpanded((s) => new Set(s).add(id))}
        >
          {/* overlays: pointer-events only on the controls themselves */}
          <div
            className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-4"
            style={{ paddingRight: selectedNode && !mobile ? 372 : undefined }}
          >
            <div className="flex flex-col items-start gap-2.5">
              <div className="pointer-events-auto"><GraphSearch model={model} onPick={focusPackage} /></div>
              <div className="pointer-events-auto max-w-full overflow-x-auto pb-0.5 lg:max-w-[720px]">
                <GraphFilters
                  model={model} severities={severities} ecosystems={ecosystems}
                  onSeverity={(s) => setSeverities((v) => toggle(v, s))}
                  onEcosystem={(e) => setEcosystems((v) => toggle(v, e))}
                />
              </div>
              {noEdges && (
                <Badge tone="amber" className="pointer-events-auto !h-auto whitespace-normal py-1.5 leading-snug">
                  No dependency relationships were resolved, so packages are grouped by ecosystem.
                </Badge>
              )}
            </div>

            <div className={`flex flex-col items-start gap-2 ${selectedNode && mobile ? 'invisible' : ''}`}>
              {legendOpen && <GraphLegend />}
              <GraphToolbar
                mode={mode} onMode={(m) => { setMode(m); setExpanded(new Set()) }}
                depth={depth} onDepth={setDepth} hasSelection={!!selectedId}
                onZoomIn={() => graphRef.current?.zoomIn()} onZoomOut={() => graphRef.current?.zoomOut()} onFit={() => graphRef.current?.fit()}
                dirty={dirty} onReset={reset} legendOpen={legendOpen} onLegend={openLegend}
              />
            </div>
          </div>

          <AnimatePresence>
            {selectedNode && (
              <NodePanel key="panel" node={selectedNode} model={model} mobile={mobile} onClose={() => select(null)} onFocus={focusPackage} />
            )}
          </AnimatePresence>
        </GraphCanvas>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3" aria-live="polite">
        {view.sevActive
          ? `${plural(view.matchCount, 'package')} match the severity filter, shown with the paths that lead to them.`
          : `Showing ${view.packageCount} of ${model.order.length} packages${view.clusterCount ? `; ${view.collapsedCount} low-risk transitive packages are folded into ${plural(view.clusterCount, 'cluster')}. Select a cluster to expand it.` : '.'}`}
        <span className="hidden md:inline"> Scroll to zoom, drag to pan. Tab into the graph, then use arrow keys to move between packages and Esc to close details.</span>
        <span className="md:hidden"> Pinch to zoom, drag to pan.</span>
      </p>
    </>
  )
}
