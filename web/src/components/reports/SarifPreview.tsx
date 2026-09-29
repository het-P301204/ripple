import { Fragment, useId, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ChevronRight } from 'lucide-react'
import type { ScanResult } from '@/types/scan'
import { toSARIF } from '@/lib/exporters'
import { cn } from '@/lib/cn'
import { EASE } from '@/lib/motion'
import { CopyButton } from '@/components/ui/CopyButton'

/** First rule + first result of the SARIF this scan would export, with the rest elided. */
export function sarifExcerpt(scan: ScanResult): string {
  const full = JSON.parse(toSARIF(scan)) as {
    $schema: string; version: string
    runs: Array<{ tool: { driver: { rules: unknown[]; [k: string]: unknown } }; results: unknown[] }>
  }
  const run = full.runs[0]
  const more = (n: number, what: string) => `… ${n} more ${what}`
  const rules = run.tool.driver.rules
  const results = run.results
  const excerpt = {
    $schema: full.$schema,
    version: full.version,
    runs: [{
      tool: { driver: { ...run.tool.driver, rules: rules.length > 1 ? [rules[0], more(rules.length - 1, rules.length - 1 === 1 ? 'rule' : 'rules')] : rules } },
      results: results.length > 1 ? [results[0], more(results.length - 1, results.length - 1 === 1 ? 'result' : 'results')] : results,
    }],
  }
  return JSON.stringify(excerpt, null, 2)
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b/g

/** Minimal JSON highlighter (keys violet, strings light, numbers amber). */
function highlight(src: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index))
    if (m[1]) {
      const elided = m[1].startsWith('"… ')
      out.push(<span key={m.index} style={{ color: m[2] ? '#A78BFA' : elided ? '#585C65' : '#C9CBD1', fontStyle: elided ? 'italic' : undefined }}>{m[1]}</span>)
      if (m[2]) out.push(<Fragment key={`${m.index}c`}>{m[2]}</Fragment>)
    } else if (m[3]) out.push(<span key={m.index} style={{ color: '#F59E0B' }}>{m[3]}</span>)
    else out.push(<span key={m.index} style={{ color: '#F472B6' }}>{m[4]}</span>)
    last = TOKEN.lastIndex
  }
  out.push(src.slice(last))
  return out
}

/** Collapsible, client-generated SARIF preview. */
export function SarifPreview({ scan }: { scan: ScanResult }) {
  const [open, setOpen] = useState(false)
  const reduced = !!useReducedMotion()
  const id = useId()
  const text = useMemo(() => (open ? sarifExcerpt(scan) : ''), [open, scan])
  return (
    <div className="overflow-hidden rounded-r3 border border-hair bg-card shadow-card">
      <button
        type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-micro hover:bg-white/[.02]"
      >
        <ChevronRight size={16} aria-hidden className={cn('shrink-0 text-ink-3 transition-transform duration-comp ease-ripple', open && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold tracking-[-0.01em]">SARIF preview</span>
          <span className="block text-[12.5px] text-ink-3">First rule and result, generated in your browser</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }} exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden"
          >
            <div className="relative border-t border-white/[.05] bg-black/30">
              <div className="absolute right-2 top-2"><CopyButton value={text} label="Copy excerpt" /></div>
              <pre tabIndex={0} aria-label="SARIF excerpt" className="mono m-0 max-h-[340px] overflow-auto px-4 py-3 text-[11.5px] leading-[1.55] text-ink-2">{highlight(text)}</pre>
            </div>
            <p className="px-5 py-3 text-[11.5px] leading-relaxed text-ink-3">Preview only. The downloaded file comes from the RIPPLE server when it’s running, and includes every rule and result.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
