'use client'

import { useTransition } from 'react'
import { PERMIT_STATUSES, permitStatusMeta } from '@/lib/permits'

// Inline permit-status dropdown. Every change routes through the server action,
// which logs a permit_events row and runs the auto-resolve rule.
export function PermitStatusSelect({
  id,
  status,
  action,
}: {
  id: string
  status: string
  action: (id: string, status: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  const c = permitStatusMeta(status)
  return (
    <select
      data-no-row-nav
      disabled={isPending}
      value={status}
      onChange={(e) => startTransition(() => { action(id, e.target.value) })}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${c.className}`}
    >
      {PERMIT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.value}</option>)}
    </select>
  )
}
