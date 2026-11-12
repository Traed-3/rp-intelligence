import { cn } from '@/lib/utils'
import { RingLoader } from './ring-loader'

/** A placeholder block in the shape of what is loading. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('rp-skeleton', className)} aria-hidden />
}

/** Page-shaped loading state: the rp-ring loader next to a title bar, then tiles and rows. */
export function PageSkeleton({ tiles = 4, rows = 6 }: { tiles?: number; rows?: number }) {
  return (
    <div className="rp-page" aria-busy="true">
      <div className="mb-6 flex items-center gap-3 text-brand">
        <RingLoader className="size-6" />
        <Skeleton className="h-7 w-48" />
      </div>
      {tiles > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      )}
      <Skeleton className="mb-3 h-10" />
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
    </div>
  )
}
