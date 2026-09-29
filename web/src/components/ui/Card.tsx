import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Hover lift (-2px) + brighter border. Adds pointer cursor. */
  interactive?: boolean
  /** Corner radius token: 2=12, 3=16 (default), 4=20, 5=24. */
  radius?: 2 | 3 | 4 | 5
  padded?: boolean
  elevated?: boolean
}

const radii = { 2: 'rounded-r2', 3: 'rounded-r3', 4: 'rounded-r4', 5: 'rounded-r5' }

/** Matte graphite surface with hairline border. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, radius = 3, padded = false, elevated, className, ...rest }, ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'relative border shadow-card',
        elevated ? 'bg-elevated border-white/[.09]' : 'bg-card border-hair',
        radii[radius],
        padded && 'p-5 md:p-6',
        interactive &&
          'cursor-pointer transition-[transform,border-color,background] duration-comp ease-ripple hover:-translate-y-0.5 hover:border-white/[.14] hover:bg-elevated focus-visible:-translate-y-0.5 focus-visible:border-white/[.14]',
        className,
      )}
      {...rest}
    />
  )
})
