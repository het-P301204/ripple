import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { Card } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/CopyButton'
import { EASE } from '@/lib/motion'

/** A bordered code line with a copy button, e.g. the CLI equivalent of an export. */
export function CommandLine({ command, label = 'CLI equivalent' }: { command: string; label?: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[.1em] text-ink-3">{label}</p>
      <div className="flex items-center gap-1 rounded-r2 border border-white/[.06] bg-black/30 py-1 pl-3 pr-1">
        <code className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1.5 text-[12px] text-ink-2" tabIndex={0} aria-label={`Command: ${command}`}>
          <span aria-hidden className="select-none text-ink-4">$ </span>{command}
        </code>
        <CopyButton value={command} label="Copy command" />
      </div>
    </div>
  )
}

/**
 * Export option: icon, title, file extension, what it is for, actions, and the equivalent CLI command.
 * While `busy` a thin progress sweep runs along the top edge and the button shows its spinner.
 */
export function ExportCard({
  icon, title, ext, description, actions, command, commandLabel, busy, children,
}: {
  icon: ReactNode; title: string; ext?: string; description: ReactNode; actions: ReactNode
  command?: string; commandLabel?: string; busy?: boolean; children?: ReactNode
}) {
  const reduced = useReducedMotion()
  return (
    <Card radius={3} className="overflow-hidden p-5" aria-busy={busy || undefined} data-busy={busy || undefined}>
      {busy && (
        <div aria-hidden className="absolute inset-x-0 top-0 h-[2px] overflow-hidden">
          <motion.span
            className="block h-full w-1/3 bg-gradient-to-r from-transparent via-accent-soft to-transparent"
            initial={{ x: '-100%' }} animate={reduced ? { x: '100%' } : { x: ['-100%', '300%'] }}
            transition={{ duration: 1.1, ease: EASE, repeat: Infinity }}
          />
        </div>
      )}
      <div className="flex items-start gap-3.5">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-r2 border border-white/[.08] bg-white/[.035] text-accent-soft">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-semibold tracking-[-0.01em]">{title}</h3>
            {ext && <span className="mono rounded-md border border-white/[.08] px-1.5 py-0.5 text-[10.5px] text-ink-3">{ext}</span>}
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{description}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
      {children}
      {command && <div className="mt-4"><CommandLine command={command} label={commandLabel} /></div>}
    </Card>
  )
}
