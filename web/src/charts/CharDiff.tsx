import { describeDiff, diffChars, type DiffOp } from './diff'
import { cn } from '@/lib/cn'

const MARK = 'rounded-[3px] bg-magenta/[.20] px-[1px] text-magenta-soft shadow-[inset_0_-1.5px_0_rgb(var(--c-magenta-soft)/.7)]'

function Gap({ ch, side }: { ch: string; side: 'missing' | 'extra' }) {
  return (
    <span
      aria-hidden title={side === 'missing' ? `missing ${ch}` : `extra ${ch}`}
      className="mx-[1px] inline-block h-[1.05em] w-[0.5em] translate-y-[0.14em] border-b-[2px] border-magenta-soft/80 bg-magenta/[.12]"
    />
  )
}

function Line({ ops, side }: { ops: DiffOp[]; side: 'a' | 'b' }) {
  // side 'b' renders the candidate (highlights what was added/changed); side 'a' renders the original (highlights what was lost).
  return (
    <>
      {ops.map((o, i) => {
        const text = side === 'b' ? o.b : o.a
        if (o.t === 'eq') return <span key={i}>{text}</span>
        if (o.t === 'del') return side === 'a' ? <span key={i} className={MARK}>{o.a}</span> : <Gap key={i} ch={o.a} side="missing" />
        if (o.t === 'ins') return side === 'b' ? <span key={i} className={MARK}>{o.b}</span> : <Gap key={i} ch={o.b} side="extra" />
        return <span key={i} className={MARK}>{text}</span>
      })}
    </>
  )
}

/**
 * Highlights the characters that differ between a legitimate package name and a lookalike.
 *  - `candidate` (default): the lookalike, with changed/added characters marked and removed ones shown as a gap
 *  - `original`: the original, with the characters the lookalike lost/changed marked
 *  - `stacked`: both, one above the other
 * Monospace, tiny, and readable by screen readers ("requets, differs from requests: missing “s”").
 */
export function CharDiff({
  original, candidate, mode = 'candidate', className,
}: { original: string; candidate: string; mode?: 'candidate' | 'original' | 'stacked'; className?: string }) {
  const ops = diffChars(original, candidate)
  const summary = `${mode === 'original' ? original : candidate}, ${mode === 'original' ? 'compared with' : 'differs from'} ${mode === 'original' ? candidate : original}: ${describeDiff(original, candidate)}`
  if (mode === 'stacked') {
    return (
      <span className={cn('mono inline-flex flex-col gap-1.5 text-[13px] leading-none', className)} role="img" aria-label={summary}>
        <span className="flex items-center gap-2" aria-hidden><span className="w-16 shrink-0 text-[10px] uppercase tracking-[.1em] text-ink-3">Original</span><span className="whitespace-pre text-ink-2"><Line ops={ops} side="a" /></span></span>
        <span className="flex items-center gap-2" aria-hidden><span className="w-16 shrink-0 text-[10px] uppercase tracking-[.1em] text-ink-3">Lookalike</span><span className="whitespace-pre text-ink"><Line ops={ops} side="b" /></span></span>
      </span>
    )
  }
  return (
    <span className={cn('mono inline-block whitespace-pre', className)} role="img" aria-label={summary}>
      <span aria-hidden><Line ops={ops} side={mode === 'original' ? 'a' : 'b'} /></span>
    </span>
  )
}
