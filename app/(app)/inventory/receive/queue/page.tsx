import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { inboxStatus } from '@/lib/billing-gmail-client'
import { InboxSyncButton } from '@/components/inventory/inbox-sync-button'
import { fmtDate } from '@/lib/inventory'

const KIND_LABEL: Record<string, string> = { packing_slip: 'Packing slip', vendor_invoice: 'Vendor invoice', receipt: 'Receipt', vendor_quote: 'Vendor quote', customer_invoice: 'Our invoice', other: 'Other' }
const KIND_CLASS: Record<string, string> = { packing_slip: 'bg-blue-50 text-blue-700 border-blue-200', vendor_invoice: 'bg-purple-50 text-purple-700 border-purple-200', receipt: 'bg-green-50 text-green-700 border-green-200', vendor_quote: 'bg-amber-50 text-amber-800 border-amber-200', customer_invoice: 'bg-gray-100 text-gray-600 border-gray-200', other: 'bg-gray-50 text-gray-500 border-gray-200' }
const TABS = [['new', 'To do'], ['received', 'Received'], ['cost_updated', 'Cost updated'], ['dismissed', 'Dismissed'], ['linked', 'Our paperwork']] as const
const th = 'text-left px-4 py-3 font-medium text-gray-500'

export default async function ReceiveQueuePage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = 'new' } = await searchParams
  const { company_id, canWrite } = await requireInventory()
  const admin = createAdminClient()
  const [{ data: docs }, { count: newCount }] = await Promise.all([
    admin.from('billing_inbox_documents').select('id, inbox, sender, sender_email, subject, received_at, kind, vendor, reference, attachments, extract_status, extracted, status, thread_replies, stock_locations(name)')
      .eq('company_id', company_id).eq('status', status).order('received_at', { ascending: false }).limit(150),
    admin.from('billing_inbox_documents').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('status', 'new'),
  ])
  const inboxes = inboxStatus()
  const connected = inboxes.filter(i => i.connected)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">Receive queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Packing slips, vendor invoices and receipts pulled from the RPS inboxes. Open one, check the lines, put them into stock.</p>
        </div>
        <div className="flex items-center gap-3">
          {canWrite && connected.length > 0 && <InboxSyncButton compact />}
          <Link href="/inventory/receive" className="text-sm text-gray-500 hover:text-gray-700">← Receive</Link>
        </div>
      </div>

      <div className="rp-card px-4 py-2.5 text-xs text-gray-600 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-gray-800">Inboxes</span>
        {inboxes.map(i => <span key={i.key} className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${i.connected ? 'bg-green-500' : 'bg-gray-300'}`} />{i.email}{!i.connected && <span className="text-gray-400">(not connected)</span>}</span>)}
        <Link href="/settings" className="text-blue-600 hover:text-blue-800 ml-auto">Connect in Settings →</Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map(([s, label]) => (
          <Link key={s} href={`/inventory/receive/queue?status=${s}`} className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${status === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {label}{s === 'new' && (newCount ?? 0) > 0 ? ` (${newCount})` : ''}
          </Link>
        ))}
      </div>

      <div className="rp-card overflow-hidden">
        {(docs ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">{status === 'new' ? (connected.length ? 'Nothing waiting. New paperwork shows up here within 15 minutes of landing in an inbox.' : 'No inboxes are connected yet, so nothing can arrive here. Connect one in Settings → Billing inboxes.') : 'Nothing here.'}</p>
        ) : (
          <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50"><th className={th}>Received</th><th className={th}>Kind</th><th className={th}>From</th><th className={`${th} hidden md:table-cell`}>Subject</th><th className={`${th} hidden sm:table-cell`}>Ref</th><th className={`${th} text-right`}>Lines</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {(docs ?? []).map(d => {
                const lines = (d.extracted as { lines?: unknown[] } | null)?.lines?.length ?? null
                const atts = (d.attachments as unknown[]).length
                const loc = (d as unknown as { stock_locations: { name: string } | null }).stock_locations
                const lastReply = ((d.thread_replies ?? []) as { from: string; text: string }[]).at(-1)
                return (
                  <ClickableRow key={d.id} href={`/inventory/receive/queue/${d.id}`}>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(d.received_at)}<div className="text-xs text-gray-400">{d.inbox}</div></td>
                    <td className="px-4 py-3 whitespace-nowrap"><span className={`text-xs px-2 py-0.5 rounded-full border ${KIND_CLASS[d.kind] ?? ''}`}>{KIND_LABEL[d.kind] ?? d.kind}</span></td>
                    <td className="px-4 py-3 text-gray-900">{d.vendor ?? d.sender}<div className="text-xs text-gray-400">{d.sender_email}</div></td>
                    <td className="px-4 py-3 text-gray-700 hidden md:table-cell max-w-72 truncate">{d.subject}<div className="text-xs text-gray-400">{atts} attachment{atts === 1 ? '' : 's'}{loc ? ` · ${loc.name}` : ''}</div>{lastReply && <div className="text-xs text-emerald-700 truncate" title={lastReply.text}>↩ {lastReply.from}: {lastReply.text}</div>}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs hidden sm:table-cell">{d.reference ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.extract_status === 'done' ? lines : <span className={`text-xs ${d.extract_status === 'failed' ? 'text-red-600' : 'text-amber-700'}`}>{d.extract_status === 'pending' ? 'reading…' : d.extract_status === 'failed' ? 'failed' : 'by hand'}</span>}</td>
                    <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Open →</span></td>
                  </ClickableRow>
                )
              })}
            </tbody></table></div>
        )}
      </div>
    </div>
  )
}
