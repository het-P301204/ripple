import { useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { tween } from '@/lib/motion'

/** Collapsible content panel: rounded card, icon + title header button, animated height body. */
export function Panel({
  title, description, icon, action, defaultOpen = true, children, className, bodyClassName,
}: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const reduced = !!useReducedMotion()
  const uid = useId().replace(/:/g, '')
  return (
    <section aria-labelledby={`${uid}-t`} className={cn('rounded-r4 border border-hair bg-card shadow-card', className)}>
      <div className="flex items-center gap-3 px-5 py-4 md:px-6">
        <button
          type="button" id={`${uid}-t`} aria-expanded={open} aria-controls={`${uid}-b`} onClick={() => setOpen((o) => !o)}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-r2 text-left"
        >
          {icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-r1 border border-white/[.07] bg-white/[.03] text-ink-3 transition-colors duration-micro group-hover:text-ink-2">
              {icon}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</span>
            {description && <span className="mt-0.5 block text-[12.5px] text-ink-3">{description}</span>}
          </span>
          <ChevronDown size={16} aria-hidden className={cn('ml-auto shrink-0 text-ink-3 transition-transform duration-comp ease-ripple group-hover:text-ink-2', open && 'rotate-180')} />
        </button>
        {action}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${uid}-b`} key="body"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1, transition: tween(0.34) }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, transition: tween(0.22) }}
            className="overflow-hidden"
          >
            <div className={cn('border-t border-white/[.05] px-5 py-5 md:px-6', bodyClassName)}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
