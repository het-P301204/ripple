import { useEffect, useId, useMemo, useState } from 'react'
import { animate } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { EASE } from '@/lib/motion'
import { cn } from '@/lib/cn'

/** Circular determinate progress ring. value 0..1 */
export function ProgressRing({
  value, size = 44, stroke = 4, className, children, color = 'rgb(var(--c-accent-soft))',
}: { value: number; size?: number; stroke?: number; className?: string; children?: React.ReactNode; color?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className={cn('relative inline-grid place-items-center', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          style={{ transition: 'stroke-dashoffset 500ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      {children != null && <div className="absolute inset-0 grid place-items-center">{children}</div>}
    </div>
  )
}

/** Horizontal determinate bar. value 0..1. */
export function ProgressBar({ value, className, tone = 'accent', height = 6, label }: { value: number; className?: string; tone?: 'accent' | 'ok' | 'danger'; height?: number; label?: string }) {
  const bg = tone === 'ok' ? 'rgb(var(--c-ok))' : tone === 'danger' ? 'rgb(var(--sev-critical))' : 'linear-gradient(90deg, rgb(var(--c-accent)), rgb(var(--c-magenta-soft)))'
  return (
    <div
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-label={label}
      className={cn('w-full overflow-hidden rounded-full bg-white/[.06]', className)} style={{ height }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: bg, transition: 'width 380ms cubic-bezier(0.22,1,0.36,1)' }}
      />
    </div>
  )
}

/**
 * The hero dial: 72 tick marks around a ring that light up to the score as it counts 0 -> value.
 * Children render in the centre (number + label). `onValue` gives the live animated value.
 */
export function RadialScore({
  value, size = 232, duration = 1.2, delay = 0.25, children,
}: { value: number; size?: number; duration?: number; delay?: number; children?: (n: number) => React.ReactNode }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(reduced ? value : 0)
  const gid = useId().replace(/:/g, '')
  useEffect(() => {
    if (reduced) { setN(value); return }
    // integer steps only: one render per whole-number step instead of one per frame
    const c = animate(0, value, { duration: Math.min(duration, 0.9), delay: Math.min(delay, 0.2), ease: EASE, onUpdate: (v) => setN((p) => (Math.round(v) === Math.round(p) ? p : Math.round(v))) })
    return () => c.stop()
  }, [value, duration, delay, reduced])

  const TICKS = 72
  const lit = Math.round((n / 100) * TICKS)
  const cx = size / 2
  const rOuter = size / 2 - 6
  const rInner = rOuter - 14
  const ticks = useMemo(() => (
    <>
          {Array.from({ length: TICKS }).map((_, i) => {
            const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2
            const on = i < lit
            const major = i % 6 === 0
            const r2 = major ? rInner - 4 : rInner
            return (
              <line
                key={i}
                x1={cx + Math.cos(a) * r2} y1={cx + Math.sin(a) * r2}
                x2={cx + Math.cos(a) * rOuter} y2={cx + Math.sin(a) * rOuter}
                stroke={on ? `url(#g${gid})` : 'rgba(255,255,255,.085)'}
                strokeWidth={major ? 2.4 : 1.8} strokeLinecap="round"
              />
            )
          })}
      </>
  ), [lit, cx, rInner, rOuter, gid])
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Risk score ${Math.round(value)} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0">
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#A78BFA" />
            <stop offset="100%" stopColor="#F472B6" />
          </linearGradient>
        </defs>
        {ticks}
      </svg>
      <div className="relative z-10 text-center">{children?.(n)}</div>
    </div>
  )
}

/** Tiny inline trend line. values length >= 2. */
export function Sparkline({
  values, width = 84, height = 28, className, color = 'rgb(var(--c-accent-soft))',
}: { values: number[]; width?: number; height?: number; className?: string; color?: string }) {
  const gid = useId().replace(/:/g, '')
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 3 - ((v - min) / span) * (height - 6)])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const area = `${d} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <defs>
        <linearGradient id={`s${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#s${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill={color} />
    </svg>
  )
}

/** Segmented mini-bar (e.g. severity distribution) — parts: [{value,color}] */
export function MicroBar({ parts, height = 5, className }: { parts: Array<{ value: number; color: string }>; height?: number; className?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div className={cn('flex w-full gap-[2px] overflow-hidden rounded-full', className)} style={{ height }} aria-hidden>
      {parts.filter((p) => p.value > 0).map((p, i) => (
        <div key={i} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="rounded-full" />
      ))}
    </div>
  )
}
