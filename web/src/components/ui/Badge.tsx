import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'accent' | 'magenta' | 'amber' | 'ok'

const tones: Record<BadgeTone, string> = {
  neutral: 'text-ink-2 bg-white/[.04] border-white/[.08]',
  accent: 'text-accent-soft bg-accent/10 border-accent/25',
  magenta: 'text-magenta-soft bg-magenta/10 border-magenta/25',
  amber: 'text-amber bg-amber/10 border-amber/25',
  ok: 'text-ok bg-ok/10 border-ok/25',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  icon?: ReactNode
  mono?: boolean
}

/** Generic pill: tags, filters, statuses. Pills are reserved for badges/severity/ecosystem/filters/tags. */
export function Badge({ tone = 'neutral', icon, mono, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-medium leading-none',
        tones[tone], mono && 'mono', className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  )
}
export const Pill = Badge
