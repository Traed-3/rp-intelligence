import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { fmtDate } from '@/lib/construction'
import { loadPermitGraph } from '@/lib/permits-data'
import { computeReadyToWork, permitStatusMeta, isInHandOrLater } from '@/lib/permits'
import { PermitStatusSelect } from '@/components/construction/permit-status-select'
import { PermitRequirementSelect } from '@/components/construction/permit-requirement-select'
import { ReadyToWorkButton } from '@/components/construction/ready-to-work-button'
import { DeliverableUpload } from '@/components/construction/deliverable-upload'
import { AddPermitForm } from '@/components/construction/add-permit-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { LinkJobSelect } from '@/components/construction/link-job-select'
import {
  updatePermitStatus, setPermitRequirement, markReadyToWork, clearReadyToWork, deleteDeliverable, addPermit,
  linkPermitProjectToJob, createJobForPermitProject,
} from '../../actions'
import { CheckCircle2, AlertTriangle, FileText, Briefcase } from 'lucide-react'

export default async function SiteViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: site } = await admin.from('con_permit_sites').select('*')
    .eq('id', id).eq('company_id', company_id).single()
  if (!site) notFound()

  const graph = await loadPermitGraph(admin, company_id)
  const jurisdiction = site.jurisdiction_id ? graph.jurisdictions.find(j => j.id === site.jurisdiction_id) ?? null : null
  const projects = graph.projects.filter(p => p.site_id === id)
  const projectIds = new Set(projects.map(p => p.id))
  const permits = graph.enriched.filter(p => projectIds.has(p.project_id))
  const requiredPermits = permits.filter(p => p.requirement_status === 'Required')
  // Confirmed permits (Required or resolved Not-Required) sit in the main list;
  // Unknown placeholders wait in a separate "pending confirmation" section.
  const livePermits = permits
    .filter(p => p.requirement_status !== 'Unknown')
    .sort((a, b) => a.permit_type.localeCompare(b.permit_type))
  const unknownPermits = permits
    .filter(p => p.requirement_status === 'Unknown')
    .sort((a, b) => a.permit_type.localeCompare(b.permit_type))

  // Ready-to-work: green only when every Required permit is Permit In-Hand or later.
  const eligible = computeReadyToWork(permits)
  const anyMarkedReady = projects.some(p => p.ready_to_work)

  type EventRow = {
    id: string; permit_id: string; changed_at: string; changed_by_name: string | null
    from_status: string | null; to_status: string | null; note: string | null
  }
  const permitIds = permits.map(p => p.id)
  const [{ data: deliverables }, { data: events }] = await Promise.all([
    admin.from('con_permit_deliverables').select('*').eq('company_id', company_id).eq('site_id', id).order('created_date', { ascending: false }),
    admin.from('con_permit_events').select('*').eq('company_id', company_id).in('permit_id', permitIds.length ? permitIds : ['00000000-0000-0000-0000-000000000000']).order('changed_at', { ascending: false }),
  ])

  // Linked job(s) — "if we have a permit, it's a project." Most sites run one
  // project at a time, so this is usually a single row.
  const linkedJobIds = projects.map(p => (p as { job_id?: string | null }).job_id).filter((jid): jid is string => !!jid)
  const [{ data: linkedJobs }, { data: openSiteJobs }] = await Promise.all([
    linkedJobIds.length
      ? admin.from('con_jobs').select('id, job_number, stage').in('id', linkedJobIds)
      : Promise.resolve({ data: [] as { id: string; job_number: string | null; stage: string }[] }),
    admin.from('con_jobs').select('id, job_number, stage').eq('company_id', company_id).eq('site_number', site.site_number).neq('stage', 'complete'),
  ])
  const jobById = new Map((linkedJobs ?? []).map(j => [j.id, j]))
  const eventsByPermit = new Map<string, EventRow[]>()
  for (const e of (events ?? []) as EventRow[]) {
    const arr = eventsByPermit.get(e.permit_id) ?? []
    arr.push(e); eventsByPermit.set(e.permit_id, arr)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <Link href="/construction/permits/sites" className="text-sm text-gray-500 hover:text-gray-700">← Sites</Link>
        <h1 className="rp-title mt-2">{site.site_number}{site.name ? ` · ${site.name}` : ''}</h1>
        <p className="text-sm text-gray-500">
          {[site.address, site.city, site.state].filter(Boolean).join(', ')}
          {jurisdiction && <> · <Link href={`/construction/permits/jurisdictions/${jurisdiction.id}`} className="text-blue-600 hover:underline">{jurisdiction.name}</Link></>}
        </p>
      </div>

      {/* Ready-to-work indicator */}
      <div className={`rounded-2xl border-2 shadow-sm mb-5 ${eligible ? 'border-green-400 bg-green-50' : 'border-red-300 bg-red-50'}`}>
        <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            {eligible
              ? <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
              : <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />}
            <div>
              <p className={`font-bold ${eligible ? 'text-green-900' : 'text-red-900'}`}>
                {eligible ? 'Ready to work' : 'Not ready to work'}
              </p>
              <p className={`text-xs ${eligible ? 'text-green-800' : 'text-red-800'}`}>
                {eligible
                  ? 'Every required permit is in hand.'
                  : `${requiredPermits.filter(p => !isInHandOrLater(p.status)).length} required permit(s) not yet in hand.`}
              </p>
            </div>
          </div>
          {canWrite && projects[0] && (
            <ReadyToWorkButton projectId={projects[0].id} ready={anyMarkedReady} eligible={eligible} mark={markReadyToWork} clear={clearReadyToWork} />
          )}
        </div>
      </div>

      {/* Linked job(s) — a permit with no job is a data gap, not a valid state */}
      <div className="rp-card overflow-hidden mb-5">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50"><h2 className="font-semibold text-gray-900 text-sm">Linked job</h2></div>
        <ul className="divide-y divide-gray-100">
          {projects.map(p => {
            const jobId = (p as { job_id?: string | null }).job_id
            const job = jobId ? jobById.get(jobId) : null
            return (
              <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-gray-500">{p.project_type}</span>
                {job ? (
                  <Link href={`/construction/jobs/${job.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline">
                    <Briefcase className="w-3.5 h-3.5" />{job.job_number ?? 'Open job'} · {job.stage}
                  </Link>
                ) : canWrite ? (
                  <div className="flex items-center gap-2">
                    {openSiteJobs && openSiteJobs.length > 0 && (
                      <LinkJobSelect projectId={p.id} candidates={openSiteJobs} action={linkPermitProjectToJob} />
                    )}
                    <form action={createJobForPermitProject.bind(null, p.id)}>
                      <button type="submit" className="text-xs font-medium text-blue-600 hover:underline">+ Create new job</button>
                    </form>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Not linked</span>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* Confirmed permits (Required + resolved Not-Required) */}
      <div className="rp-card overflow-hidden mb-5">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50"><h2 className="font-semibold text-gray-900 text-sm">Permits ({livePermits.length})</h2></div>
        <ul className="divide-y divide-gray-100">
          {livePermits.map(p => {
            const evs = eventsByPermit.get(p.id) ?? []
            return (
              <li key={p.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="font-mono text-xs font-semibold text-gray-900">{p.permit_key ?? p.permit_type}</span>
                    <span className="ml-2 text-xs text-gray-500">{p.permit_type} · {p.pulled_by}</span>
                    {p.requirement_status === 'Not Required' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">Not required</span>}
                  </div>
                  <div>
                    {canWrite
                      ? <PermitStatusSelect id={p.id} status={p.status} action={updatePermitStatus} />
                      : <span className={`text-xs px-2 py-0.5 rounded-full border ${permitStatusMeta(p.status).className}`}>{p.status}</span>}
                  </div>
                </div>
                {p.notes && <p className="text-xs text-gray-500 mt-1.5">{p.notes}</p>}
                {evs.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600">History ({evs.length})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {evs.map(e => (
                        <li key={e.id} className="text-[11px] text-gray-500">
                          {fmtDate(e.changed_at)} — {e.changed_by_name ?? 'someone'}: {e.note ? e.note : `${e.from_status ?? '—'} → ${e.to_status ?? '—'}`}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            )
          })}
        </ul>
        {canWrite && projects[0] && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs font-medium text-gray-500 mb-1.5">Add a permit (e.g. Building or Mechanical, if the jurisdiction wants one)</p>
            <AddPermitForm action={addPermit.bind(null, projects[0].id)} />
          </div>
        )}
      </div>

      {/* Pending confirmation — Unknown placeholders awaiting a decision */}
      {unknownPermits.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-300 shadow-sm overflow-hidden mb-5">
          <div className="px-5 py-3 border-b border-amber-200">
            <h2 className="font-semibold text-amber-900 text-sm">Pending confirmation ({unknownPermits.length})</h2>
            <p className="text-xs text-amber-800">Nobody has confirmed whether these are needed. Resolve each once Hash reports back — or they clear automatically when the electrical permit is issued.</p>
          </div>
          <ul className="divide-y divide-amber-100">
            {unknownPermits.map(p => (
              <li key={p.id} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-mono text-xs font-semibold text-gray-900">{p.permit_key ?? p.permit_type}</span>
                  <span className="ml-2 text-xs text-gray-500">{p.permit_type} · {p.pulled_by}</span>
                </div>
                {canWrite
                  ? <PermitRequirementSelect id={p.id} requirement={p.requirement_status} action={setPermitRequirement} />
                  : <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-300">Unknown</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Deliverables */}
      <div className="rp-card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 bg-gray-50"><h2 className="font-semibold text-gray-900 text-sm">Deliverables ({(deliverables ?? []).length})</h2></div>
        <ul className="divide-y divide-gray-100">
          {(deliverables ?? []).length === 0 && <li className="px-5 py-6 text-center text-sm text-gray-400">No deliverables yet.</li>}
          {(deliverables ?? []).map(d => (
            <li key={d.id} className="px-5 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="font-medium text-gray-900 text-sm">{d.type ?? d.filename ?? 'Deliverable'}</span>
                  {d.created_date && <span className="text-[11px] text-gray-400">{fmtDate(d.created_date)}</span>}
                </div>
                {d.filename && <p className="text-xs text-gray-500 ml-6">{d.filename}{d.where_it_lives ? ` · ${d.where_it_lives}` : ''}</p>}
                {d.open_items && <p className="text-xs text-amber-700 ml-6 mt-0.5">Open: {d.open_items}</p>}
              </div>
              {canWrite && <DeleteButton action={deleteDeliverable.bind(null, d.id)} confirm="Delete this deliverable?" label="Delete" />}
            </li>
          ))}
        </ul>
        {canWrite && (
          <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50">
            <DeliverableUpload siteId={id} />
          </div>
        )}
      </div>
    </div>
  )
}
