'use client'

import { useTransition } from 'react'
import { cn } from '@/lib/utils'

type Action = { label: string; nextStatus: string; style?: string }

export function StatusButtons({
  actions,
  ticketId,
}: {
  actions: Action[]
  ticketId: string
}) {
  const [isPending, startTransition] = useTransition()

  async function handleClick(nextStatus: string) {
    startTransition(async () => {
      const res = await fetch(`/api/tickets/${ticketId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextStatus }),
      })
      if (res.ok) {
        window.location.reload()
      }
    })
  }

  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {actions.map((a) => (
        <button
          key={a.nextStatus}
          onClick={() => handleClick(a.nextStatus)}
          disabled={isPending}
          className={cn(
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50',
            a.style === 'primary'
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-card text-gray-700 border border-gray-300 hover:bg-gray-50'
          )}
        >
          {isPending ? '…' : a.label}
        </button>
      ))}
    </div>
  )
}
