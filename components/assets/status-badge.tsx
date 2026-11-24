import { cn } from '@/lib/utils'
import { ChangeFlash } from '@/components/ui/change-flash'

const config: Record<string, { label: string; className: string }> = {
  active:    { label: 'Active',     className: 'bg-green-100 text-green-800 border-green-200' },
  available: { label: 'Available',  className: 'bg-blue-100 text-blue-800 border-blue-200' },
  in_shop:   { label: 'In Shop',    className: 'bg-amber-100 text-amber-800 border-amber-200' },
  down:      { label: 'Down',       className: 'bg-red-100 text-red-800 border-red-200' },
  unsafe:    { label: 'Unsafe ⚠',   className: 'bg-red-200 text-red-900 border-red-300' },
  retired:   { label: 'Retired',    className: 'bg-gray-100 text-gray-500 border-gray-200' },
  property:  { label: 'Property',   className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
}

export function StatusBadge({ status }: { status: string }) {
  const c = config[status] ?? config.active
  return (
    <ChangeFlash value={status}>
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border',
        c.className
      )}
    >
      {c.label}
    </span>
    </ChangeFlash>
  )
}
