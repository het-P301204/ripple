import { useMemo } from 'react'
import { hash01 } from './layout'
import './graph.css'

/** Animated placeholder for the graph card: four faint islands whose edges draw and nodes breathe. Static under reduced motion. */
export function GraphSkeleton({ height = 'clamp(520px, calc(100vh - 250px), 860px)' }: { height?: string }) {
  const { nodes, edges } = useMemo(() => {
    const centers = [[300, 190], [720, 170], [270, 430], [730, 440]]
    const nodes: Array<{ x: number; y: number; r: number; d: number }> = []
    const edges: Array<{ a: number; b: number; d: number }> = []
    centers.forEach(([cx, cy], c) => {
      const start = nodes.length
      for (let i = 0; i < 11; i++) {
        const a = hash01(`s${c}-${i}`, 3) * Math.PI * 2
        const rad = i === 0 ? 0 : 34 + hash01(`s${c}-${i}`, 4) * 78
        nodes.push({ x: cx + Math.cos(a) * rad * 1.25, y: cy + Math.sin(a) * rad, r: i === 0 ? 8 : 4 + hash01(`s${c}-${i}`, 5) * 3, d: Math.round(hash01(`s${c}-${i}`, 6) * 1800) })
        if (i > 0) edges.push({ a: start + (i < 4 ? 0 : 1 + Math.floor(hash01(`e${c}-${i}`, 7) * 3)), b: start + i, d: nodes.length * 40 })
      }
    })
    return { nodes, edges }
  }, [])
  return (
    <div
      role="status" aria-label="Resolving dependency relationships"
      className="relative overflow-hidden rounded-r5 border border-white/[.08] bg-card shadow-card"
      style={{ height }}
    >
      <svg viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
        {edges.map((e, i) => (
          <line
            key={i} className="rg-sk-edge" pathLength={1}
            x1={nodes[e.a].x} y1={nodes[e.a].y} x2={nodes[e.b].x} y2={nodes[e.b].y}
            stroke="rgba(236,237,240,.16)" strokeWidth="1" style={{ animationDelay: `${e.d}ms` }}
          />
        ))}
        {nodes.map((n, i) => (
          <circle key={i} className="rg-sk-node" cx={n.x} cy={n.y} r={n.r} fill="rgb(var(--c-elevated))" stroke="rgba(236,237,240,.28)" strokeWidth="1.2" style={{ animationDelay: `${n.d}ms` }} />
        ))}
      </svg>
      <div className="absolute left-4 top-4 h-10 w-[260px] rounded-r2 border border-white/[.06] bg-white/[.03]" aria-hidden />
      <div className="absolute bottom-4 left-4 h-11 w-[300px] rounded-r3 border border-white/[.06] bg-white/[.03]" aria-hidden />
      <p className="absolute inset-x-0 bottom-5 text-center text-[12.5px] text-ink-3">Resolving dependency relationships…</p>
    </div>
  )
}
