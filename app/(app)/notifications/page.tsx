import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { markNotificationRead, markAllNotificationsRead } from './actions'
import { cn } from '@/lib/utils'

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
  if (diff < 1)    return 'just now'
  if (diff < 60)   return `${diff}m ago`
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`
  return `${Math.floor(diff / 1440)}d ago`
}

export default async function NotificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, company_id').eq('id', user!.id).single()

  const { data: notifications } = await admin
    .from('notifications')
    .select('id, type, title, message, link, is_read, created_at')
    .eq('company_id', profile!.company_id)
    .or(`recipient_id.is.null,recipient_id.eq.${profile!.id}`)
    .order('created_at', { ascending: false })
    .limit(50)

  const unreadCount = (notifications ?? []).filter(n => !n.is_read).length

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <form action={markAllNotificationsRead}>
            <button
              type="submit"
              className="text-sm font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
            >
              Mark all read
            </button>
          </form>
        )}
      </div>

      {!notifications?.length ? (
        <div className="rp-card p-12 text-center">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-semibold text-gray-900">All clear</p>
          <p className="text-sm text-gray-500 mt-1">No notifications yet.</p>
        </div>
      ) : (
        <div className="rp-card overflow-hidden divide-y divide-gray-50">
          {notifications.map(n => {
            async function handleRead() {
              'use server'
              await markNotificationRead(n.id)
            }

            return (
              <div
                key={n.id}
                className={cn(
                  'px-5 py-4 flex items-start gap-4 hover:bg-gray-50 transition-colors',
                  !n.is_read && 'bg-blue-50/50'
                )}
              >
                <span className="text-2xl shrink-0 mt-0.5">
                  {TYPE_ICON[n.type] ?? TYPE_ICON.default}
                </span>
                <div className="flex-1 min-w-0">
                  {n.link ? (
                    <Link href={n.link} className="text-sm font-semibold text-gray-900 hover:text-blue-600">
                      {n.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                  )}
                  {n.message && (
                    <p className="text-sm text-gray-600 mt-0.5">{n.message}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
                </div>
                {!n.is_read && (
                  <form action={handleRead}>
                    <button
                      type="submit"
                      className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
                    >
                      Mark read
                    </button>
                  </form>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
