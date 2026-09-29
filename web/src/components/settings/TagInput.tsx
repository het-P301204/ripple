import { useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { LIMITS } from '@/lib/settings'

/** Tag input for internal scopes / prefixes. Enter, comma or blur adds; Backspace on empty removes the last tag. */
export function TagInput({
  id, value, onChange, placeholder, describedById,
}: { id: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; describedById?: string }) {
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const reduced = !!useReducedMotion()

  const commit = (raw: string) => {
    const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) { setDraft(''); return }
    const next = [...value]
    let msg: string | null = null
    for (const p of parts) {
      if (p.length > LIMITS.scopeLen) { msg = `“${p.slice(0, 18)}…” is too long (${LIMITS.scopeLen} characters max).`; continue }
      if (next.includes(p)) { msg = `${p.slice(0, 40)} is already in the list.`; continue }
      if (next.length >= LIMITS.scopeCount) { msg = `At most ${LIMITS.scopeCount} scopes can be added.`; break }
      next.push(p)
    }
    setProblem(msg)
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      if (draft.trim()) { e.preventDefault(); commit(draft) }
      else if (e.key === ',') e.preventDefault()
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const t = e.clipboardData.getData('text')
    if (/[,\s]/.test(t.trim())) { e.preventDefault(); commit(t) }
  }

  return (
    <div>
      <div
        className={cn(
          'flex min-h-10 flex-wrap items-center gap-1.5 rounded-r2 border border-white/[.09] bg-white/[.03] px-2 py-1.5',
          'transition-[border-color,box-shadow,background] duration-micro ease-ripple hover:border-white/[.15]',
          'focus-within:border-accent-soft/60 focus-within:bg-white/[.045] focus-within:shadow-[0_0_0_3px_rgb(var(--c-accent)/.18)]',
        )}
      >
        <ul className="contents" aria-label="Internal scopes and prefixes">
          <AnimatePresence initial={false}>
            {value.map((t) => (
              <motion.li
                key={t} layout={!reduced}
                initial={{ opacity: 0, scale: reduced ? 1 : 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduced ? 1 : 0.9 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="mono inline-flex h-7 items-center gap-1 rounded-full border border-accent/25 bg-accent/10 pl-2.5 pr-1 text-[12px] text-accent-soft"
              >
                {t}
                <button
                  type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}
                  className="grid h-5 w-5 place-items-center rounded-full text-accent-soft/70 transition-colors hover:bg-white/[.1] hover:text-white"
                >
                  <X size={12} aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <input
          id={id} value={draft} placeholder={value.length ? 'Add another…' : placeholder}
          aria-describedby={describedById}
          onChange={(e) => { setDraft(e.target.value); if (problem) setProblem(null) }}
          onKeyDown={onKey} onPaste={onPaste} onBlur={() => commit(draft)}
          className="mono h-7 min-w-[9ch] flex-1 bg-transparent px-1 text-[13px] text-ink outline-none placeholder:text-ink-4"
          autoComplete="off" spellCheck={false}
        />
      </div>
      <p role="status" className={cn('mt-1.5 min-h-[18px] text-[12px]', problem ? 'text-amber' : 'sr-only')}>{problem ?? ''}</p>
    </div>
  )
}
