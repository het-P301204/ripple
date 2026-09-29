import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Keyboard key hint. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex min-w-[20px] items-center justify-center rounded-md border border-white/[.1] bg-white/[.04] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3', className)}>
      {children}
    </kbd>
  )
}
