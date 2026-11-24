'use client'

import { useActionState } from 'react'
import { RefreshCw } from 'lucide-react'
import { runInboxSync, type SyncState } from '@/app/(app)/inventory/inbox-actions'

/** "Sync now" for the billing inboxes — pulls the last two weeks and reads a few documents. */
export function InboxSyncButton({ compact = false }: { compact?: boolean }) {
  const [state, action, pending] = useActionState(async () => runInboxSync(), {} as SyncState)
  return (
    <form action={action} className={compact ? 'inline-flex items-center gap-2' : 'space-y-2'}>
      <button type="submit" disabled={pending} className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
        <RefreshCw className={`w-4 h-4 ${pending ? 'animate-spin' : ''}`} />{pending ? 'Syncing…' : 'Sync inboxes now'}
      </button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      {state?.summary && <span className="text-xs text-gray-600">{state.summary}</span>}
    </form>
  )
}
