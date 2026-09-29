import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRipple } from '@/lib/store'
import { EASE } from '@/lib/motion'
import { useReducedMotion } from '@/lib/perf'

const SESSION_KEY = 'ripple.booted'
const seen = () => { try { return sessionStorage.getItem(SESSION_KEY) === '1' } catch { return false } }
const mark = () => { try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* ignore */ } }

type Phase = 'intro' | 'ready' | 'reveal' | 'done'

/** Timing budget (ms): min 1100 / hard cap 1400 to "ready", +200 hold, +380 reveal => ~1.7-2.0s total. */
const MIN_MS = 1100
const CAP_MS = 1400
const HOLD_MS = 200
const REVEAL_MS = 380

const STATUS = ['INITIALIZING SECURITY ENGINE', 'ANALYZING TRUST BOUNDARIES', 'RIPPLE READY']

/**
 * Boot sequence: point -> ripple -> rings -> wordmark -> status line -> fade into the app.
 * Gated on the store's health/history load (`ready`) but never longer than ~2s; works with the API down.
 * Shown once per session. Click or any key skips. Reduced motion / reduced animations: no sequence, just a short fade.
 *
 * Perf: everything animates opacity or transform only (no blur filters, no letter-spacing/layout animation, no clip-path or mask
 * on a full-viewport layer). The app is mounted underneath while the overlay is on its `hold` beat, so its first render does not
 * compete with the reveal, and the whole overlay unmounts when the reveal finishes.
 */
export function LoadingGate({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const { ready } = useRipple()
  const [phase, setPhase] = useState<Phase>(() => (seen() || reduced ? 'done' : 'intro'))
  const [statusIdx, setStatusIdx] = useState(0)
  const t0 = useRef(performance.now())
  const startedReveal = useRef(false)

  const finish = useCallback(() => { mark(); setPhase('done') }, [])
  const reveal = useCallback(() => {
    if (startedReveal.current) return
    startedReveal.current = true
    setPhase('reveal')
  }, [])

  // status cycling
  useEffect(() => {
    if (phase !== 'intro') return
    const t = window.setTimeout(() => setStatusIdx(1), 560)
    return () => window.clearTimeout(t)
  }, [phase])

  // gate on health/demo load, with hard cap
  useEffect(() => {
    if (phase !== 'intro') return
    const elapsed = performance.now() - t0.current
    const wait = ready ? Math.max(0, MIN_MS - elapsed) : Math.max(0, CAP_MS - elapsed)
    const t = window.setTimeout(() => { setStatusIdx(2); setPhase('ready') }, wait)
    return () => window.clearTimeout(t)
  }, [ready, phase])

  useEffect(() => {
    if (phase !== 'ready') return
    const t = window.setTimeout(reveal, HOLD_MS)
    return () => window.clearTimeout(t)
  }, [phase, reveal])

  // the OS / app preference can flip while the overlay is up: drop it straight away
  useEffect(() => { if (reduced && phase !== 'done') { mark(); setPhase('done') } }, [reduced, phase])

  // skip
  useEffect(() => {
    if (phase === 'done' || phase === 'reveal') return
    const skip = () => { setStatusIdx(2); reveal() }
    window.addEventListener('keydown', skip)
    return () => window.removeEventListener('keydown', skip)
  }, [phase, reveal])

  // NB: same element shape in every 'done' state, so flipping reduced animations at runtime never remounts the app
  if (phase === 'done') return <>{children}</>

  const letters = 'RIPPLE'.split('')
  const grow = Math.hypot(window.innerWidth, window.innerHeight) / 160
  return (
    <>
      {(phase === 'ready' || phase === 'reveal') && children}
      <motion.div
        role="status" aria-label="Loading RIPPLE" onClick={() => { setStatusIdx(2); reveal() }}
        className="fixed inset-0 z-[200] cursor-pointer overflow-hidden bg-[#050506]"
        initial={false}
        animate={{ opacity: phase === 'reveal' ? 0 : 1 }}
        transition={{ duration: phase === 'reveal' ? REVEAL_MS / 1000 : 0, ease: EASE }}
        onAnimationComplete={() => { if (phase === 'reveal') finish() }}
      >
        <div className="absolute inset-0" style={{ background: 'radial-gradient(40% 40% at 50% 46%, rgba(139,92,246,.10), transparent 70%)' }} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* point -> ripple -> rings */}
          <div className="relative grid h-[280px] w-[280px] place-items-center">
            {[0, 1, 2, 3].map((i) => (
              <motion.span
                key={i} aria-hidden
                className="absolute inset-0 rounded-full border"
                style={{ borderColor: i % 2 ? 'rgba(244,114,182,.55)' : 'rgba(167,139,250,.65)' }}
                initial={{ scale: 0.02, opacity: 0 }}
                animate={{ scale: [0.02, 0.45 + i * 0.18, 0.55 + i * 0.2], opacity: [0, 0.75, 0.16 - i * 0.02] }}
                transition={{ duration: 1.1, delay: 0.1 + i * 0.12, ease: EASE, times: [0, 0.35, 1] }}
              />
            ))}
            <motion.span
              aria-hidden
              className="h-[7px] w-[7px] rounded-full bg-[#C4B5FD]"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.6, 1], opacity: 1 }} transition={{ duration: 0.4, ease: EASE }}
            />
          </div>
          {/* wordmark: opacity + rise only (fixed tracking, no filter, no layout animation) */}
          <h1
            aria-label="RIPPLE"
            className="mt-2 flex text-[26px] font-medium tracking-[0.55em] text-white sm:text-[30px]"
            style={{ paddingLeft: '0.55em' }}
          >
            {letters.map((l, i) => (
              <motion.span
                key={i} aria-hidden
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.3 + i * 0.05, ease: EASE }}
              >
                {l}
              </motion.span>
            ))}
          </h1>
          {/* status line */}
          <div className="mt-7 h-4 text-[10.5px] font-medium tracking-[.28em] text-ink-3">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={statusIdx}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
                className={statusIdx === 2 ? 'text-accent-soft' : ''}
              >
                {STATUS[statusIdx]}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-6 text-center text-[10.5px] tracking-[.2em] text-ink-4">PRESS ANY KEY TO SKIP</div>
        {phase === 'reveal' && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -ml-20 -mt-20 h-40 w-40 rounded-full border border-accent-soft/60"
            initial={{ scale: 0.4, opacity: 0.7 }} animate={{ scale: grow, opacity: 0 }} transition={{ duration: REVEAL_MS / 1000, ease: EASE }}
          />
        )}
      </motion.div>
    </>
  )
}
