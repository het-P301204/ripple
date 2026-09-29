import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { springSoft } from '@/lib/motion'

/** aria-describedby for a Field: help always, error when present. */
export const describedBy = (id: string, hasError: boolean) => (hasError ? `${id}-help ${id}-err` : `${id}-help`)

/** Label + control + help/error, wired for assistive tech. The control must use `id` and `describedBy(id, …)`. */
export function Field({
  id, label, help, error, action, children, className,
}: { id: string; label: ReactNode; help?: ReactNode; error?: string | null; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">{label}</label>
        {action}
      </div>
      {children}
      {help && <p id={`${id}-help`} className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{help}</p>}
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-relaxed text-sev-critical">
          <AlertCircle size={13} className="mt-[3px] shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  )
}

/** A row inside a settings card: text on the left, control on the right (stacked on mobile). */
export function SettingRow({
  title, description, children, id, className,
}: { title: ReactNode; description?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <div className={cn('grid gap-4 border-t border-white/[.05] py-5 first:border-t-0 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-8', className)}>
      <div>
        <h3 id={id} className="text-[13.5px] font-medium tracking-normal text-ink">{title}</h3>
        {description && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export interface RadioOption<T extends string | number> { value: T; label: ReactNode; ariaLabel?: string }

/** Segmented control with true radiogroup semantics (arrow keys move + select, roving tabindex). */
export function RadioSegmented<T extends string | number>({
  options, value, onChange, ariaLabelledBy, ariaLabel, describedById, className,
}: {
  options: RadioOption<T>[]
  value: T
  onChange: (v: T) => void
  ariaLabelledBy?: string
  ariaLabel?: string
  describedById?: string
  className?: string
}) {
  const gid = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const n = (i + dir + options.length) % options.length
    onChange(options[n].value)
    refs.current[n]?.focus()
  }
  return (
    <div
      role="radiogroup" aria-labelledby={ariaLabelledBy} aria-label={ariaLabel} aria-describedby={describedById}
      className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-r2 border border-white/[.08] bg-white/[.03] p-0.5', className)}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)} ref={(n) => { refs.current[i] = n }}
            type="button" role="radio" aria-checked={active} aria-label={o.ariaLabel}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'relative h-8 whitespace-nowrap rounded-[10px] px-3.5 text-[13px] font-medium transition-colors duration-micro',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span layoutId={`rs-${gid}`} transition={springSoft} aria-hidden className="absolute inset-0 rounded-[10px] border border-white/[.08] bg-white/[.075]" />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
