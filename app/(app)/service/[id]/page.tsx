import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { WorkOrderStatusBadge, PriorityBadge, clientLabel } from '@/components/svc/work-order-badges'
import { createServiceTicket } from '@/app/(app)/service/tickets/actions'
import { createJobFromWorkOrder } from '@/app/(app)/construction/actions'
import { linkConstructionJob } from '@/app/(app)/service/actions'
import { loadConstructionLinks, woTokens } from '@/lib/svc-construction-link'
import { CON_STAGE_LABEL, CON_DONE_STAGES } from '@/lib/con-stage'
import { canWriteConstruction } from '@/lib/construction'

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  const { data: w } = await admin
    .from('svc_work_orders')
    .select(`*, svc_technicians(full_name, personal_email)`)
    .eq('id', id)
    .eq('company_id', profile!.company_id)
    .single()

  if (!w) notFound()
  const { data: existingTicket } = await admin.from('service_tickets').select('id, ticket_number, status').eq('work_order_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()

  // Construction users can spin this dispatched WO up as a construction job (site + address auto-filled).
  const canConstruction = canWriteConstruction({ id: user?.id, role: (profile as { role?: string } | null)?.role })
  // The construction job carrying this call's WO# (if it was handed off), else probable jobs at the same site.
  const links = await loadConstructionLinks(admin, profile!.company_id)
  const link = (w as any).portal_wo_number ? links.get((w as any).portal_wo_number) : undefined
  const siteDigits = String((w as any).site_number ?? '').replace(/\D/g, '')
  const { data: siteJobs } = !link && canConstruction && siteDigits.length >= 4
    ? await admin.from('con_jobs').select('id, job_number, site_number, stage, status_detail, work_order_number, updated_at').eq('company_id', profile!.company_id).ilike('site_number', `%${siteDigits}%`).order('updated_at', { ascending: false }).limit(12)
    : { data: [] as any[] }
  const probableJobs = (siteJobs ?? [])
    .filter((j: any) => String(j.site_number ?? '').replace(/\D/g, '').includes(siteDigits))
    .filter((j: any) => !woTokens(j.work_order_number).length)   // already tied to a different call
    .slice(0, 5)

  const tech = (w as any).svc_technicians as { full_name: string; personal_email: string | null } | null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/service" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Service Dispatch
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="rp-title font-mono">{w.portal_wo_number}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {clientLabel(w.source_portal, w.client_name)}
            {w.incident_number && <> · Incident {w.incident_number}</>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <WorkOrderStatusBadge status={w.status} />
          <PriorityBadge priorityRaw={w.priority_raw} priorityRank={w.priority_rank} />
        </div>
      </div>

      {(() => { const existing = (existingTicket as { id: string; ticket_number: string; status: string } | null); return existing ? (
        <Link href={`/service/tickets/${existing.id}`} className="block bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-900">Field ticket <b className="font-mono">{existing.ticket_number}</b> · {existing.status} →</Link>
      ) : (
        <form action={createServiceTicket} className="mb-5"><input type="hidden" name="work_order_id" value={w.id} /><button type="submit" className="rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90">Start field ticket</button></form>
      ) })()}

      {link ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-amber-900">
            🏗 Handed to construction —{' '}
            <Link href={`/construction/jobs/${link.jobId}`} className="underline">job <span className="font-mono">{link.jobNumber ?? link.siteNumber ?? ''}</span></Link>
            {' '}· {CON_STAGE_LABEL[link.stage] ?? link.stage}
          </p>
          {link.statusDetail && <p className="text-sm text-amber-800 mt-1">{link.statusDetail}</p>}
          <p className="text-xs text-amber-700 mt-1.5">
            {(CON_DONE_STAGES as readonly string[]).includes(link.stage)
              ? 'The work is finished in construction, so this call is marked completed.'
              : 'This call completes automatically when the job reaches close-out, invoicing or complete.'}
          </p>
        </div>
      ) : canConstruction && (
        <div className="mb-5 space-y-3">
          <form action={createJobFromWorkOrder.bind(null, w.id)}><button type="submit" className="rounded-lg border border-gray-300 bg-card text-gray-800 text-sm font-medium px-4 py-2 hover:bg-gray-50">Create construction job →</button></form>
          {probableJobs.length > 0 && (
            <div className="rp-card p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Already a construction job at this site?</p>
              <ul className="space-y-2">
                {probableJobs.map((j: any) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <Link href={`/construction/jobs/${j.id}`} className="font-mono text-blue-700 hover:underline">{j.job_number ?? j.site_number}</Link>
                      <span className="text-gray-500"> · {CON_STAGE_LABEL[j.stage] ?? j.stage}</span>
                      {j.status_detail && <span className="block text-xs text-gray-400 truncate">{j.status_detail}</span>}
                    </span>
                    <form action={linkConstructionJob.bind(null, w.id, j.id)}><button type="submit" className="shrink-0 rounded-lg bg-amber-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-amber-600/90">This is the one</button></form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {w.return_trip_needed && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-red-800">⟲ Return Trip Needed</p>
          {w.return_trip_reason && <p className="text-sm text-red-700 mt-1">{w.return_trip_reason}</p>}
        </div>
      )}

      {w.invoice_rejected && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <p className="text-sm font-semibold text-amber-800">Invoice Rejected</p>
          {w.invoice_rejection_reason && <p className="text-sm text-amber-700 mt-1">{w.invoice_rejection_reason}</p>}
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <div className="rp-card p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Site</h2>
          <dl className="space-y-1.5 text-sm">
            <div><dt className="inline text-gray-400">Number:</dt> <dd className="inline text-gray-900">{w.site_number ?? '—'}</dd></div>
            <div><dt className="inline text-gray-400">Name:</dt> <dd className="inline text-gray-900">{w.site_name ?? '—'}</dd></div>
            <div><dt className="inline text-gray-400">Address:</dt> <dd className="inline text-gray-900">{w.site_address ?? '—'}</dd></div>
            <div><dt className="inline text-gray-400">City/State:</dt> <dd className="inline text-gray-900">{[w.site_city, w.site_state].filter(Boolean).join(', ') || '—'}</dd></div>
          </dl>
        </div>

        <div className="rp-card p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Timeline</h2>
          <dl className="space-y-1.5 text-sm">
            <div><dt className="inline text-gray-400">Dispatched:</dt> <dd className="inline text-gray-900">{fmt(w.dispatched_at)}</dd></div>
            <div><dt className="inline text-gray-400">Last Update:</dt> <dd className="inline text-gray-900">{fmt(w.last_update_at)}</dd></div>
            {w.sla_due_at && <div><dt className="inline text-gray-400">SLA Due:</dt> <dd className="inline text-gray-900">{fmt(w.sla_due_at)}</dd></div>}
            {w.completed_at && <div><dt className="inline text-gray-400">Completed:</dt> <dd className="inline text-gray-900">{fmt(w.completed_at)}</dd></div>}
          </dl>
        </div>
      </div>

      <div className="rp-card p-5 mb-5">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Assigned Technician</h2>
        {tech ? (
          <p className="text-sm text-gray-900">{tech.full_name} {tech.personal_email && <span className="text-gray-400">· {tech.personal_email}</span>}</p>
        ) : (
          <p className="text-sm text-gray-400">No technician matched yet — the confirmation email's sender didn't match anyone in the roster.</p>
        )}
      </div>

      {w.completion_note_raw && (
        <div className="rp-card p-5 mb-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Tech's Completion Note</h2>
          <p className="text-sm text-gray-900 whitespace-pre-wrap">{w.completion_note_raw}</p>
        </div>
      )}

      {w.subject_raw && (
        <div className="rp-card p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Original Dispatch Subject</h2>
          <p className="text-sm text-gray-600">{w.subject_raw}</p>
        </div>
      )}
    </div>
  )
}
