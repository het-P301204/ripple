import { forwardRef, useCallback, useState, type ButtonHTMLAttributes, type PointerEvent, type ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { useReducedMotion } from '@/lib/perf'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'relative inline-flex select-none items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-medium ' +
  'transition-[background,border-color,box-shadow,transform,color] duration-micro ease-ripple ' +
  'disabled:cursor-not-allowed disabled:opacity-45 active:translate-y-[0.5px]'

const variants: Record<ButtonVariant, string> = {
  primary:
    'text-white border border-white/10 bg-[linear-gradient(180deg,rgb(var(--c-accent))_0%,rgb(var(--c-accent-deep))_100%)] ' +
    'shadow-[0_1px_0_rgba(255,255,255,.22)_inset,0_6px_18px_-8px_rgb(var(--c-accent)/.7)] ' +
    'hover:brightness-110 hover:shadow-[0_1px_0_rgba(255,255,255,.26)_inset,0_8px_24px_-8px_rgb(var(--c-accent)/.85)]',
  secondary:
    'text-ink border border-white/[.09] bg-white/[.035] hover:bg-white/[.065] hover:border-white/[.16]',
  ghost: 'text-ink-2 border border-transparent hover:text-ink hover:bg-white/[.055]',
  danger:
    'text-sev-critical border border-sev-critical/25 bg-sev-critical/10 hover:bg-sev-critical/15 hover:border-sev-critical/40',
}
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-r1',
  md: 'h-10 px-4 text-sm rounded-r2',
  lg: 'h-12 px-6 text-[15px] rounded-r2',
}
const iconSizes: Record<ButtonSize, string> = { sm: 'h-8 w-8 rounded-r1', md: 'h-10 w-10 rounded-r2', lg: 'h-12 w-12 rounded-r2' }

export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', icon = false, className?: string) {
  return cn(base, variants[variant], icon ? iconSizes[size] : sizes[size], className)
}

interface Ripple { id: number; x: number; y: number; d: number }
let rippleId = 0

/** Adds a click ripple that expands from the pointer position. */
function useRipple() {
  const reduced = useReducedMotion()
  const [ripples, setRipples] = useState<Ripple[]>([])
  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (reduced) return
      const r = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const d = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) * 2
      const id = ++rippleId
      setRipples((rs) => [...rs.slice(-3), { id, x, y, d }])
    },
    [reduced],
  )
  const layer = (variant: ButtonVariant) => (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {ripples.map((r) => (
        <span
          key={r.id}
          onAnimationEnd={() => setRipples((rs) => rs.filter((x) => x.id !== r.id))}
          className="absolute rounded-full"
          style={{
            left: r.x, top: r.y, width: r.d, height: r.d,
            background: variant === 'primary' ? 'rgba(255,255,255,.55)' : 'rgb(var(--c-accent-soft) / .45)',
            animation: 'btn-ripple 650ms cubic-bezier(0.22,1,0.36,1) forwards',
          }}
        />
      ))}
    </span>
  )
  return { onPointerDown, layer }
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Square icon-only button. Provide `aria-label`. */
  icon?: boolean
  loading?: boolean
  leading?: ReactNode
  trailing?: ReactNode
}

/** Primary violet gradient (click ripple from pointer), secondary bordered, ghost, danger. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, leading, trailing, className, children, disabled, onPointerDown, type = 'button', ...rest },
  ref,
) {
  const rip = useRipple()
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, icon, className)}
      onPointerDown={(e) => { rip.onPointerDown(e); onPointerDown?.(e) }}
      {...rest}
    >
      {rip.layer(variant)}
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : leading}
      {children}
      {!loading && trailing}
    </button>
  )
})

/** Router link that looks like a Button. */
export function LinkButton({
  variant = 'secondary', size = 'md', className, leading, trailing, children, ...rest
}: LinkProps & { variant?: ButtonVariant; size?: ButtonSize; leading?: ReactNode; trailing?: ReactNode }) {
  const rip = useRipple()
  return (
    <Link className={buttonClasses(variant, size, false, className)} onPointerDown={rip.onPointerDown} {...rest}>
      {rip.layer(variant)}
      {leading}
      {children}
      {trailing}
    </Link>
  )
}
