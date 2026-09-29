import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { popVariants } from '@/lib/motion'
import { cn } from '@/lib/cn'

export interface MenuItem {
  id: string
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  onSelect: () => void
}

/**
 * Dropdown menu. `trigger` receives `{ open, toggle, ref, props }` — spread `props` onto your button
 * (ARIA + keyboard). Arrow keys navigate, Enter selects, Esc closes.
 */
export function Dropdown({
  items, trigger, align = 'end', width = 220,
}: {
  items: MenuItem[]
  trigger: (a: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement>; props: Record<string, unknown> }) => ReactNode
  align?: 'start' | 'end'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const reduced = !!useReducedMotion()
  // `items` is usually a fresh array every render; read it through a ref so a parent re-render never resets the highlight
  const itemsRef = useRef(items)
  itemsRef.current = items

  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) btn.current?.focus() }, [])

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8)
    setPos({ top: r.bottom + 8, left })
    setActive(itemsRef.current.findIndex((i) => !i.disabled))
  }, [open, align, width])

  useEffect(() => {
    if (!open) return
    menu.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(false)
    }
    // the menu is position:fixed under the trigger, so any resize/scroll would leave it stranded: just close it
    const dismiss = () => close(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', dismiss)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', dismiss) }
  }, [open, close])

  const onKey = (e: React.KeyboardEvent) => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0)
    if (!enabled.length && e.key !== 'Escape' && e.key !== 'Tab') return
    const idx = enabled.indexOf(active)
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(enabled[(idx + 1) % enabled.length]) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(enabled[(idx - 1 + enabled.length) % enabled.length]) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const it = items[active]; if (it && !it.disabled) { close(); it.onSelect() } }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close() }
  }

  return (
    <>
      {trigger({
        open, toggle: () => setOpen((o) => !o), ref: btn,
        props: { 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen((o) => !o) },
      })}
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menu} role="menu" tabIndex={-1} onKeyDown={onKey}
              variants={popVariants(reduced)} initial="initial" animate="animate" exit="exit"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 90, transformOrigin: align === 'end' ? 'top right' : 'top left' }}
              className="rounded-r3 border border-white/[.1] bg-elevated p-1.5 shadow-pop outline-none"
            >
              {items.map((it, i) => (
                <button
                  key={it.id} role="menuitem" type="button" disabled={it.disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { close(); it.onSelect() }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-r1 px-2.5 py-2 text-left text-[13px] transition-colors duration-100 disabled:opacity-40',
                    active === i ? 'bg-white/[.07] text-ink' : 'text-ink-2',
                  )}
                >
                  {it.icon && <span className="text-ink-3">{it.icon}</span>}
                  <span className="flex-1">{it.label}</span>
                  {it.hint && <span className="text-[11px] text-ink-4">{it.hint}</span>}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
