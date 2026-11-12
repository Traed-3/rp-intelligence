'use client'

import { useTransition } from 'react'

/** Reschedule a schedule entry to another day in the week. */
export function ScheduleMove({
  id,
  current,
  days,
  action,
}: {
  id: string
  current: string
  days: { value: string; label: string }[]
  action: (id: string, date: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  return (
    <select
      data-no-row-nav
      disabled={isPending}
      value={current}
      onChange={(e) => startTransition(() => { action(id, e.target.value) })}
      className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-card text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
    >
      {days.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
    </select>
  )
}
