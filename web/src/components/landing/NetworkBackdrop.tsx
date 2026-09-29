import { useEffect, useMemo, useRef } from 'react'
import { useReducedMotion } from '@/lib/perf'

/**
 * Landing backdrop: a quiet dependency network. Nodes are static; an occasional ripple passes through and briefly lights nearby
 * nodes, and bumping `burst` fires a big ripple from the centre (the "expands into the scanner" moment).
 *
 * Perf: there is NO idle loop. requestAnimationFrame only runs while a ripple is in flight (~2.5s every 7-10s, ~1s for a burst),
 * at 30fps for ambient ripples, and never while the tab is hidden or the backdrop is scrolled out of view. The edge fade is a
 * static gradient overlay rather than a CSS mask (a mask forces the whole animated SVG through an offscreen pass every frame).
 */
interface Node { x: number; y: number; r: number }

function build() {
  let s = 0x9e3779b9
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000 }
  const nodes: Node[] = Array.from({ length: 30 }).map(() => ({ x: 30 + rnd() * 940, y: 30 + rnd() * 540, r: 1.6 + rnd() * 2.2 }))
  const edges: Array<[number, number]> = []
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .filter((o) => o.j > i && o.d < 190)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .forEach((o) => edges.push([i, o.j]))
  })
  return { nodes, edges }
}

interface Ripple { x: number; y: number; t0: number; speed: number; max: number; fast: boolean }

export function NetworkBackdrop({ burst = 0, className }: { burst?: number; className?: string }) {
  const reduced = useReducedMotion()
  const { nodes, edges } = useMemo(build, [])
  const svgRef = useRef<SVGSVGElement>(null)
  const nodeRefs = useRef<Array<SVGCircleElement | null>>([])
  const ringRef = useRef<SVGCircleElement>(null)
  const start = useRef<(r?: Ripple) => void>(() => {})
  const lastBurst = useRef(burst)

  useEffect(() => {
    if (reduced) return
    let raf = 0
    let timer = 0
    let visible = true
    let rp: Ripple | null = null
    let lastPaint = 0

    const paint = (t: number) => {
      const radius = rp ? (t - rp.t0) * rp.speed : -1
      nodes.forEach((n, i) => {
        const el = nodeRefs.current[i]
        if (!el) return
        let glow = 0
        if (rp && radius >= 0) {
          const d = Math.hypot(n.x - rp.x, n.y - rp.y)
          glow = Math.max(0, 1 - Math.abs(d - radius) / 60) * (1 - radius / rp.max)
        }
        el.setAttribute('r', (n.r + glow * 3).toFixed(2))
        el.setAttribute('fill-opacity', (0.32 + glow * 0.68).toFixed(2))
      })
      const ring = ringRef.current
      if (ring) {
        if (rp && radius >= 0) {
          ring.setAttribute('cx', String(rp.x)); ring.setAttribute('cy', String(rp.y))
          ring.setAttribute('r', radius.toFixed(1))
          ring.setAttribute('stroke-opacity', (0.35 * (1 - radius / rp.max)).toFixed(3))
        } else ring.setAttribute('stroke-opacity', '0')
      }
    }

    const frame = (t: number) => {
      raf = 0
      if (!rp) return
      // ambient ripples run at ~30fps; a user-triggered burst keeps full rate
      if (rp.fast || t - lastPaint >= 32) { lastPaint = t; paint(t) }
      if ((t - rp.t0) * rp.speed > rp.max) {
        rp = null
        paint(t)
        schedule()
        return
      }
      raf = requestAnimationFrame(frame)
    }

    /** queue the next ambient ripple */
    function schedule() {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (rp) return
        if (!visible || document.hidden) { schedule(); return }
        const n = nodes[Math.floor(Math.random() * nodes.length)]
        run({ x: n.x, y: n.y, t0: performance.now(), speed: 0.16, max: 420, fast: false })
      }, 6500 + Math.random() * 3000)
    }
    function run(r: Ripple) {
      rp = r
      if (!raf) raf = requestAnimationFrame(frame)
    }
    start.current = (r) => { if (r) { window.clearTimeout(timer); run(r) } }

    const io = typeof IntersectionObserver !== 'undefined' && svgRef.current
      ? new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting) })
      : null
    if (io && svgRef.current) io.observe(svgRef.current)
    schedule()
    // first ripple soon after mount so the backdrop feels alive without waiting ~8s
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { if (!rp && visible && !document.hidden) run({ x: 500, y: 300, t0: performance.now(), speed: 0.16, max: 420, fast: false }); else schedule() }, 1800)

    return () => { cancelAnimationFrame(raf); window.clearTimeout(timer); io?.disconnect() }
  }, [nodes, reduced])

  useEffect(() => {
    if (burst !== lastBurst.current) {
      lastBurst.current = burst
      if (!reduced) start.current({ x: 500, y: 300, t0: performance.now(), speed: 0.9, max: 1000, fast: true })
    }
  }, [burst, reduced])

  return (
    <div className={`relative ${className ?? ''}`}>
      <svg ref={svgRef} aria-hidden viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" fill="none" className="absolute inset-0 h-full w-full">
        {edges.map(([a, b], i) => (
          <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y} stroke="rgba(167,139,250,.16)" strokeWidth="1" />
        ))}
        <circle ref={ringRef} stroke="#A78BFA" strokeWidth="1.2" fill="none" strokeOpacity="0" />
        {nodes.map((n, i) => <circle key={i} ref={(el) => { nodeRefs.current[i] = el }} cx={n.x} cy={n.y} r={n.r} fill="#C4B5FD" fillOpacity=".32" />)}
      </svg>
      <div
        aria-hidden className="absolute inset-0"
        style={{ background: 'radial-gradient(75% 85% at 50% 45%, transparent 30%, rgb(var(--c-bg)) 100%)' }}
      />
    </div>
  )
}
