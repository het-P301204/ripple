import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

const field =
  'w-full bg-white/[.03] border border-white/[.09] text-ink placeholder:text-ink-4 rounded-r2 ' +
  'transition-[border-color,box-shadow,background] duration-micro ease-ripple hover:border-white/[.15] ' +
  'focus:border-accent-soft/60 focus:bg-white/[.045] focus:shadow-[0_0_0_3px_rgb(var(--c-accent)/.18)] disabled:opacity-50'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  mono?: boolean
  leading?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, mono, leading, className, id, ...rest }, ref,
) {
  const auto = useId()
  const iid = id ?? auto
  return (
    <div className="w-full">
      {label && <label htmlFor={iid} className="mb-1.5 block text-[12px] font-medium text-ink-2">{label}</label>}
      <div className="relative">
        {leading && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">{leading}</span>}
        <input ref={ref} id={iid} className={cn(field, 'h-10 px-3 text-sm', mono && 'mono text-[13px]', leading && 'pl-9', className)} {...rest} />
      </div>
      {hint && <p className="mt-1.5 text-[12px] text-ink-3">{hint}</p>}
    </div>
  )
})

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string
  onChange: (v: string) => void
  shortcut?: string
}

/** Search field with clear button. Esc clears. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, className, placeholder = 'Search…', shortcut, ...rest }, ref,
) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={ref}
        type="search"
        role="searchbox"
        aria-label={rest['aria-label'] ?? placeholder}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onChange('') }}
        maxLength={200}
        autoComplete="off" spellCheck={false}
        className={cn(field, 'h-10 pl-9 pr-9 text-sm [&::-webkit-search-cancel-button]:hidden')}
        {...rest}
      />
      {value ? (
        <button
          type="button" aria-label="Clear search" onClick={() => onChange('')}
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-white/[.06] hover:text-ink"
        >
          <X size={14} />
        </button>
      ) : shortcut ? (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-white/[.08] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-3">{shortcut}</kbd>
      ) : null}
    </div>
  )
})

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: Array<{ value: string; label: string }>
}

/** Native select, restyled (keeps platform a11y + mobile pickers). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, className, id, ...rest }, ref,
) {
  const auto = useId()
  const sid = id ?? auto
  return (
    <div className="w-full">
      {label && <label htmlFor={sid} className="mb-1.5 block text-[12px] font-medium text-ink-2">{label}</label>}
      <div className="relative">
        <select ref={ref} id={sid} className={cn(field, 'h-10 cursor-pointer appearance-none pl-3 pr-9 text-sm', className)} {...rest}>
          {options.map((o) => <option key={o.value} value={o.value} className="bg-elevated text-ink">{o.label}</option>)}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
      </div>
    </div>
  )
})

/** Toggle switch. */
export function Switch({
  checked, onChange, label, id,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id} type="button" role="switch" aria-checked={checked} aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-comp ease-ripple',
        checked ? 'border-accent/50 bg-accent/80' : 'border-white/[.12] bg-white/[.06]',
      )}
    >
      <span
        className="absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform duration-comp ease-ripple"
        style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  )
}
