'use client'

import { useEffect, useState, useTransition } from 'react'
import { startWork, pauseWork, stopWork } from '@/app/(app)/shop/labor-actions'

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

function fmtMins(mins: number) {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

type LaborEntry = {
  id: string
  started_at: string
  ended_at: string | null
  total_minutes: number | null
  entry_type: string
  profiles: { full_name: string } | null
}

export function LaborTimer({
  ticketId,
  isActive,
  startedAt,
  totalLaborHours,
  laborHistory,
  isClockedIn,
}: {
  ticketId: string
  isActive: boolean
  startedAt: string | null
  totalLaborHours: number
  laborHistory: LaborEntry[]
  isClockedIn: boolean
}) {
  const [elapsed, setElapsed] = useState(0)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!isActive || !startedAt) return
    const tick = () => setElapsed(Date.now() - new Date(startedAt).getTime())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isActive, startedAt])

  function handleStart() {
    startTransition(async () => {
      await startWork(ticketId)
      window.location.reload()
    })
  }
  function handlePause() {
    startTransition(async () => {
      await pauseWork(ticketId)
      window.location.reload()
    })
  }
  function handleStop() {
    startTransition(async () => {
      await stopWork(ticketId)
      window.location.reload()
    })
  }

  return (
    <div className="rp-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">Labor Time</h2>
        <span className="text-sm font-semibold text-gray-700">
          Total: {Number(totalLaborHours).toFixed(2)} hrs
        </span>
      </div>

      {/* Active timer */}
      {isActive && startedAt ? (
        <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 mb-4 text-center">
          <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-0.5">
            🟢 Clocked In to Ticket
          </p>
          <p className="text-3xl font-bold text-green-700 tabular-nums">{fmt(elapsed)}</p>
        </div>
      ) : isClockedIn ? (
        <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 mb-4 text-center">
          <p className="text-sm text-gray-500">You are not clocked in to this ticket.</p>
          <p className="text-xs text-gray-400 mt-0.5">Click <strong>Clock In to Ticket</strong> below to start your timer.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 mb-4 text-center">
          <p className="text-sm text-amber-700">Clock in for your shift first, then you can clock in to this ticket.</p>
        </div>
      )}

      {/* Clock In / Out buttons */}
      <div className="flex flex-wrap gap-2 mb-5">
        {!isActive && isClockedIn && (
          <button
            onClick={handleStart}
            disabled={isPending}
            className="flex-1 py-3 rounded-xl text-base font-bold bg-green-600 text-white hover:bg-green-600/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? '…' : '🟢 Clock In to Ticket'}
          </button>
        )}
        {isActive && (
          <>
            <button
              onClick={handlePause}
              disabled={isPending}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : '⏸ Pause Timer'}
            </button>
            <button
              onClick={handleStop}
              disabled={isPending}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-600/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? '…' : '🔴 Clock Out from Ticket'}
            </button>
          </>
        )}
        {!isClockedIn && (
          <p className="text-xs text-amber-600 self-center">Clock in to log time</p>
        )}
      </div>

      {/* Labor history */}
      {laborHistory.length === 0 ? (
        <p className="text-sm text-gray-400">No time logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-1.5 pr-3">Employee</th>
                <th className="text-left py-1.5 pr-3">Start</th>
                <th className="text-left py-1.5 pr-3">End</th>
                <th className="text-right py-1.5">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {laborHistory.map((e) => (
                <tr key={e.id}>
                  <td className="py-1.5 pr-3 text-gray-700">{e.profiles?.full_name ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-gray-600">
                    {new Date(e.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-600">
                    {e.ended_at
                      ? new Date(e.ended_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                      : <span className="text-green-600 font-semibold">Active</span>}
                  </td>
                  <td className="py-1.5 text-right font-semibold text-gray-800">
                    {e.total_minutes != null ? fmtMins(e.total_minutes) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
