import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ClickableRow } from '@/components/clickable-row'
import { Inbox } from 'lucide-react'

const TABS = [
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'ready',        label: 'Ready' },
  { value: 'linked',       label: 'Sent to Ticket' },
  { value: 'new',          label: 'Not Yet Drafted' },
  { value: 'dismissed',    label: 'Dismissed' },
]

export default async function WorkOrderDocInboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = 'needs_review' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()
  const companyId = profile!.company_id

  const { data: docs } = await admin
    .from('svc_work_order_documents')
    .select('id, subject, sender, received_at, status, extract_status, manager_signature_verified, work_order_id, svc_work_orders(site_number, portal_wo_number)')
    .eq('company_id', companyId).eq('status', status)
    .order('received_at', { ascending: false }).limit(200)

  const { data: counts } = await admin
    .from('svc_work_order_documents').select('status').eq('company_id', companyId)
  const countByStatus = new Map<string, number>()
  for (const d of counts ?? []) countByStatus.set(d.status, (countByStatus.get(d.status) ?? 0) + 1)

  const list = docs ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/service" className="text-sm text-gray-500 hover:text-gray-700">← Service Dispatch</Link>
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mt-1 before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
          <Inbox className="w-6 h-6 text-blue-600" />Completed Ticket Review
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Photos/scans techs forward into rpinvoicing — confirm the manager's signature and type up the ticket before it heads to invoicing.
          {' '}<Link href="/service/tickets/log" className="text-blue-600 hover:text-blue-800">Search all tickets →</Link>
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-5">
        {TABS.map(t => (
          <Link
            key={t.value}
            href={`/service/tickets/inbox?status=${t.value}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              status === t.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {t.label} <span className="opacity-70">{countByStatus.get(t.value) ?? 0}</span>
          </Link>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rp-card p-12 text-center">
          <p className="text-gray-400 text-sm">Nothing here.</p>
        </div>
      ) : (
        <div className="rp-card overflow-hidden">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3">Work Order</th>
                <th className="text-left px-4 py-3">From</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Subject</th>
                <th className="text-left px-4 py-3">Signature</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Received</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {list.map(d => {
                const wo = (d as any).svc_work_orders as { site_number: string | null; portal_wo_number: string | null } | null
                return (
                  <ClickableRow key={d.id} href={`/service/tickets/inbox/${d.id}`}>
                    <td className="px-4 py-3">
                      {wo ? <span className="font-medium text-gray-900">{wo.site_number ?? '—'}</span> : <span className="text-amber-600 text-xs font-medium">Unmatched</span>}
                      {wo?.portal_wo_number && <div className="text-xs text-gray-400 font-mono">{wo.portal_wo_number}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{d.sender}</td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell truncate max-w-xs">{d.subject}</td>
                    <td className="px-4 py-3">
                      {d.manager_signature_verified
                        ? <span className="text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">Verified</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200">Not checked</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">{d.received_at ? new Date(d.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                    <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Review →</span></td>
                  </ClickableRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
