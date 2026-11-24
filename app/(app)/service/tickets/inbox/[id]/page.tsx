import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signedWorkOrderDocUrl } from '@/lib/svc-gmail-sync'
import { WorkOrderDocReviewForm } from '@/components/svc/work-order-doc-review-form'
import { PAGE_KIND_LABEL, type TicketPart, type TicketPage, fmtDay, hoursLabel } from '@/lib/ticket-log'

export default async function WorkOrderDocReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params
  const fromLog = (await searchParams).from === 'log'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()
  const companyId = profile!.company_id

  const { data: doc } = await admin
    .from('svc_work_order_documents')
    .select('*, svc_work_orders(id, site_number, portal_wo_number, site_address, site_city, site_state), con_jobs(id, job_number, site_number), profiles!svc_work_order_documents_verified_by_fkey(full_name)')
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

  // The ticket record: what the reader pulled apart (front, back, parts, header fields).
  const job = (doc as any).con_jobs as { id: string; job_number: string | null; site_number: string | null } | null
  const parts = (Array.isArray(doc.parts) ? doc.parts : []) as TicketPart[]
  const pageKinds = new Map(((Array.isArray(doc.pages) ? doc.pages : []) as TicketPage[]).map(p => [p.name, p]))
  const [{ data: tracker }, { data: original }, { data: copies }] = await Promise.all([
    doc.tracker_row_id
      ? admin.from('ticket_tracker_entries').select('work_date, site, technicians, onsite_hours, task_type, description, parts, status').eq('smartsheet_row_id', doc.tracker_row_id).maybeSingle()
      : Promise.resolve({ data: null }),
    doc.duplicate_of
      ? admin.from('svc_work_order_documents').select('id, subject, sender, received_at').eq('id', doc.duplicate_of).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from('svc_work_order_documents').select('id, subject, sender, received_at').eq('duplicate_of', doc.id).order('received_at'),
  ])
  const facts: [string, string | null][] = [
    ['Date on ticket', doc.work_date ? fmtDay(doc.work_date) : null],
    ['Site', doc.ticket_site],
    ['Work order', doc.ticket_wo_number],
    ['Technician', doc.technician],
    ['Helper', doc.helper],
    ['Truck', doc.truck],
    ['On-site hours', doc.onsite_hours != null ? hoursLabel(doc.onsite_hours, doc.crew_size) : null],
    ['Return trip', doc.completion === 'rtn' ? (doc.rtn_needed || 'Needed') : doc.completion === 'complete' ? 'No — complete' : null],
  ]
  const hasRecord = doc.extract_version >= 2 && doc.extract_status === 'done'

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        {fromLog
          ? <Link href="/service/tickets/log" className="text-sm text-gray-500 hover:text-gray-700">← All Tickets</Link>
          : <Link href="/service/tickets/inbox" className="text-sm text-gray-500 hover:text-gray-700">← Completed Ticket Review</Link>}
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="rp-title">{wo?.site_number ?? job?.site_number ?? doc.ticket_site ?? 'Unmatched work order'}</h1>
            <p className="text-sm text-gray-500">
              {wo?.portal_wo_number && <Link href={`/service/${wo.id}`} className="font-mono text-blue-600 hover:text-blue-800">{wo.portal_wo_number}</Link>}
              {!wo && job && <Link href={`/construction/jobs/${job.id}`} className="text-blue-600 hover:text-blue-800">Construction job {job.job_number ?? ''}</Link>}
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

      {original && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          This is a forwarded copy of <Link href={`/service/tickets/inbox/${original.id}${fromLog ? '?from=log' : ''}`} className="underline font-medium">the ticket {original.sender} sent {fmtDay(original.received_at)}</Link>. The log counts it once.
        </div>
      )}
      {(copies ?? []).length > 0 && (
        <p className="mb-4 text-xs text-gray-500">
          Also received as {(copies ?? []).length === 1 ? 'a forwarded copy' : `${(copies ?? []).length} forwarded copies`}:{' '}
          {(copies ?? []).map((c, i) => (
            <span key={c.id}>{i > 0 && ', '}<Link href={`/service/tickets/inbox/${c.id}${fromLog ? '?from=log' : ''}`} className="text-blue-600 hover:text-blue-800">{c.sender} {fmtDay(c.received_at)}</Link></span>
          ))}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Attachment{attachments.length !== 1 ? 's' : ''}</h2>
          {attachments.map((a, i) => (
            <div key={a.path} className="rp-card p-3">
              <p className="text-xs text-gray-500 mb-1">
                {pageKinds.get(a.name) && <span className="font-semibold text-gray-700 mr-1.5">{PAGE_KIND_LABEL[pageKinds.get(a.name)!.kind] ?? 'Other'}</span>}
                {a.name}
                {pageKinds.get(a.name)?.note && <span className="block text-gray-400">{pageKinds.get(a.name)!.note}</span>}
              </p>
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

        <div className="lg:col-span-3 space-y-4">
          {hasRecord && (
            <>
              <div className="rp-card p-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Ticket</h2>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                  {facts.filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><dt className="text-xs text-gray-400">{k}</dt><dd className="text-gray-900">{v}</dd></div>
                  ))}
                </dl>
              </div>

              <div className="rp-card p-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Front of ticket</h2>
                {doc.front_text
                  ? <p className="text-sm text-gray-900 whitespace-pre-wrap">{doc.front_text}</p>
                  : <p className="text-sm text-gray-400">No written ticket front was found in what was sent.</p>}
              </div>

              <div className="rp-card p-4">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Back of ticket / parts</h2>
                {doc.back_text
                  ? <p className="text-sm text-gray-900 whitespace-pre-wrap mb-3">{doc.back_text}</p>
                  : <p className="text-sm text-gray-400 mb-3">No back of ticket or parts page was sent.</p>}
                {parts.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="py-1.5 pr-3 w-12">Qty</th><th className="py-1.5 pr-3">Part / material</th><th className="py-1.5 pr-3">Part #</th><th className="py-1.5">From</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {parts.map((p, i) => (
                        <tr key={i}>
                          <td className="py-1.5 pr-3 tabular-nums text-gray-700">{p.qty ?? '—'}</td>
                          <td className="py-1.5 pr-3 text-gray-900">{p.description || '—'}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs text-gray-700">{p.part_number ?? '—'}</td>
                          <td className="py-1.5 text-xs text-gray-400">{p.source === 'back' ? 'Back of ticket' : p.source === 'front' ? 'Front' : p.source === 'tag' ? 'Part tag' : p.source === 'packing_list' ? 'Packing list' : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {doc.other_text && (
                <details className="rp-card p-4">
                  <summary className="text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer">Other pages (tags, printouts, work order screens)</summary>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap mt-2">{doc.other_text}</p>
                </details>
              )}
            </>
          )}

          {tracker && (
            <div className="rp-card p-4">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Smartsheet ticket tracker — what the crew typed</h2>
              <p className="text-xs text-gray-500 mb-1">{tracker.site} · {fmtDay(tracker.work_date)} · {tracker.technicians} · {tracker.onsite_hours ?? '—'} h{tracker.status ? ` · ${tracker.status}` : ''}</p>
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{tracker.description}</p>
              {tracker.parts && !/^(n\/?a?|0|none)$/i.test(tracker.parts.trim()) && <p className="text-sm text-gray-700 mt-1"><span className="text-gray-400">Parts:</span> {tracker.parts}</p>}
            </div>
          )}

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
