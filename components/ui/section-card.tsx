import { cn } from '@/lib/utils'

/**
 * A titled block on a page. Give it a title (and an optional action, like an
 * "All →" link) and it draws the header row; `flush` removes the body padding
 * so a table or list can run edge to edge.
 */
export function SectionCard({ title, hint, action, flush, className, children }: {
  title?: React.ReactNode
  hint?: React.ReactNode
  action?: React.ReactNode
  flush?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn('rp-card overflow-hidden', className)}>
      {(title || action) && (
        <div className="rp-card-head">
          <div className="min-w-0">
            <h2 className="rp-card-title">{title}</h2>
            {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
          </div>
          {action && <div className="flex items-center gap-2 text-xs">{action}</div>}
        </div>
      )}
      <div className={flush ? undefined : 'p-5'}>{children}</div>
    </section>
  )
}

/** Small uppercase label that sits above a group of things. */
export function SectionLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('rp-label', className)}>{children}</h2>
}
