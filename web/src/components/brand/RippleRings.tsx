import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { useAmbientActive, useReducedMotion } from '@/lib/perf'

/**
 * Ambient concentric waves radiating from the centre of the parent (must be `relative`).
 * Purely decorative. Transform/opacity keyframes only (compositor), capped at 3 rings, paused while off-screen or the tab is
 * hidden, and a static pair of rings under reduced motion. `contain: paint` keeps the rings from invalidating the page.
 */
export function RippleRings({
  rings = 3, period = 8, color = 'rgb(var(--c-accent))', maxOpacity = 0.4, className, size = 560,
}: { rings?: number; period?: number; color?: string; maxOpacity?: number; className?: string; size?: number }) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const active = useAmbientActive(ref)
  const n = Math.min(3, rings)
  return (
    <div
      ref={ref} aria-hidden
      className={cn('pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2', className)}
      style={{ width: size, height: size, contain: 'layout paint' }}
    >
      {Array.from({ length: reduced ? 2 : n }).map((_, i) => (
        <span
          key={i}
          className="absolute inset-0 rounded-full"
          style={{
            border: `1px solid ${color}`,
            opacity: reduced ? 0.12 + i * 0.05 : 0,
            transform: reduced ? `scale(${0.5 + i * 0.25})` : undefined,
            animation: reduced ? undefined : `ripple-ring ${period}s cubic-bezier(0.22,1,0.36,1) ${(i * period) / n}s infinite`,
            animationPlayState: active ? 'running' : 'paused',
            willChange: reduced || !active ? undefined : 'transform, opacity',
            ['--ring-max' as string]: maxOpacity,
          }}
        />
      ))}
    </div>
  )
}
