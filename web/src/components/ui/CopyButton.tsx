import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Copy-to-clipboard button: copy icon -> "Copied" state for 1.6s. */
export function CopyButton({
  value, label = 'Copy', className, compact = true,
}: { value: string; label?: string; className?: string; compact?: boolean }) {
  const [done, setDone] = useState(false)
  const t = useRef<number>()
  useEffect(() => () => window.clearTimeout(t.current), [])
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      ta.remove()
    }
    setDone(true)
    window.clearTimeout(t.current)
    t.current = window.setTimeout(() => setDone(false), 1600)
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? 'Copied' : `${label}: ${value}`}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[12px] text-ink-3 transition-colors duration-micro hover:bg-white/[.06] hover:text-ink',
        done && 'text-ok hover:text-ok', className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? 'y' : 'n'}
          initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
          transition={{ duration: 0.12 }} className="inline-flex"
        >
          {done ? <Check size={14} /> : <Copy size={14} />}
        </motion.span>
      </AnimatePresence>
      {(done || !compact) && <span>{done ? 'Copied' : label}</span>}
    </button>
  )
}

/** Monospace text (package names, versions, hashes, URLs, commands). Optional copy affordance. */
export function Mono({
  children, copy, className, block, muted,
}: { children: ReactNode; copy?: string; className?: string; block?: boolean; muted?: boolean }) {
  return (
    <span className={cn('mono', block ? 'flex items-center gap-1' : 'inline-flex items-center gap-1', muted && 'text-ink-3', className)}>
      <span className="min-w-0 break-all">{children}</span>
      {copy && <CopyButton value={copy} />}
    </span>
  )
}
