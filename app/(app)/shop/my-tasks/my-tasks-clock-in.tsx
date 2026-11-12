'use client'

import { useTransition } from 'react'
import { startWork, pauseWork } from '@/app/(app)/shop/labor-actions'

export function MyTasksClockIn({
  ticketId,
  isActiveOnThis,
  isClockedIn,
}: {
  ticketId: string
  isActiveOnThis: boolean
  isClockedIn: boolean
}) {
  const [isPending, startTransition] = useTransition()

  function handleClockIn() {
    startTransition(async () => {
      await startWork(ticketId)
      window.location.reload()
    })
  }

  function handleClockOut() {
    startTransition(async () => {
      await pauseWork(ticketId)
      window.location.reload()
    })
  }

  if (!isClockedIn) return null

  if (isActiveOnThis) {
    return (
      <button
        onClick={handleClockOut}
        disabled={isPending}
        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white hover:bg-red-600/90 disabled:opacity-50 transition-colors"
      >
        {isPending ? '…' : '🔴 Clock Out'}
      </button>
    )
  }

  return (
    <button
      onClick={handleClockIn}
      disabled={isPending}
      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-600/90 disabled:opacity-50 transition-colors"
    >
      {isPending ? '…' : '🟢 Clock In'}
    </button>
  )
}
