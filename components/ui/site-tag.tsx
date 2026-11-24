import { cn } from '@/lib/utils'

/** Site / store number tag: mono, light blue. Same look everywhere a site number appears. */
export function SiteTag({ site, className }: { site: string; className?: string }) {
  return <span className={cn('rp-site-tag', className)}>{site}</span>
}
