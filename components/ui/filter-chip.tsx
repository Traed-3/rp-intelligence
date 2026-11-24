import Link from 'next/link'
import { cn } from '@/lib/utils'

/** A filter chip that is a link (filters live in the URL across the app). */
export function FilterChip({ href, active, count, className, children }: {
  href: string
  active?: boolean
  count?: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link href={href} className={cn('rp-chip', className)} aria-current={active ? 'true' : undefined}>
      {children}
      {count !== undefined && <span className="tabular-nums opacity-70">{count}</span>}
    </Link>
  )
}
