import { useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { backdropVariants, drawerVariants, modalVariants } from '@/lib/motion'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface OverlayProps {
  open: boolean
  onClose: () => void
  title?: string
  /** aria-label when there is no visible title */
  label?: string
  children: ReactNode
  className?: string
  /** hide the built-in close button */
  hideClose?: boolean
  /** disable backdrop click / Esc dismissal (e.g. mid-scan) */
  dismissible?: boolean
}

function Panel({
  children, onClose, title, label, className, hideClose, dismissible = true, kind, side = 'left',
}: Omit<OverlayProps, 'open'> & { kind: 'modal' | 'drawer'; side?: 'left' | 'right' }) {
  const reduced = !!useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const close = () => { if (dismissible) onClose() }
  useFocusTrap(ref, true, close)
  return (
    <div className={cn('fixed inset-0 z-[80] flex', kind === 'modal' ? 'items-center justify-center p-3 sm:p-6' : side === 'left' ? 'justify-start' : 'justify-end')}>
      <motion.div
        variants={backdropVariants} initial="initial" animate="animate" exit="exit"
        className="absolute inset-0 bg-black/70" onClick={close} aria-hidden
      />
      <motion.div
        ref={ref}
        role="dialog" aria-modal="true" aria-label={title ?? label} tabIndex={-1}
        variants={kind === 'modal' ? modalVariants(reduced) : drawerVariants(side, reduced)}
        initial="initial" animate="animate" exit="exit"
        className={cn(
          'relative flex max-h-full flex-col overflow-hidden border border-white/[.09] bg-elevated shadow-pop',
          kind === 'modal' ? 'w-full rounded-r5' : 'h-full w-[min(88vw,300px)] rounded-none border-y-0 ' + (side === 'left' ? 'rounded-r-[24px] border-l-0' : 'rounded-l-[24px] border-r-0'),
          className,
        )}
      >
        {!hideClose && (
          <button
            type="button" onClick={close} aria-label="Close"
            className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-r2 text-ink-3 transition-colors hover:bg-white/[.06] hover:text-ink"
          >
            <X size={18} />
          </button>
        )}
        {children}
      </motion.div>
    </div>
  )
}

/** Centered dialog: backdrop blur, scale .98->1 fade, focus trap, Esc, 24px radius. */
export function Modal({ open, className, ...rest }: OverlayProps) {
  return createPortal(
    <AnimatePresence>{open && <Panel key="modal" kind="modal" className={cn('max-w-lg', className)} {...rest} />}</AnimatePresence>,
    document.body,
  )
}

/** Edge drawer (used for mobile nav). */
export function Drawer({ open, side = 'left', className, ...rest }: OverlayProps & { side?: 'left' | 'right' }) {
  return createPortal(
    <AnimatePresence>{open && <Panel key="drawer" kind="drawer" side={side} className={className} {...rest} />}</AnimatePresence>,
    document.body,
  )
}
