'use client'

import { useTransition } from 'react'

/** Row of status buttons for quotes/invoices. Highlights the current one. */
export function StatusButtons({
  id,
  current,
  options,
  action,
}: {
  id: string
  current: string
  options: ReadonlyArray<{ value: string; label: string }>
  action: (id: string, status: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          disabled={isPending || o.value === current}
          onClick={() => startTransition(() => { action(id, o.value) })}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-60 ${
            o.value === current
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
