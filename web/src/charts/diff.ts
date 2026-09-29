export type DiffOp =
  | { t: 'eq'; a: string; b: string }
  | { t: 'sub'; a: string; b: string }
  | { t: 'swap'; a: string; b: string }
  | { t: 'del'; a: string; b: '' }
  | { t: 'ins'; a: ''; b: string }

/**
 * Optimal-string-alignment diff (Levenshtein + adjacent transposition) between two names.
 * `del` = a character of `a` that is missing from `b`; `ins` = a character in `b` that `a` lacks.
 * Ties prefer substitutions, so `1odash` vs `lodash` reads as one changed character rather than delete+insert.
 */
export function diffChars(a: string, b: string): DiffOp[] {
  const n = a.length, m = b.length
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 0; i <= n; i++) d[i][0] = i
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  const ops: DiffOp[] = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && d[i][j] === d[i - 1][j - 1]) { ops.push({ t: 'eq', a: a[i - 1], b: b[j - 1] }); i--; j--; continue }
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
      ops.push({ t: 'swap', a: a.slice(i - 2, i), b: b.slice(j - 2, j) }); i -= 2; j -= 2; continue
    }
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) { ops.push({ t: 'sub', a: a[i - 1], b: b[j - 1] }); i--; j--; continue }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) { ops.push({ t: 'del', a: a[i - 1], b: '' }); i--; continue }
    ops.push({ t: 'ins', a: '', b: b[j - 1] }); j--
  }
  return ops.reverse()
}

/** Plain-language description of the change, for screen readers and tooltips. */
export function describeDiff(a: string, b: string): string {
  const ops = diffChars(a, b).filter((o) => o.t !== 'eq')
  if (!ops.length) return 'identical names'
  return ops.map((o) => {
    switch (o.t) {
      case 'del': return `missing “${o.a}”`
      case 'ins': return `extra “${o.b}”`
      case 'swap': return `“${o.a}” swapped to “${o.b}”`
      default: return `“${o.b}” in place of “${o.a}”`
    }
  }).join(', ')
}

/** Number of edits in the alignment (matches the Damerau-Levenshtein distance). */
export function editDistance(a: string, b: string): number {
  return diffChars(a, b).reduce((s, o) => s + (o.t === 'eq' ? 0 : 1), 0)
}
