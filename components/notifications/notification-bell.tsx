'use client'

import { useState, useTransition } from 'react'
import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { markNotificationRead, markAllNotificationsRead } from '@/app/(app)/notifications/actions'
import Link from 'next/link'

type Notification = {
  id: string
  type: string
  title: string
  message: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

const TYPE_ICON: Record<string, string> = {
  maintenance_overdue: '🔧',
  asset_unsafe:        '⚠️',
  clock_out_reminder:  '⏰',
  ticket_assigned:     '🎫',
  repeat_purchase:     '🔁',
  default:             '🔔',
}

function timeAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1)   return 'just now'
  if (diff < 60)  return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

export function NotificationBell({
  initialNotifications,
  unreadCount,
}: {
  initialNotifications: Notification[]
  unreadCount: number
}) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [count, setCount] = useState(unreadCount)
  const [isPending, startTransition] = useTransition()

  function handleMarkRead(id: string) {
    startTransition(async () => {
      await markNotificationRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
      setCount(prev => Math.max(0, prev - 1))
    })
  }

  function handleMarkAll() {
    startTransition(async () => {
      await markAllNotificationsRead()
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setCount(0)
    })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />

          {/* Panel */}
          <div className="rp-card absolute right-0 top-10 w-80 shadow-xl z-40 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">Notifications</h3>
              <div className="flex items-center gap-3">
                {count > 0 && (
                  <button
                    onClick={handleMarkAll}
                    disabled={isPending}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Mark all read
                  </button>
                )}
                <Link
                  href="/notifications"
                  onClick={() => setOpen(false)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  View all
                </Link>
              </div>
            </div>

            {/* List */}
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-2xl mb-1">🔔</p>
                  <p className="text-sm text-gray-500">No notifications yet.</p>
                </div>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={cn(
                      'px-4 py-3 hover:bg-gray-50 transition-colors',
                      !n.is_read && 'bg-blue-50/60'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-lg shrink-0 mt-0.5">
                        {TYPE_ICON[n.type] ?? TYPE_ICON.default}
                      </span>
                      <div className="flex-1 min-w-0">
                        {n.link ? (
                          <Link
                            href={n.link}
                            onClick={() => { handleMarkRead(n.id); setOpen(false) }}
                            className="text-sm font-medium text-gray-900 hover:text-blue-600 leading-tight block"
                          >
                            {n.title}
                          </Link>
                        ) : (
                          <p className="text-sm font-medium text-gray-900 leading-tight">{n.title}</p>
                        )}
                        {n.message && (
                          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.message}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                      </div>
                      {!n.is_read && (
                        <button
                          onClick={() => handleMarkRead(n.id)}
                          className="w-2 h-2 rounded-full bg-blue-500 shrink-0 mt-2 hover:bg-blue-700"
                          title="Mark as read"
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
