import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { EASE } from '@/lib/motion'

/**
 * Scan animation, driven by real progress (0..1 from JobStatus.progress / done-stage ratio):
 * lockfile -> parser -> dependency tree appears progressively -> registry connections ->
 * pulses along edges -> suspicious nodes highlight -> attack surface forms.
 * Purely presentational; subtle; static frame under reduced motion.
 */

interface N { id: number; x: number; y: number; parent: number | null; at: number }

function buildTree(): { nodes: N[]; leaves: number[] } {
  const nodes: N[] = []
  const root: N = { id: 0, x: 200, y: 115, parent: null, at: 0.06 }
  nodes.push(root)
  const l2 = 5, l3 = 10, l4 = 9
  const add = (count: number, x: number, spread: number, parentPool: number[], base: number) => {
    const ids: number[] = []
    for (let i = 0; i < count; i++) {
      const y = 115 + (i - (count - 1) / 2) * (spread / Math.max(1, count - 1)) + ((i * 7) % 5) - 2
      const id = nodes.length
      nodes.push({ id, x: x + ((i * 5) % 7) - 3, y, parent: parentPool[Math.floor((i / count) * parentPool.length)], at: base + (i / count) * 0.12 })
      ids.push(id)
    }
    return ids
  }
  const a = add(l2, 250, 150, [0], 0.1)
  const b = add(l3, 305, 190, a, 0.2)
  const c = add(l4, 358, 196, b, 0.3)
  return { nodes, leaves: c }
}

const REGS = [
  { label: 'npm', y: 34 }, { label: 'PyPI', y: 88 }, { label: 'Go', y: 142 }, { label: 'crates.io', y: 196 },
]
const SUSPICIOUS = [14, 9, 20, 5]

export function ScanViz({ progress, done, className }: { progress: number; done?: boolean; className?: string }) {
  const reduced = !!useReducedMotion()
  const { nodes, leaves } = useMemo(buildTree, [])
  const p = done ? 1 : Math.max(0, Math.min(1, progress))
  const regEdges = useMemo(() => leaves.map((id, i) => ({ from: id, to: i % 4, at: 0.42 + (i / leaves.length) * 0.22 })), [leaves])
  const sus = SUSPICIOUS.map((i) => nodes[i]).filter(Boolean)
  const cx = sus.reduce((a, n) => a + n.x, 0) / sus.length
  const cy = sus.reduce((a, n) => a + n.y, 0) / sus.length

  return (
    <svg viewBox="0 0 520 232" className={className} role="img" aria-label="Scan progress visualisation" fill="none">
      <defs>
        <radialGradient id="sv-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity=".28" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* lockfile */}
      <g transform="translate(22,88)">
        <rect width="34" height="44" rx="6" fill="#15171A" stroke="rgba(255,255,255,.16)" />
        {[10, 18, 26, 34].map((y, i) => <rect key={y} x="7" y={y - 3} width={i % 2 ? 16 : 20} height="2.5" rx="1.25" fill="rgba(255,255,255,.22)" />)}
      </g>
      <line x1="60" y1="110" x2="112" y2="110" stroke="rgba(255,255,255,.12)" strokeDasharray="2 4" />
      {!reduced && p > 0.02 && p < 0.98 && (
        <circle r="2.2" fill="#A78BFA"><animateMotion dur="1.3s" repeatCount="indefinite" path="M60,110 L112,110" /></circle>
      )}

      {/* parser */}
      <g transform="translate(112,92)">
        <rect width="52" height="36" rx="10" fill="#15171A" stroke={p > 0.04 ? 'rgba(167,139,250,.6)' : 'rgba(255,255,255,.14)'} style={{ transition: 'stroke 400ms' }} />
        <text x="26" y="22.5" textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono, monospace" fill="#B2B5BD">{'{ }'}</text>
      </g>
      <line x1="164" y1="110" x2="200" y2="115" stroke="rgba(255,255,255,.12)" />

      {/* tree edges + nodes */}
      {nodes.map((n) => {
        if (n.parent == null) return null
        const par = nodes[n.parent]
        return (
          <motion.line
            key={`e${n.id}`} x1={par.x} y1={par.y} x2={n.x} y2={n.y} stroke="rgba(255,255,255,.14)" strokeWidth="1"
            initial={false} animate={{ opacity: p >= n.at ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.4 }}
          />
        )
      })}
      {nodes.map((n) => {
        const visible = p >= n.at
        const hot = SUSPICIOUS.includes(n.id) && p > 0.72
        const col = hot ? (n.id % 2 ? '#F0506E' : '#F97316') : '#A78BFA'
        return (
          <motion.g key={`n${n.id}`} initial={false} animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.2 }} transition={{ duration: reduced ? 0 : 0.45, ease: EASE }} style={{ transformOrigin: `${n.x}px ${n.y}px`, transformBox: 'view-box' as never }}>
            {hot && !reduced && <circle cx={n.x} cy={n.y} r="9" fill={col} fillOpacity=".16" />}
            <circle cx={n.x} cy={n.y} r={n.parent == null ? 5 : 3.4} fill="#111316" stroke={col} strokeWidth="1.4" style={{ transition: 'stroke 500ms' }} />
          </motion.g>
        )
      })}

      {/* registry connections */}
      {regEdges.map((e, i) => {
        const a = nodes[e.from]
        const r = REGS[e.to]
        const d = `M${a.x},${a.y} C ${a.x + 40},${a.y} ${430 - 40},${r.y} 432,${r.y}`
        const on = p >= e.at
        return (
          <g key={`re${i}`}>
            <motion.path d={d} stroke="rgba(167,139,250,.28)" strokeWidth="1" initial={false} animate={{ opacity: on ? 1 : 0 }} transition={{ duration: reduced ? 0 : 0.5 }} />
            {on && !reduced && !done && i < 4 && (
              <circle r="2" fill="#C4B5FD">
                <animateMotion dur={`${1.6 + (i % 3) * 0.4}s`} begin={`${(i % 4) * 0.25}s`} repeatCount="indefinite" path={d} />
              </circle>
            )}
          </g>
        )
      })}
      {REGS.map((r, i) => {
        const on = p >= 0.42 + i * 0.05
        return (
          <g key={r.label} transform={`translate(432,${r.y - 11})`}>
            <motion.rect width="76" height="22" rx="11" fill="#15171A" stroke="rgba(255,255,255,.14)" initial={false}
              animate={{ opacity: on ? 1 : 0.35, stroke: on ? 'rgba(167,139,250,.5)' : 'rgba(255,255,255,.14)' }} transition={{ duration: 0.4 }} />
            <text x="38" y="14.6" textAnchor="middle" fontSize="10.5" fontFamily="Inter, sans-serif" fill={on ? '#ECEDF0' : '#585C65'}>{r.label}</text>
          </g>
        )
      })}

      {/* attack surface forms */}
      <motion.g initial={false} animate={{ opacity: p > 0.9 ? 1 : 0, scale: p > 0.9 ? 1 : 0.8 }} transition={{ duration: reduced ? 0 : 0.8, ease: EASE }} style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: 'view-box' as never }}>
        <circle cx={cx} cy={cy} r="58" fill="url(#sv-glow)" />
        <circle cx={cx} cy={cy} r="46" stroke="rgba(244,114,182,.5)" strokeDasharray="3 5" />
        {!reduced && <circle cx={cx} cy={cy} r="46" stroke="rgba(244,114,182,.5)" style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'net-pulse 3.2s cubic-bezier(0.22,1,0.36,1) 3 both' }} />}
      </motion.g>
    </svg>
  )
}
