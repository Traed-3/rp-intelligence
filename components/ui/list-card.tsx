import { cn } from '@/lib/utils'
import type { Tone } from './status-pill'
import { SiteTag } from './site-tag'

/**
 * The list item card (the My Plate card, used app-wide): each item is its own
 * card with a colored left stripe for status, a site tag, a bold title, muted
 * detail, small pills and ONE clear primary action on the right.
 */
export function ListCard({ tone = 'muted', site, title, detail, pills, action, footer, as: Tag = 'li', className, children }: {
  tone?: Tone
  site?: string | null
  title: React.ReactNode
  detail?: React.ReactNode
  pills?: React.ReactNode
  action?: React.ReactNode
  footer?: React.ReactNode
  as?: 'li' | 'div' | 'article'
  className?: string
  children?: React.ReactNode
}) {
  return (
    <Tag className={cn('rp-item', className)} data-tone={tone}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {site && <SiteTag site={site} />}
            <span className="rp-item-title min-w-0">{title}</span>
          </div>
          {detail && <p className="rp-item-detail">{detail}</p>}
          {pills && <div className="flex flex-wrap items-center gap-1.5">{pills}</div>}
          {children}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {footer}
    </Tag>
  )
}
