import { useEffect, useLayoutEffect, useRef } from 'react'
import { animate } from 'framer-motion'
import { EASE } from '@/lib/motion'
import { useReducedMotion } from '@/lib/perf'

/**
 * Animates 0 -> value (short). Snaps immediately under reduced motion.
 * Perf: the animation writes textContent directly on the span (no React state, so zero re-renders per frame); React never owns
 * the span's children, so it cannot fight the DOM writes.
 */
export function CountUp({
  value, duration = 1.0, delay = 0, decimals = 0, className, format,
}: { value: number; duration?: number; delay?: number; decimals?: number; className?: string; format?: (n: number) => string }) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(reduced ? value : 0)
  const fmt = useRef(format)
  fmt.current = format
  const text = (n: number) => (fmt.current ? fmt.current(n) : decimals ? n.toFixed(decimals) : Math.round(n).toLocaleString('en-US'))

  useLayoutEffect(() => { if (ref.current) ref.current.textContent = text(from.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (reduced) { from.current = value; el.textContent = text(value); return }
    const c = animate(from.current, value, {
      duration: Math.min(duration, 0.8), delay: Math.min(delay, 0.4), ease: EASE,
      onUpdate: (v) => { from.current = v; el.textContent = text(v) },
      onComplete: () => { from.current = value; el.textContent = text(value) },
    })
    return () => c.stop()
  }, [value, duration, delay, reduced, decimals]) // eslint-disable-line react-hooks/exhaustive-deps

  return <span ref={ref} className={className} style={{ fontVariantNumeric: 'tabular-nums' }} suppressHydrationWarning />
}
