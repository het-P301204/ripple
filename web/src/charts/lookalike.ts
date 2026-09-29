import type { LookalikeCandidate, LookalikeGroup, Severity } from '@/types/scan'
import { SEVERITY_RANK } from '@/lib/meta'

export const MUTATIONS: Record<string, { label: string; hint: string }> = {
  transposition: { label: 'Transposition', hint: 'Two neighbouring characters swapped.' },
  insertion: { label: 'Insertion', hint: 'An extra character added.' },
  deletion: { label: 'Deletion', hint: 'A character removed.' },
  omission: { label: 'Deletion', hint: 'A character removed.' },
  substitution: { label: 'Substitution', hint: 'One character replaced by another.' },
  homoglyph: { label: 'Homoglyph', hint: 'A visually similar character stands in for a letter.' },
  separator: { label: 'Separator swap', hint: 'Hyphen, underscore or dot interchanged.' },
  prefix_suffix: { label: 'Prefix or suffix', hint: 'A word added before or after the real name.' },
  prefix: { label: 'Prefix', hint: 'A word added before the real name.' },
  suffix: { label: 'Suffix', hint: 'A word added after the real name.' },
  duplication: { label: 'Repeated character', hint: 'A character typed twice.' },
}

export function mutationInfo(m: string): { label: string; hint: string } {
  return MUTATIONS[m] ?? { label: m.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), hint: 'A small edit away from the real name.' }
}

export function worstSeverity(cs: LookalikeCandidate[]): Severity {
  return cs.reduce<Severity>((w, c) => (SEVERITY_RANK[c.severity] > SEVERITY_RANK[w] ? c.severity : w), 'info')
}

/** Most suspicious first (score, then similarity, then name). */
export function bySuspicion(cs: LookalikeCandidate[]): LookalikeCandidate[] {
  return [...cs].sort((a, b) => b.suspicion_score - a.suspicion_score || b.similarity - a.similarity || a.name.localeCompare(b.name))
}

/** Groups ordered for the selector: worst severity, then number of registered lookalikes, then size. */
export function sortGroups(gs: LookalikeGroup[]): LookalikeGroup[] {
  return [...gs].sort((a, b) =>
    SEVERITY_RANK[worstSeverity(b.candidates)] - SEVERITY_RANK[worstSeverity(a.candidates)] ||
    b.candidates.filter((c) => c.registered).length - a.candidates.filter((c) => c.registered).length ||
    b.candidates.length - a.candidates.length)
}

export const groupHref = (g: LookalikeGroup, dupes: boolean) =>
  `/typosquatting/${encodeURIComponent(g.original)}${dupes ? `?eco=${g.ecosystem}` : ''}`
