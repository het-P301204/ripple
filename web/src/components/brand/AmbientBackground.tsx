/**
 * Fixed page-level atmosphere: a static radial light and a static grain tile. Nothing here animates or blends: two fixed, promoted
 * layers that are painted once. (The drifting light, floating motes and feTurbulence/mix-blend grain were the largest constant
 * per-frame cost in the app.) The grain is dropped in reduced-animation mode via CSS opacity only.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="ambient-light" />
      <div className="ambient-grain" />
    </div>
  )
}
