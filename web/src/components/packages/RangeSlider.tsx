import { useRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * Rounded dual-thumb range slider (pointer + keyboard). Values are integers in [min, max].
 * Arrow keys move a thumb by `step`, Shift+Arrow by 10, Home/End jump to the limits.
 */
export function RangeSlider({
  value, onChange, min = 0, max = 100, step = 1, labelMin = 'Minimum', labelMax = 'Maximum', className,
}: {
  value: [number, number]
  onChange: (v: [number, number]) => void
  min?: number
  max?: number
  step?: number
  labelMin?: string
  labelMax?: string
  className?: string
}) {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<0 | 1 | null>(null)
  const [lo, hi] = value
  const pct = (v: number) => ((v - min) / (max - min)) * 100
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))

  const setThumb = (which: 0 | 1, v: number) => {
    const nv = snap(v)
    if (which === 0) onChange([Math.min(nv, hi), hi])
    else onChange([lo, Math.max(nv, lo)])
  }
  const fromX = (clientX: number) => {
    const r = track.current?.getBoundingClientRect()
    if (!r || r.width === 0) return lo
    return min + ((clientX - r.left) / r.width) * (max - min)
  }

  const onTrackDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).dataset.thumb) return
    const v = fromX(e.clientX)
    const which: 0 | 1 = Math.abs(v - lo) <= Math.abs(v - hi) ? 0 : 1
    drag.current = which
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setThumb(which, v)
  }
  const onThumbDown = (which: 0 | 1) => (e: React.PointerEvent) => {
    drag.current = which
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).focus()
  }
  const onMove = (e: React.PointerEvent) => {
    if (drag.current == null) return
    setThumb(drag.current, fromX(e.clientX))
  }
  const onUp = () => { drag.current = null }

  const onKey = (which: 0 | 1) => (e: React.KeyboardEvent) => {
    const cur = which === 0 ? lo : hi
    const big = e.shiftKey ? 10 : 1
    let nv: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') nv = cur + step * big
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') nv = cur - step * big
    else if (e.key === 'Home') nv = min
    else if (e.key === 'End') nv = max
    else if (e.key === 'PageUp') nv = cur + 10
    else if (e.key === 'PageDown') nv = cur - 10
    if (nv == null) return
    e.preventDefault()
    setThumb(which, nv)
  }

  const thumb = (which: 0 | 1) => {
    const v = which === 0 ? lo : hi
    return (
      <div
        key={which} data-thumb="1" role="slider" tabIndex={0}
        aria-label={which === 0 ? labelMin : labelMax} aria-valuemin={which === 0 ? min : lo} aria-valuemax={which === 0 ? hi : max} aria-valuenow={v}
        onPointerDown={onThumbDown(which)} onKeyDown={onKey(which)}
        className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-accent-soft bg-elevated shadow-[0_2px_8px_rgba(0,0,0,.5)] transition-[transform,box-shadow] duration-micro ease-ripple hover:scale-110 active:scale-95 active:cursor-grabbing"
        style={{ left: `${pct(v)}%`, zIndex: which === 1 && lo >= max ? 1 : 2 }}
      />
    )
  }

  return (
    <div
      className={cn('relative flex h-8 cursor-pointer touch-none items-center px-[9px]', className)}
      onPointerDown={onTrackDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      <div ref={track} className="relative h-1.5 w-full rounded-full bg-white/[.07]">
        <div
          className="absolute inset-y-0 rounded-full bg-[linear-gradient(90deg,rgb(var(--c-accent)),rgb(var(--c-magenta-soft)))]"
          style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }}
        />
        {thumb(0)}
        {thumb(1)}
      </div>
    </div>
  )
}
