import { useId, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { springSoft } from '@/lib/motion'

export interface SegmentedOption<T extends string> { value: T; label: ReactNode; count?: number; ariaLabel?: string }

/**
 * Segmented control / tabs with a shared-layout animated indicator.
 * `variant="tabs"` renders an underlined tab strip; default is a pill-less rounded segmented control.
 */
export function Segmented<T extends string>({
  options, value, onChange, variant = 'segmented', size = 'md', ariaLabel, className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  variant?: 'segmented' | 'tabs'
  size?: 'sm' | 'md'
  ariaLabel?: string
  className?: string
}) {
  const gid = useId()
  const tabs = variant === 'tabs'
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length
    onChange(options[n].value)
    ;(e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex max-w-full items-center overflow-x-auto',
        tabs ? 'gap-5 border-b border-hair' : 'gap-0.5 rounded-r2 border border-white/[.08] bg-white/[.03] p-0.5',
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            aria-label={o.ariaLabel}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'relative whitespace-nowrap font-medium transition-colors duration-micro',
              tabs ? 'pb-3 pt-1 text-sm' : cn('rounded-[10px]', size === 'sm' ? 'h-7 px-3 text-[12.5px]' : 'h-8 px-3.5 text-[13px]'),
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${gid}`}
                transition={springSoft}
                aria-hidden
                className={cn(
                  'absolute',
                  tabs ? 'inset-x-0 -bottom-px h-[2px] rounded-full bg-accent-soft' : 'inset-0 rounded-[10px] border border-white/[.08] bg-white/[.075]',
                )}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              {o.label}
              {o.count != null && <span className="tnum text-[11px] text-ink-3">{o.count}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
export const Tabs = Segmented
