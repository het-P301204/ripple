import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/** Shimmer block. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cn('skeleton', className)} style={style} />
}

/** N table-row placeholders. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('divide-y divide-white/[.05]', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-14 items-center gap-4 px-5">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-4 w-40" style={{ opacity: 1 - i * 0.08 }} />
          <Skeleton className="ml-auto hidden h-4 w-24 sm:block" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  )
}

/** N card placeholders in a responsive grid. */
export function SkeletonCards({ count = 4, className, height = 132 }: { count?: number; className?: string; height?: number }) {
  return (
    <div role="status" aria-label="Loading" className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-r3 border border-hair bg-card p-5" style={{ height }}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-4 h-8 w-24" />
          <Skeleton className="mt-4 h-3 w-32" />
        </div>
      ))}
    </div>
  )
}
