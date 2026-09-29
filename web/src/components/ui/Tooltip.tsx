import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'

/**
 * Graphite tooltip, opens on hover/focus after ~120ms. Wrap a single focusable child.
 * Use for explaining metrics ("Risk score weights…").
 */
export function Tooltip({
  content, children, side = 'top', delay = 120, maxWidth = 260,
}: { content: ReactNode; children: ReactElement; side?: 'top' | 'bottom'; delay?: number; maxWidth?: number }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; place: 'top' | 'bottom' }>({ x: 0, y: 0, place: side })
  const ref = useRef<HTMLElement | null>(null)
  const timer = useRef<number>()
  const id = useId()
  const reduced = !!useReducedMotion()

  const show = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(true), delay) }
  const hide = () => { window.clearTimeout(timer.current); setOpen(false) }

  // WCAG 1.4.13: dismissible with Escape without moving focus; and never leave a pending timer behind on unmount
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const place = side === 'top' && r.top < 90 ? 'bottom' : side
    const x = Math.min(Math.max(r.left + r.width / 2, maxWidth / 2 + 8), window.innerWidth - maxWidth / 2 - 8)
    setPos({ x, y: place === 'top' ? r.top - 8 : r.bottom + 8, place })
  }, [open, side, maxWidth])

  const child = cloneElement(children, {
    ref: (n: HTMLElement | null) => {
      ref.current = n
      const r = (children as unknown as { ref?: React.Ref<HTMLElement> }).ref
      if (typeof r === 'function') r(n)
      else if (r && typeof r === 'object') (r as React.MutableRefObject<HTMLElement | null>).current = n
    },
    onMouseEnter: (e: React.MouseEvent) => { show(); children.props.onMouseEnter?.(e) },
    onMouseLeave: (e: React.MouseEvent) => { hide(); children.props.onMouseLeave?.(e) },
    onFocus: (e: React.FocusEvent) => { show(); children.props.onFocus?.(e) },
    onBlur: (e: React.FocusEvent) => { hide(); children.props.onBlur?.(e) },
    'aria-describedby': open ? id : children.props['aria-describedby'],
  } as never)

  return (
    <>
      {child}
      {/* lazy: nothing is mounted (no portal, no AnimatePresence) until the tooltip is actually open */}
      {open && createPortal(
        <motion.div
          id={id} role="tooltip"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduced ? 0.06 : 0.12 }}
          style={{
            position: 'fixed', left: pos.x, top: pos.y, maxWidth, zIndex: 120, pointerEvents: 'none',
            transform: `translate(-50%, ${pos.place === 'top' ? '-100%' : '0'})`,
          }}
          className="rounded-r2 border border-white/[.1] bg-elevated px-3 py-2 text-[12px] leading-relaxed text-ink-2 shadow-pop"
        >
          {content}
        </motion.div>,
        document.body,
      )}
    </>
  )
}
