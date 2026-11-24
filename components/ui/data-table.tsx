import { cn } from '@/lib/utils'

/**
 * Table styling in one place: sticky uppercase header, hairline row dividers,
 * hover rows, tabular numbers. Scrolls sideways inside its own box on a phone,
 * so the page itself never scrolls sideways. Add className="num" (or
 * text-right) to a <th>/<td> for right-aligned money and counts.
 */
export function DataTable({ className, wrapClassName, children, ...props }: React.ComponentProps<'table'> & { wrapClassName?: string }) {
  return (
    <div className={cn('rp-table-wrap', wrapClassName)}>
      <table className={cn('rp-table', className)} {...props}>{children}</table>
    </div>
  )
}
