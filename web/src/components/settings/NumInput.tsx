import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * Numeric text field that lets you clear and retype freely: it only reports valid numbers,
 * and snaps back to the current value on blur.
 */
export function NumInput({
  id, value, onChange, suffix, step = 1, min, max, invalid, describedById, className,
}: {
  id: string; value: number; onChange: (n: number) => void; suffix?: string
  step?: number; min?: number; max?: number; invalid?: boolean; describedById?: string; className?: string
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    if (text.trim() !== '' && Number(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <div className={cn('relative', className)}>
      <input
        id={id} type="number" inputMode="decimal" step={step} min={min} max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = parseFloat(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => setText(String(value))}
        aria-invalid={invalid || undefined} aria-describedby={describedById}
        className={cn(
          'mono tnum h-10 w-full rounded-r2 border bg-white/[.03] pl-3 text-[13px] text-ink transition-[border-color,box-shadow,background] duration-micro ease-ripple',
          suffix ? 'pr-11' : 'pr-3',
          'hover:border-white/[.15] focus:border-accent-soft/60 focus:bg-white/[.045] focus:shadow-[0_0_0_3px_rgb(var(--c-accent)/.18)]',
          invalid ? 'border-sev-critical/50' : 'border-white/[.09]',
        )}
      />
      {suffix && <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">{suffix}</span>}
    </div>
  )
}
