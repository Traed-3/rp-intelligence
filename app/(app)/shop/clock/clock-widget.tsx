'use client'

import { useEffect, useState, useTransition } from 'react'

function formatElapsed(ms: number) {
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatMins(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

export function ClockWidget({
  isClockedIn,
  clockInTime,
  todayCompletedMins,
  clockInAction,
  clockOutAction,
  setJobAction,
  jobs = [],
  currentJobId = null,
  currentStore = null,
}: {
  isClockedIn: boolean
  clockInTime: string | null
  todayCompletedMins: number
  clockInAction: (target?: { con_job_id?: string | null; store_number?: string | null }) => Promise<void>
  clockOutAction: () => Promise<void>
  setJobAction?: (target: { con_job_id?: string | null; store_number?: string | null }) => Promise<void>
  jobs?: { id: string; label: string }[]
  currentJobId?: string | null
  currentStore?: string | null
}) {
  const [jobId, setJobId] = useState(currentJobId ?? '')
  const [store, setStore] = useState(currentStore ?? '')
  const target = () => ({ con_job_id: jobId || null, store_number: jobId ? null : store || null })
  const jobChanged = isClockedIn && (jobId !== (currentJobId ?? '') || (!jobId && store !== (currentStore ?? '')))
  const [elapsed, setElapsed] = useState(0)
  const [now, setNow] = useState(new Date())
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
      if (isClockedIn && clockInTime) {
        setElapsed(Date.now() - new Date(clockInTime).getTime())
      }
    }, 1000)
    // Set initial elapsed
    if (isClockedIn && clockInTime) {
      setElapsed(Date.now() - new Date(clockInTime).getTime())
    }
    return () => clearInterval(interval)
  }, [isClockedIn, clockInTime])

  const currentElapsedMins = Math.floor(elapsed / 60000)
  const totalTodayMins = todayCompletedMins + (isClockedIn ? currentElapsedMins : 0)

  function handleAction() {
    startTransition(async () => {
      if (isClockedIn) {
        await clockOutAction()
      } else {
        await clockInAction(target())
      }
    })
  }

  return (
    <div className="rp-card p-8 text-center">
      {/* Current time */}
      <p className="text-5xl font-bold text-gray-900 tabular-nums tracking-tight">
        {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>

      {/* Elapsed time if clocked in */}
      {isClockedIn && (
        <div className="mt-6 py-3 bg-green-50 rounded-xl border border-green-100">
          <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-0.5">Clocked In For</p>
          <p className="text-3xl font-bold text-green-700 tabular-nums">{formatElapsed(elapsed)}</p>
        </div>
      )}

      {/* Total today */}
      {totalTodayMins > 0 && (
        <p className="text-sm text-gray-500 mt-3">
          Total today: <span className="font-semibold text-gray-700">{formatMins(totalTodayMins)}</span>
        </p>
      )}

      {/* Which job — receipts snapped while clocked in default to it */}
      {jobs.length > 0 && (
        <div className="mt-6 text-left">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">{isClockedIn ? 'Working on' : 'Clock into'}</label>
          <select value={jobId} onChange={e => setJobId(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Shop / no job</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
          {!jobId && (
            <input value={store} onChange={e => setStore(e.target.value)} placeholder="Or store # (service call)"
              className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          )}
          {jobChanged && setJobAction && (
            <button type="button" disabled={isPending} onClick={() => startTransition(async () => { await setJobAction(target()) })}
              className="mt-2 w-full py-2 rounded-xl border border-blue-200 bg-blue-50 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60">
              Switch to this job
            </button>
          )}
        </div>
      )}

      {/* Big clock button */}
      <button
        onClick={handleAction}
        disabled={isPending}
        className={`mt-8 w-full py-5 rounded-2xl text-xl font-bold transition-all disabled:opacity-60 ${
          isClockedIn
            ? 'bg-red-500 hover:bg-red-600 text-white'
            : 'bg-green-500 hover:bg-green-600 text-white'
        }`}
      >
        {isPending ? '…' : isClockedIn ? '🔴  Clock Out' : '🟢  Clock In'}
      </button>

      <p className="text-xs text-gray-400 mt-3">
        {isClockedIn ? 'Tap to end your shift' : 'Tap to start your shift'}
      </p>
    </div>
  )
}
