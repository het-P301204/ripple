import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Open traps, oldest first. Only the topmost one reacts to Tab/Escape, so stacked overlays close one at a time. */
const stack: symbol[] = []
let lockCount = 0
let savedOverflow = ''

/**
 * Traps Tab focus inside `ref` while `active`, closes on Escape, locks body scroll,
 * and restores focus to the previously focused element on cleanup.
 * `onClose` is read through a ref, so an inline callback never goes stale.
 */
export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean, onClose?: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    const id = Symbol('trap')
    stack.push(id)
    const prev = document.activeElement as HTMLElement | null
    if (lockCount++ === 0) savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement)
    const first = window.setTimeout(() => {
      const f = node.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? node
      f.focus({ preventScroll: true })
    }, 30)

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) { e.preventDefault(); node.focus(); return }
      const firstEl = items[0]
      const lastEl = items[items.length - 1]
      const cur = document.activeElement as HTMLElement | null
      if (e.shiftKey && (cur === firstEl || !node.contains(cur))) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && (cur === lastEl || !node.contains(cur))) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(first)
      document.removeEventListener('keydown', onKey, true)
      const i = stack.indexOf(id)
      if (i >= 0) stack.splice(i, 1)
      if (--lockCount <= 0) { lockCount = 0; document.body.style.overflow = savedOverflow }
      // only restore focus if the opener is still in the document (it may have been removed while the dialog was open)
      if (prev && prev.isConnected) prev.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
