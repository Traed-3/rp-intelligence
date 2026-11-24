'use client'

import { useTransition } from 'react'
import { REQUIREMENT_STATUSES } from '@/lib/permits'

const cls: Record<string, string> = {
  Unknown: 'bg-amber-100 text-amber-800 border-amber-300',
  Required: 'bg-blue-50 text-blue-700 border-blue-200',
  'Not Required': 'bg-gray-100 text-gray-500 border-gray-200',
}

// Resolve an Unknown placeholder to Required or Not Required.
export function PermitRequirementSelect({
  id,
  requirement,
  action,
}: {
  id: string
  requirement: string
  action: (id: string, requirement: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  return (
    <select
      data-no-row-nav
      disabled={isPending}
      value={requirement}
      onChange={(e) => startTransition(() => { action(id, e.target.value) })}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 ${cls[requirement] ?? cls.Unknown}`}
    >
      {REQUIREMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}
