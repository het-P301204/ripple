import { useEffect, type ReactNode } from 'react'
import { MotionConfig } from 'framer-motion'
import { useToast } from '@/components/ui/Toast'
import { autoReduceAnimations, startFpsGuard, useReducedMotion, userForcedFull, warmRoutes } from '@/lib/perf'

/** Outermost provider: framer-motion follows the app-level "Reduce animations" state (transforms/layout off, opacity kept). */
export function MotionRoot({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  return <MotionConfig reducedMotion={reduced ? 'always' : 'user'}>{children}</MotionConfig>
}

/**
 * Mount once below <ToastProvider>. Watches the frame rate while ambient animations run and, if it stays under 40 fps
 * for ~2s, switches the whole app to reduced animations (session only) with a single toast. Also warms lazy route chunks.
 */
export function PerfGuard() {
  const toast = useToast()
  const reduced = useReducedMotion()
  useEffect(() => { warmRoutes() }, [])
  useEffect(() => {
    if (reduced || userForcedFull()) return
    return startFpsGuard(() => {
      if (autoReduceAnimations()) toast.info('Animations reduced for smoother performance')
    })
  }, [reduced, toast])
  return null
}
