import { type Transition, type Variants } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
/** Shared easing + duration tokens (mirror tokens.css). Seconds, for framer-motion. */
export const EASE = [0.22, 1, 0.36, 1] as const
export const DUR = { micro: 0.18, comp: 0.26, page: 0.3, hero: 0.55 } as const

export const tween = (duration: number = DUR.comp, delay = 0): Transition => ({ duration, ease: EASE, delay })
export const springSoft: Transition = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }

/** Route transition: opacity + 6px rise, 200ms, no exit and no blur (a filter on the whole page is what made navigation feel heavy). */
export const pageVariants = (reduced: boolean): Variants =>
  reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.1 } } }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE } },
      }

/** Parent that staggers children by 50-80ms. */
export const staggerParent = (stagger = 0.04, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: Math.min(stagger, 0.04), delayChildren: Math.min(delay, 0.05) } },
})

/** Card / list-item entrance. Use as child of staggerParent. */
export const itemVariants = (reduced: boolean): Variants =>
  reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.1 } } }
    : { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: tween(DUR.page) } }

/** Modal panel: scale .98 -> 1 + fade. */
export const modalVariants = (reduced: boolean): Variants =>
  reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.98, y: 6 },
        animate: { opacity: 1, scale: 1, y: 0, transition: tween(DUR.comp) },
        exit: { opacity: 0, scale: 0.985, y: 4, transition: tween(0.18) },
      }

export const backdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.22 } },
  exit: { opacity: 0, transition: { duration: 0.18 } },
}

/** Side drawer slide. `side` is which edge it hugs. */
export const drawerVariants = (side: 'left' | 'right', reduced: boolean): Variants => {
  const x = side === 'left' ? '-100%' : '100%'
  return reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { x, opacity: 0.6 },
        animate: { x: 0, opacity: 1, transition: tween(DUR.comp + 0.05) },
        exit: { x, opacity: 0.6, transition: tween(0.22) },
      }
}

/** Small popover (dropdown, tooltip). */
export const popVariants = (reduced: boolean): Variants =>
  reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, scale: 0.97, y: -4 },
        animate: { opacity: 1, scale: 1, y: 0, transition: tween(DUR.micro) },
        exit: { opacity: 0, scale: 0.98, transition: tween(0.12) },
      }

/** Convenience hook: memoisation is unnecessary, these are cheap. */
export function useMotion() {
  const reduced = !!useReducedMotion()
  return {
    reduced,
    page: pageVariants(reduced),
    item: itemVariants(reduced),
    modal: modalVariants(reduced),
    pop: popVariants(reduced),
  }
}
