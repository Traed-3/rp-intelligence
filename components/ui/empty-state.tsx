import { cn } from '@/lib/utils'

/** Nothing here yet: an icon if it helps, one helpful line, and at most one action. */
export function EmptyState({ icon, action, className, children }: {
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('rp-empty', className)}>
      {icon && <div className="text-gray-400 [&_svg]:size-6">{icon}</div>}
      <p>{children}</p>
      {action}
    </div>
  )
}
