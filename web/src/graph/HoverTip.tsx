import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ECOSYSTEM_META } from '@/lib/meta'
import type { GNode } from './types'

export interface HoverTipHandle {
  show: (node: GNode, x: number, y: number, r: number) => void
  hide: () => void
}

/**
 * Floating node tooltip. Own state so hovering never re-renders the graph.
 * Content is exactly: name, version, Risk, Dependencies, Ecosystem.
 */
export const HoverTip = forwardRef<HoverTipHandle, { width: number }>(function HoverTip({ width }, ref) {
  const [st, setSt] = useState<{ node: GNode; x: number; y: number; below: boolean } | null>(null)
  const timer = useRef<number>()
  useImperativeHandle(ref, () => ({
    show: (node, x, y, r) => {
      window.clearTimeout(timer.current)
      const below = y - r - 96 < 8
      setSt({ node, x: Math.max(96, Math.min(width - 96, x)), y: below ? y + r + 10 : y - r - 10, below })
    },
    hide: () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setSt(null), 40)
    },
  }), [width])
  if (!st) return null
  const n = st.node
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-max max-w-[220px] rounded-r2 border border-white/[.1] bg-elevated px-3 py-2.5 shadow-pop"
      style={{ left: st.x, top: st.y, transform: st.below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}
    >
      {n.kind === 'cluster' ? (
        <>
          <div className="text-[12.5px] font-medium text-ink">{n.members?.length} collapsed packages</div>
          <div className="mt-1 text-[11.5px] text-ink-3">Ecosystem: {ECOSYSTEM_META[n.eco].label}</div>
          <div className="mt-1 text-[11.5px] text-accent-soft">Click to expand</div>
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="mono break-all text-[12.5px] font-medium text-ink">{n.name}</span>
            <span className="mono shrink-0 text-[11px] text-ink-3">{n.version}</span>
          </div>
          <div className="mt-1.5 space-y-0.5 text-[11.5px] leading-snug text-ink-2">
            <div className="tnum">Risk: {n.risk}</div>
            <div className="tnum">Dependencies: {n.deps}</div>
            <div>Ecosystem: {ECOSYSTEM_META[n.eco].label}</div>
          </div>
        </>
      )}
    </div>
  )
})
