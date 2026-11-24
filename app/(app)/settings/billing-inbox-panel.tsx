import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { inboxStatus } from '@/lib/billing-gmail-client'
import { InboxSyncButton } from '@/components/inventory/inbox-sync-button'

/**
 * Settings card: which RPS inboxes the billing sync can read, how to connect the
 * rest, and a manual sync. Tokens never leave the server — only "connected / not".
 */
export async function BillingInboxPanel({ companyId }: { companyId: string }) {
  const admin = createAdminClient()
  const [{ count: queued }, { count: total }] = await Promise.all([
    admin.from('billing_inbox_documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'new'),
    admin.from('billing_inbox_documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
  ])
  const inboxes = inboxStatus()
  const connected = inboxes.filter(i => i.connected).length

  return (
    <div className="rp-card p-5 mb-2">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-100"><Inbox className="w-5 h-5 text-blue-600" /></div>
        <div>
          <p className="font-semibold text-gray-900">Billing inboxes</p>
          <p className="text-sm text-gray-500">Packing slips, vendor invoices and receipts → <Link href="/inventory/receive/queue" className="text-blue-600">Receive queue</Link>. {connected}/{inboxes.length} connected · {queued ?? 0} waiting · {total ?? 0} filed. Syncs every 15 minutes.</p>
        </div>
      </div>

      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100 mb-4">
        {inboxes.map(i => (
          <li key={i.key} className="px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`w-2.5 h-2.5 rounded-full ${i.connected ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="font-medium text-gray-900">{i.email}</span>
            <span className="text-gray-500">{i.purpose}</span>
            <span className={`ml-auto text-xs ${i.connected ? 'text-green-700' : 'text-gray-400'}`}>{i.connected ? `connected (${i.via})` : `not connected — add ${i.envKey}`}</span>
          </li>
        ))}
      </ul>

      <InboxSyncButton />

      {connected < inboxes.length && (
        <details className="mt-4 text-sm text-gray-600">
          <summary className="cursor-pointer text-gray-800 font-medium">How to connect an inbox (one-time, about 3 minutes)</summary>
          <ol className="list-decimal ml-5 mt-2 space-y-1">
            <li>Open <code>https://developers.google.com/oauthplayground</code> in a browser where you can sign in to that Gmail account.</li>
            <li>Click the gear (top right) → tick <b>Use your own OAuth credentials</b> → paste the same <code>GMAIL_CLIENT_ID</code> and <code>GMAIL_CLIENT_SECRET</code> the app already uses (Vercel → Settings → Environment Variables).</li>
            <li>On the left, under <b>Gmail API v1</b>, tick <code>https://www.googleapis.com/auth/gmail.readonly</code> → <b>Authorize APIs</b> → sign in as the inbox you are connecting.</li>
            <li>Click <b>Exchange authorization code for tokens</b> and copy the <b>Refresh token</b>.</li>
            <li>In Vercel → Settings → Environment Variables add it under the name shown above (for example <code>GMAIL_TOKEN_ECONSTRUCTION</code>) for Production, then Redeploy.</li>
          </ol>
          <p className="mt-2 text-xs text-gray-500">Read-only scope: the app can read and download attachments but can never send, delete, or move mail in that inbox.</p>
        </details>
      )}
    </div>
  )
}
