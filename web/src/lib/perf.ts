import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'

/**
 * Runtime performance + motion policy.
 *
 * - `reduced animations` is an app-level switch (Settings, Topbar quick toggle, FPS guard). When on, <html data-motion="reduced">
 *   is set: ambient/infinite animations are dropped, animation/transition durations collapse (see globals.css) and framer-motion
 *   runs with reducedMotion="always" (MotionRoot).
 * - Default: ON when the device looks weak (hardwareConcurrency <= 4 or deviceMemory <= 4) or the OS asks for reduced motion.
 * - Persisted to localStorage['ripple.motion'] = 'reduced' | 'full' (an explicit 'full' also disables the FPS guard).
 * - The FPS guard (see startFpsGuard) flips to reduced for the rest of the session when sustained frame rate is < 40 fps.
 */

const KEY = 'ripple.motion'
const AUTO_KEY = 'ripple.motion.auto'

const lsGet = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const lsSet = (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* ignore */ } }
const ssGet = (k: string) => { try { return sessionStorage.getItem(k) } catch { return null } }
const ssSet = (k: string, v: string) => { try { sessionStorage.setItem(k, v) } catch { /* ignore */ } }

export type MotionPref = 'reduced' | 'full' | null

const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { deviceMemory?: number }) | undefined
export const weakDevice = (): boolean => {
  if (!nav) return false
  const cores = nav.hardwareConcurrency
  const mem = nav.deviceMemory
  return (typeof cores === 'number' && cores > 0 && cores <= 4) || (typeof mem === 'number' && mem > 0 && mem <= 4)
}

const osQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

let pref: MotionPref = ((): MotionPref => {
  const v = lsGet(KEY)
  return v === 'reduced' || v === 'full' ? v : null
})()
let auto = ssGet(AUTO_KEY) === '1'

const computeSetting = (): boolean => (pref ? pref === 'reduced' : auto || weakDevice())
const computeEffective = (): boolean => computeSetting() || !!osQuery?.matches

let effective = computeEffective()
const listeners = new Set<() => void>()

function apply() {
  const next = computeEffective()
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-motion', next ? 'reduced' : 'full')
  // the setting itself may change without the effective value changing (e.g. OS forces reduced): still notify toggle UIs
  effective = next
  listeners.forEach((l) => l())
}
apply()
osQuery?.addEventListener?.('change', apply)

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Effective reduced state (user setting OR OS preference OR auto-reduced). */
export const isReducedMotion = () => effective
/** Just the app-level setting (what the toggle shows). */
export const getMotionSetting = () => computeSetting()
export const osPrefersReduced = () => !!osQuery?.matches

/** Set the "Reduce animations" setting explicitly (persisted). */
export function setReducedAnimations(on: boolean) {
  pref = on ? 'reduced' : 'full'
  lsSet(KEY, pref)
  auto = false
  ssSet(AUTO_KEY, '0')
  apply()
}

/** Called by the FPS guard: reduce for this session only (not persisted, never overrides an explicit choice). */
export function autoReduceAnimations() {
  if (pref === 'full' || effective) return false
  auto = true
  ssSet(AUTO_KEY, '1')
  apply()
  return true
}

/** True when the user has explicitly chosen full animations (FPS guard stays out of the way). */
export const userForcedFull = () => pref === 'full'

/** Drop-in replacement for framer-motion's useReducedMotion(): honours OS pref, the app setting and the FPS guard. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, isReducedMotion, () => false)
}
export const useReducedAnimations = useReducedMotion

/** [setting, setter] for the toggle UI. */
export function useMotionSetting(): { reduced: boolean; setting: boolean; os: boolean; set: (on: boolean) => void } {
  useSyncExternalStore(subscribe, () => `${effective}|${computeSetting()}`, () => '')
  return { reduced: effective, setting: computeSetting(), os: osPrefersReduced(), set: setReducedAnimations }
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Visibility helpers: pause ambient loops when the tab is hidden or the element is off-screen.                      */
/* ---------------------------------------------------------------------------------------------------------------- */

/** true while the element intersects the viewport AND the tab is visible. */
export function useAmbientActive<T extends Element>(ref: RefObject<T>): boolean {
  const [inView, setInView] = useState(true)
  const [tabVisible, setTabVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden))
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => { for (const e of es) setInView(e.isIntersecting) }, { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  useEffect(() => {
    const on = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return inView && tabVisible
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* FPS guard                                                                                                        */
/* ---------------------------------------------------------------------------------------------------------------- */

export interface FpsGuardOptions {
  /** frame-rate floor (default 40) */
  minFps?: number
  /** consecutive bad 1s windows needed to trip (default 2, i.e. ~2s sustained) */
  windows?: number
  /** ignore the first N ms (boot, lazy chunks, loading screen) (default 4000) */
  warmupMs?: number
}

/**
 * rAF-samples the frame rate while ambient animations run. Trips `onTrip` once when fps < minFps for `windows` consecutive
 * 1-second windows. Windows that include a hidden tab or a >500ms stall (debugger, background throttling) are discarded.
 * Only runs while animations are not reduced; stops itself after tripping.
 */
export function startFpsGuard(onTrip: () => void, opts: FpsGuardOptions = {}): () => void {
  const minFps = opts.minFps ?? 40
  const need = opts.windows ?? 2
  const warm = opts.warmupMs ?? 4000
  let raf = 0
  let stopped = false
  let start = 0
  let winStart = 0
  let frames = 0
  let bad = 0
  let last = 0
  let tainted = false

  const reset = () => { winStart = 0; frames = 0; bad = 0; tainted = true }
  const onVis = () => reset()
  document.addEventListener('visibilitychange', onVis)

  const tick = (t: number) => {
    if (stopped) return
    if (!start) start = t
    if (document.hidden) { reset(); last = 0; raf = requestAnimationFrame(tick); return }
    if (last && t - last > 500) tainted = true
    last = t
    if (t - start < warm) { raf = requestAnimationFrame(tick); return }
    if (!winStart || tainted) { winStart = t; frames = 0; tainted = false; raf = requestAnimationFrame(tick); return }
    frames++
    const el = t - winStart
    if (el >= 1000) {
      const fps = (frames * 1000) / el
      bad = fps < minFps ? bad + 1 : 0
      winStart = t
      frames = 0
      if (bad >= need) { stop(); onTrip(); return }
    }
    raf = requestAnimationFrame(tick)
  }
  const stop = () => {
    stopped = true
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVis)
  }
  raf = requestAnimationFrame(tick)
  return stop
}

/** Warm the lazy route chunks once the app is idle so navigation never waits on the network/parse. */
export function warmRoutes() {
  const run = () => {
    void import('@/pages/Findings')
    void import('@/pages/Packages')
    void import('@/pages/AttackSurface')
    void import('@/pages/Typosquatting')
    void import('@/pages/Ecosystems')
    void import('@/pages/History')
    void import('@/pages/Reports')
    void import('@/pages/Settings')
    void import('@/pages/FindingDetail')
    // the graph chunk (d3-force) is the heaviest: fetch it last
    window.setTimeout(() => { void import('@/pages/DependencyGraph') }, 1500)
  }
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(run, { timeout: 4000 })
  else window.setTimeout(run, 2500)
}
