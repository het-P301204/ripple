import type { Ecosystem } from '@/types/scan'

const f = (n: number) => Math.round(n * 100) / 100

/** Ecosystem encoded by silhouette: npm circle, PyPI rounded square, Go hexagon, Rust diamond. Centred on 0,0. */
export function shapePath(eco: Ecosystem | 'cluster', r: number): string {
  switch (eco) {
    case 'pypi': {
      const h = r * 0.9
      const c = h * 0.36
      return `M${f(-h + c)},${f(-h)}H${f(h - c)}Q${f(h)},${f(-h)} ${f(h)},${f(-h + c)}V${f(h - c)}Q${f(h)},${f(h)} ${f(h - c)},${f(h)}H${f(-h + c)}Q${f(-h)},${f(h)} ${f(-h)},${f(h - c)}V${f(-h + c)}Q${f(-h)},${f(-h)} ${f(-h + c)},${f(-h)}Z`
    }
    case 'go': {
      const R = r * 1.08
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (-90 + i * 60) * (Math.PI / 180)
        return `${f(Math.cos(a) * R)},${f(Math.sin(a) * R)}`
      })
      return `M${pts.join('L')}Z`
    }
    case 'rust': {
      const R = r * 1.24
      return `M0,${f(-R)}L${f(R)},0L0,${f(R)}L${f(-R)},0Z`
    }
    default:
      return `M${f(-r)},0a${f(r)},${f(r)} 0 1 0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1 0 ${f(-2 * r)},0Z`
  }
}
