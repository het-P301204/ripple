import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'

/** 1 … 4 5 [6] 7 8 … 20 */
function pageList(page: number, pages: number): Array<number | 'gap'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1)
  const set = new Set([1, pages, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((n) => set.add(n))
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => set.add(n))
  const nums = [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const out: Array<number | 'gap'> = []
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) out.push('gap'); out.push(n) })
  return out
}

/** Table footer: range text + prev / numbered / next controls. */
export function Pagination({
  page, pageSize, total, onPage,
}: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-hair px-5 py-3.5 sm:flex-row">
      <p role="status" aria-live="polite" className="text-[12.5px] text-ink-3">
        Showing <span className="tnum text-ink-2">{from}–{to}</span> of <span className="tnum text-ink-2">{total}</span> packages
      </p>
      {pages > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <Button icon size="sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></Button>
          {pageList(page, pages).map((n, i) =>
            n === 'gap' ? (
              <span key={`g${i}`} aria-hidden className="w-6 text-center text-ink-4">…</span>
            ) : (
              <button
                key={n} type="button" onClick={() => onPage(n)} aria-label={`Page ${n}`} aria-current={n === page ? 'page' : undefined}
                className={cn(
                  'tnum h-8 min-w-8 rounded-r1 px-2 text-[13px] font-medium transition-colors duration-micro',
                  n === page ? 'bg-white/[.08] text-ink' : 'text-ink-3 hover:bg-white/[.05] hover:text-ink',
                )}
              >
                {n}
              </button>
            ),
          )}
          <Button icon size="sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></Button>
        </nav>
      )}
    </div>
  )
}
