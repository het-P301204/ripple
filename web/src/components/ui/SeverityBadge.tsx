import type { Severity } from '@/types/scan'
import { SEVERITY_META } from '@/lib/meta'
import { cn } from '@/lib/cn'

export function SeverityDot({ severity, className, pulse }: { severity: Severity; className?: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)}
      style={{
        background: `rgb(${SEVERITY_META[severity].rgb})`,
        animation: pulse && severity === 'critical' ? 'crit-pulse 4.6s ease-in-out 2' /* two pulses then rest: box-shadow is a paint-per-frame property */ : undefined,
      }}
    />
  )
}

/**
 * Severity pill. Critical: dot pulses softly every few seconds. High: warm glow on hover.
 * Medium / low / info: static. Colours come from the severity triad tokens.
 */
export function SeverityBadge({
  severity, className, label, size = 'md',
}: { severity: Severity; className?: string; label?: string; size?: 'sm' | 'md' }) {
  const m = SEVERITY_META[severity]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold uppercase leading-none tracking-[.06em] transition-shadow duration-comp ease-ripple',
        size === 'sm' ? 'h-5 px-2 text-[10px]' : 'h-6 px-2.5 text-[10.5px]',
        severity === 'high' && 'hover:shadow-[0_0_16px_-2px_rgb(var(--sev-high)/.55)]',
        className,
      )}
      style={{ background: m.bg, borderColor: m.border, color: m.text }}
    >
      <SeverityDot severity={severity} pulse />
      {label ?? m.label}
    </span>
  )
}
