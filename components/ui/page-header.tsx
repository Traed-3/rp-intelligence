import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Crumb = { label: string; href?: string }

/**
 * The one page header: optional breadcrumb, the page title (display style),
 * a quieter one-line description, and the page's actions on the right.
 * On a phone the actions drop under the title.
 */
export function PageHeader({ title, description, crumbs, actions, icon, className }: {
  title: React.ReactNode
  description?: React.ReactNode
  crumbs?: Crumb[]
  actions?: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="rp-crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3.5 opacity-60" aria-hidden />}
                {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="rp-title flex items-center gap-2.5">{icon}{title}</h1>
        {description && <p className="rp-subtitle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
