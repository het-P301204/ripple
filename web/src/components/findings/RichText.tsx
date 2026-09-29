import { Fragment } from 'react'
import { cn } from '@/lib/cn'

/** Renders text where `backticked` segments become inline mono code. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.length > 2 && p.startsWith('`') && p.endsWith('`') ? (
          <code key={i} className={cn('mono rounded-md border border-white/[.07] bg-black/30 px-1.5 py-0.5 text-[0.88em] text-ink-2')}>
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  )
}
