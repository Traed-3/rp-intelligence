import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signedWorkOrderDocUrl } from '@/lib/svc-gmail-sync'
import { WorkOrderDocReviewForm } from '@/components/svc/work-order-doc-review-form'

export default async function WorkOrderDocReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()
  const companyId = profile!.company_id

  const { data: doc } = await admin
    .from('svc_work_order_documents')
    .select('*, svc_work_orders(id, site_number, portal_wo_number, site_address, site_city, site_state), profiles!svc_work_order_documents_verified_by_fkey(full_name)')
    .eq('id', id).eq('company_id', companyId).maybeSingle()
  if (!doc) notFound()

  const attachments = doc.attachments as { name: string; mime: string; path: string; size: number }[]
  const urls = await Promise.all(attachments.map(a => signedWorkOrderDocUrl(a.path)))
  const wo = (doc as any).svc_work_orders as { id: string; site_number: string | null; portal_wo_number: string | null; site_address: string | null; site_city: string | null; site_state: string | null } | null
  const verifier = (doc as any).profiles as { full_name: string } | null

  const { data: existingTickets } = wo
    ? await admin.from('service_tickets').select('id, ticket_number').eq('company_id', companyId).eq('work_order_id', wo.id).neq('status', 'void').order('created_at', { ascending: false })
    : { data: [] as { id: string; ticket_number: string }[] }

  const ai = doc.extracted as { transcript: string; manager_signature_visible: boolean; notes: string | null; technician_name?: string | null } | null

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <Link href="/service/tickets/inbox" className="text-sm text-gray-500 hover:text-gray-700">← Completed Ticket Review</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="rp-title">{wo?.site_number ?? 'Unmatched work order'}</h1>
            <p className="text-sm text-gray-500">
              {wo?.portal_wo_number && <span className="font-mono">{wo.portal_wo_number}</span>}
              {wo?.site_address && ` · ${wo.site_address}`}
              {' · '}from {doc.sender} · {doc.received_at ? new Date(doc.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
            doc.status === 'linked' ? 'bg-purple-100 text-purple-800 border-purple-200'
            : doc.status === 'ready' ? 'bg-green-100 text-green-800 border-green-200'
            : doc.status === 'dismissed' ? 'bg-gray-100 text-gray-500 border-gray-200'
            : 'bg-amber-100 text-amber-800 border-amber-200'
          }`}>{doc.status.replace('_', ' ')}</span>
        </div>
      </div>

      {doc.status === 'linked' && doc.service_ticket_id && (
        <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
          Sent to <Link href={`/service/tickets/${doc.service_ticket_id}`} className="underline font-medium">the service ticket</Link> — carry on there for labor, parts, and signatures.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Attachment{attachments.length !== 1 ? 's' : ''}</h2>
          {attachments.map((a, i) => (
            <div key={a.path} className="rp-card p-3">
              <p className="text-xs text-gray-500 mb-1">{a.name}</p>
              {urls[i] ? (
                /^image\//.test(a.mime) ? (
                  <a href={urls[i]!} target="_blank" rel="noopener"><img src={urls[i]!} alt={a.name} className="rounded-lg border border-gray-200 max-h-[520px] object-contain w-full" /></a>
                ) : /pdf/.test(a.mime) ? (
                  <>
                    <iframe src={urls[i]!} title={a.name} className="w-full h-[520px] rounded-lg border border-gray-200" />
                    <a href={urls[i]!} target="_blank" rel="noopener" className="text-xs text-blue-600 mt-1 inline-block">Open full size ↗</a>
                  </>
                ) : (
                  <a href={urls[i]!} target="_blank" rel="noopener" className="text-xs text-blue-600 inline-block">Download ↗</a>
                )
              ) : <p className="text-xs text-gray-400">Preview unavailable.</p>}
            </div>
          ))}
        </div>

        <div className="lg:col-span-3">
          <WorkOrderDocReviewForm
            docId={doc.id}
            status={doc.status}
            transcript={doc.transcript}
            managerSignatureVerified={doc.manager_signature_verified}
            verifiedByName={verifier?.full_name ?? null}
            verifiedAt={doc.verified_at}
            extractStatus={doc.extract_status}
            extractError={doc.extract_error}
            aiDraft={ai ? { transcript: ai.transcript, manager_signature_visible: ai.manager_signature_visible, notes: ai.notes } : null}
            hasWorkOrder={!!wo}
            existingTickets={existingTickets ?? []}
          />
        </div>
      </div>
    </div>
  )
}
