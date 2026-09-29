import { memo, useCallback, useState, type KeyboardEvent } from 'react'
import type { NodeVis, GNode, GEdge } from './types'
import { ECOSYSTEM_META, SEVERITY_META } from '@/lib/meta'

export const shortName = (s: string, max = 24) => (s.length <= max ? s : `${s.slice(0, Math.ceil(max * 0.45))}…${s.slice(-Math.floor(max * 0.5))}`)

export interface NodeProps {
  n: GNode
  vis: NodeVis
  exiting: boolean
  /** roving tabindex: exactly one node is in the tab order */
  active: boolean
  label: boolean
  /** entrance delay (ms); only meaningful at mount */
  delay: number
  /** play the one-off critical pulse (decided at mount) */
  pulse: boolean
  register: (id: string, el: SVGGElement | null) => void
  onActivate: (id: string) => void
  onKey: (e: KeyboardEvent<SVGGElement>, id: string) => void
  onHover: (id: string | null) => void
  onFocusNode: (id: string) => void
}

const sev = (s: GNode['severity'], a = 1) => `rgb(${SEVERITY_META[s].rgb} / ${a})`

/** A package (or collapsed cluster) node. Memoised: only re-renders when its own visual state changes. */
export const GraphNode = memo(function GraphNode({ n, vis, exiting, active, label, delay, pulse, register, onActivate, onKey, onHover, onFocusNode }: NodeProps) {
  const ref = useCallback((el: SVGGElement | null) => register(n.id, el), [register, n.id])
  const [enterDelay] = useState(delay)
  const [doPulse] = useState(pulse && n.severity === 'critical')
  const cluster = n.kind === 'cluster'
  const hot = !cluster && n.flagged && n.severity !== 'info'
  const stroke = cluster
    ? (n.severity === 'info' || n.severity === 'low' ? 'rgba(236,237,240,.42)' : sev(n.severity, 0.9))
    : hot ? sev(n.severity, 0.95) : n.direct ? 'rgba(236,237,240,.66)' : 'rgba(236,237,240,.32)'
  const fill = cluster ? 'rgb(var(--c-elevated))' : hot ? sev(n.severity, 0.17) : n.direct ? 'rgb(var(--c-elevated))' : 'rgb(var(--c-card))'
  const aria = cluster
    ? `${n.members?.length ?? 0} collapsed packages in ${ECOSYSTEM_META[n.eco].label}. Press Enter to expand.`
    : `${n.name} ${n.version}, ${SEVERITY_META[n.severity].label} severity, risk ${n.risk}, ${ECOSYSTEM_META[n.eco].label}${n.direct ? ', direct dependency' : ''}${n.dev ? ', dev dependency' : ''}`
  const showLabel = label && !cluster

  return (
    <g
      ref={ref}
      className="rg-pos"
      role="button"
      tabIndex={active ? 0 : -1}
      aria-label={aria}
      aria-pressed={vis === 'selected'}
      onClick={() => onActivate(n.id)}
      onKeyDown={(e) => onKey(e, n.id)}
      onPointerEnter={() => onHover(n.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onFocusNode(n.id)}
      onBlur={() => onHover(null)}
      style={{ ['--d' as string]: `${enterDelay}ms`, ['--pd' as string]: `${enterDelay + 500}ms` }}
    >
      <g className={exiting ? 'rg-fx rg-exit' : 'rg-fx rg-enter'}>
        <g className="rg-s" data-s={vis}>
          {doPulse && <circle className="rg-pulse" r={n.r} stroke={sev('critical', 0.8)} strokeWidth={1.4} />}
          {hot && (n.severity === 'critical' || n.severity === 'high') && <circle r={n.r * 2.3} fill={sev(n.severity, 0.09)} pointerEvents="none" />}
          <circle className="rg-hit" r={Math.max(n.r + 5, 11)} fill="transparent" />
          {n.internal && <circle r={n.r + 3.4} fill="none" stroke="rgb(var(--c-magenta-soft) / .6)" strokeWidth={0.9} />}
          <circle className="rg-rel-ring" r={n.r + 6} fill="none" stroke="rgb(var(--c-accent-soft))" strokeWidth={0.9} />
          <circle className="rg-sel-ring" r={n.r + 6.5} fill="none" stroke="rgb(var(--c-accent-soft))" strokeWidth={1.5} />
          <circle className="rg-focus" r={n.r + 8.5} fill="none" stroke="rgb(var(--c-accent-soft))" strokeWidth={1.8} />
          <g className="rg-body">
            <path
              d={n.shape} fill={fill} stroke={stroke} strokeWidth={n.direct || hot ? 1.5 : 1.1} strokeLinejoin="round"
              strokeDasharray={cluster ? '2.6 2.2' : n.dev ? '2.4 2' : undefined}
            />
            {cluster && <text className="rg-count">{n.members?.length}</text>}
          </g>
          {showLabel && <text className="rg-label" y={n.r + 12}>{shortName(n.name)}</text>}
        </g>
      </g>
    </g>
  )
})

export interface EdgeProps {
  e: GEdge
  state: 'normal' | 'hot' | 'dim' | 'ctx'
  exiting: boolean
  delay: number
  register: (key: string, el: SVGLineElement | null, s: string, t: string) => void
}

export const GraphEdge = memo(function GraphEdge({ e, state, exiting, delay, register }: EdgeProps) {
  const ref = useCallback((el: SVGLineElement | null) => register(e.key, el, e.source, e.target), [register, e.key, e.source, e.target])
  const [draw] = useState(e.kind !== 'cluster')
  const [d0] = useState(delay) // frozen at mount: changing an animation delay after the fact would replay the draw-in
  return (
    <line
      ref={ref}
      className={draw ? 'rg-e rg-e-draw' : 'rg-e'}
      data-s={state}
      data-k={e.kind}
      style={{ ['--d' as string]: `${d0}ms`, opacity: exiting ? 0 : 1, transition: 'opacity 260ms var(--ease), stroke-opacity 320ms var(--ease), stroke 320ms var(--ease)' }}
    />
  )
})
