import { Fragment, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/lib/perf'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { tween } from '@/lib/motion'

/**
 * Table primitives. Rounded outer container, 56px rows, subtle separators, hover.
 * Below 768px rows collapse into stacked cards — give each <Td> a `label` to caption it.
 *
 *   <TableContainer><Table>
 *     <THead><Tr><Th>Package</Th><Th align="right">Risk</Th></Tr></THead>
 *     <TBody><Tr onClick={…}><Td label="Package">…</Td><Td label="Risk" align="right">…</Td></Tr></TBody>
 *   </Table></TableContainer>
 */
export function TableContainer({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('overflow-hidden rounded-r3 border border-hair bg-card shadow-card', className)} {...rest}>
      <div className="overflow-x-auto md:overflow-visible">{children}</div>
    </div>
  )
}

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('rt-responsive w-full border-collapse text-left text-[13.5px]', className)} {...rest} />
}
export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-hair bg-white/[.015]', className)} {...rest} />
}
export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

export function Th({ align = 'left', className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      scope="col"
      className={cn('h-11 whitespace-nowrap px-5 text-[11px] font-medium uppercase tracking-[.09em] text-ink-3', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}
      {...rest}
    />
  )
}

export function Tr({
  interactive, selected, className, ...rest
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean; selected?: boolean }) {
  return (
    <tr
      className={cn(
        'h-14 border-b border-white/[.05] transition-colors duration-micro last:border-b-0',
        (interactive || rest.onClick) && 'cursor-pointer',
        'hover:bg-white/[.025]', selected && 'bg-accent/[.05]', className,
      )}
      {...rest}
    />
  )
}

export function Td({
  label, align = 'left', className, children, ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { label?: string; align?: 'left' | 'right' | 'center' }) {
  return (
    <td
      data-label={label}
      className={cn('px-5 py-2 align-middle', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}
      {...rest}
    >
      {children}
    </td>
  )
}

/**
 * A row that expands to reveal `detail` (animated height). Renders two <tr>s.
 * `onToggle` receives the row id; the caller owns which rows are open.
 */
export function ExpandableTr({
  open, onToggle, colSpan, detail, children, className, ariaLabel = 'Toggle details',
}: {
  open: boolean
  onToggle: () => void
  colSpan: number
  detail: ReactNode
  children: ReactNode
  className?: string
  ariaLabel?: string
}) {
  const reduced = !!useReducedMotion()
  return (
    <Fragment>
      <Tr onClick={onToggle} selected={open} className={className}>
        {children}
        <Td className="w-10 pr-4 text-right md:table-cell">
          <button
            type="button" aria-label={ariaLabel} aria-expanded={open}
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            className="grid h-8 w-8 place-items-center rounded-r1 text-ink-3 hover:bg-white/[.06] hover:text-ink"
          >
            <ChevronRight size={16} className={cn('transition-transform duration-comp ease-ripple', open && 'rotate-90')} />
          </button>
        </Td>
      </Tr>
      <AnimatePresence initial={false}>
        {open && (
          <tr className="border-b border-white/[.05] bg-black/20">
            <td colSpan={colSpan + 1} className="p-0">
              <motion.div
                initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1, transition: tween(0.32) }}
                exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, transition: tween(0.22) }}
                className="overflow-hidden"
              >
                <div className="px-5 py-4">{detail}</div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </Fragment>
  )
}
