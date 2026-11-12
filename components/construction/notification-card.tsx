'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { markNotificationSent, clearNotificationSent, setNotificationWaived } from '@/app/(app)/construction/actions'
import type { NotifyStatus } from '@/lib/construction'
import { fmtDate } from '@/lib/construction'
import { FileText } from 'lucide-react'

export function NotificationCard({
  jobId,
  status,
  canWrite,
}: {
  jobId: string
  status: NotifyStatus
  canWrite: boolean
}) {
  const [pending, start] = useTransition()
  const printHref = `/construction/jobs/${jobId}/notification`

  return (
    <div className="rp-card p-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Project Notification</h3>
        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${status.className}`}>{status.label}</span>
      </div>

      {status.state === 'no_start' ? (
        <p className="text-sm text-gray-500">Set a project start date to track the notification deadline.</p>
      ) : status.windowOpen ? (
        <p className="text-xs text-gray-500">
          Send window <span className="font-medium text-gray-700">{fmtDate(status.windowOpen)}</span> → must be sent by <span className="font-medium text-gray-700">{fmtDate(status.deadline)}</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={printHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800">
          <FileText className="w-3.5 h-3.5" /> Open pre-filled notice
        </Link>

        {canWrite && status.state !== 'sent' && status.state !== 'waived' && (
          <>
            <button onClick={() => start(() => { markNotificationSent(jobId) })} disabled={pending}
              className="text-sm font-medium text-white bg-green-600 hover:bg-green-600/90 disabled:opacity-50 rounded-lg px-3 py-1.5">
              {pending ? '…' : 'Mark as sent'}
            </button>
            <button onClick={() => start(() => { setNotificationWaived(jobId, true) })} disabled={pending}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
              Not required
            </button>
          </>
        )}
        {canWrite && status.state === 'sent' && (
          <button onClick={() => start(() => { clearNotificationSent(jobId) })} disabled={pending}
            className="text-sm font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50">
            Undo
          </button>
        )}
        {canWrite && status.state === 'waived' && (
          <button onClick={() => start(() => { setNotificationWaived(jobId, false) })} disabled={pending}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50">
            Mark required
          </button>
        )}
      </div>
    </div>
  )
}
