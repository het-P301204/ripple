import type { Bounds } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)

export interface Inset { left: number; right: number; top: number; bottom: number }
export const NO_INSET: Inset = { left: 0, right: 0, top: 0, bottom: 0 }

/**
 * Pan/zoom state kept OUTSIDE React: the transform is written straight to the viewport <g>.
 * React only hears about coarse zoom-level changes through `onChange`.
 */
export class Camera {
  x = 0
  y = 0
  k = 1
  w = 0
  h = 0
  minK = 0.16
  maxK = 4
  reduced = false
  onChange?: (c: Camera) => void
  private el: SVGGElement | null = null
  private raf = 0

  attach(el: SVGGElement | null) { this.el = el; if (el) this.apply() }
  resize(w: number, h: number) { this.w = w; this.h = h }

  apply() {
    this.el?.setAttribute('transform', `translate(${this.x.toFixed(2)} ${this.y.toFixed(2)}) scale(${this.k.toFixed(4)})`)
    this.onChange?.(this)
  }

  stop() { cancelAnimationFrame(this.raf); this.raf = 0 }

  set(x: number, y: number, k: number) { this.stop(); this.x = x; this.y = y; this.k = clamp(k, this.minK, this.maxK); this.apply() }

  panBy(dx: number, dy: number) { this.stop(); this.x += dx; this.y += dy; this.apply() }

  /** Zoom by factor `f` keeping screen point (px, py) fixed. */
  zoomAt(px: number, py: number, f: number) {
    this.stop()
    const nk = clamp(this.k * f, this.minK, this.maxK)
    const r = nk / this.k
    this.x = px - (px - this.x) * r
    this.y = py - (py - this.y) * r
    this.k = nk
    this.apply()
  }

  /** Animated zoom around the viewport centre (buttons, keyboard). */
  zoomStep(f: number, inset: Inset = NO_INSET) {
    const cx = inset.left + (this.w - inset.left - inset.right) / 2
    const cy = inset.top + (this.h - inset.top - inset.bottom) / 2
    const nk = clamp(this.k * f, this.minK, this.maxK)
    const r = nk / this.k
    this.animateTo({ x: cx - (cx - this.x) * r, y: cy - (cy - this.y) * r, k: nk }, 260)
  }

  animateTo(t: { x: number; y: number; k: number }, ms = 520) {
    this.stop()
    const k1 = clamp(t.k, this.minK, this.maxK)
    if (this.reduced || ms <= 0) { this.x = t.x; this.y = t.y; this.k = k1; this.apply(); return }
    const { x: x0, y: y0, k: k0 } = this
    const t0 = performance.now()
    const step = (now: number) => {
      const p = clamp((now - t0) / ms, 0, 1)
      const e = easeOut(p)
      this.x = x0 + (t.x - x0) * e
      this.y = y0 + (t.y - y0) * e
      this.k = k0 * Math.pow(k1 / k0, e)
      this.apply()
      this.raf = p < 1 ? requestAnimationFrame(step) : 0
    }
    this.raf = requestAnimationFrame(step)
  }

  /** Transform that frames `b` inside the viewport, leaving `inset` free (e.g. for the detail panel). */
  frame(b: Bounds, inset: Inset = NO_INSET, padding = 44, maxK = 1.5) {
    const aw = Math.max(40, this.w - inset.left - inset.right - padding * 2)
    const ah = Math.max(40, this.h - inset.top - inset.bottom - padding * 2)
    const bw = Math.max(1, b.maxX - b.minX)
    const bh = Math.max(1, b.maxY - b.minY)
    const k = clamp(Math.min(aw / bw, ah / bh, maxK), this.minK, this.maxK)
    const cx = inset.left + (this.w - inset.left - inset.right) / 2
    const cy = inset.top + (this.h - inset.top - inset.bottom) / 2
    return { x: cx - ((b.minX + b.maxX) / 2) * k, y: cy - ((b.minY + b.maxY) / 2) * k, k }
  }

  fit(b: Bounds, inset: Inset = NO_INSET, animate = true, padding?: number) {
    if (this.w <= 0 || this.h <= 0) return
    const t = this.frame(b, inset, padding)
    if (animate) this.animateTo(t, 620)
    else this.set(t.x, t.y, t.k)
  }

  centerOn(wx: number, wy: number, inset: Inset = NO_INSET, k?: number, animate = true) {
    if (this.w <= 0 || this.h <= 0) return
    const nk = clamp(k ?? this.k, this.minK, this.maxK)
    const cx = inset.left + (this.w - inset.left - inset.right) / 2
    const cy = inset.top + (this.h - inset.top - inset.bottom) / 2
    const t = { x: cx - wx * nk, y: cy - wy * nk, k: nk }
    if (animate) this.animateTo(t, 560)
    else this.set(t.x, t.y, t.k)
  }

  toScreen(wx: number, wy: number) { return { x: wx * this.k + this.x, y: wy * this.k + this.y } }

  /** Is the world point comfortably inside the (inset) viewport? */
  isVisible(wx: number, wy: number, inset: Inset = NO_INSET, margin = 30) {
    const s = this.toScreen(wx, wy)
    return s.x > inset.left + margin && s.x < this.w - inset.right - margin && s.y > inset.top + margin && s.y < this.h - inset.bottom - margin
  }
}
