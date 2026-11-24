import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { money, fmtDate, projectNotificationStatus, CON_DOC_CATEGORIES, docTypeLabel, stageMeta } from '@/lib/construction'
import { permitStatusMeta } from '@/lib/permits'
import { NotificationCard } from '@/components/construction/notification-card'
import { ConPriorityBadge, QuoteStatusBadge, InvoiceStatusBadge, MaterialStatusBadge } from '@/components/construction/badges'
import { StageSelect } from '@/components/construction/stage-select'
import { MaterialForm } from '@/components/construction/material-form'
import { MaterialStatusSelect } from '@/components/construction/material-status-select'
import { ScheduleEntryForm } from '@/components/construction/schedule-entry-form'
import { CloseoutChecklist } from '@/components/construction/closeout-checklist'
import { JobLaborForm } from '@/components/construction/job-labor-form'
import { DailyUpdateForm } from '@/components/construction/daily-update-form'
import { DisposablesForm } from '@/components/construction/disposables-form'
import { DocumentUpload } from '@/components/construction/document-upload'
import { DeleteButton } from '@/components/construction/delete-button'
import { ConfirmButton } from '@/components/construction/confirm-button'
import { AssignSubcontractor } from '@/components/construction/assign-subcontractor'
import { Button } from '@/components/ui/button'
import { TicketDocsCard, TICKET_DOC_COLUMNS, type TicketDocRow } from '@/components/svc/ticket-docs-card'
import { Pencil, Plus, FileText, Image as ImageIcon } from 'lucide-react'
import {
  changeJobStage, saveMaterial, setMaterialStatus, deleteMaterial,
  saveScheduleEntry, deleteScheduleEntry,
  toggleCloseoutTask, deleteCloseoutTask, addCloseoutTask, seedCloseoutTasks,
  addJobLabor, deleteJobLabor, deleteDocument,
  addDailyUpdate, deleteDailyUpdate, confirmFieldTicketDraft, addDisposablesForm, deleteDisposablesForm,
  assignSubcontractor, unassignSubcontractor,
} from '../../actions'

const TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'quote',     label: 'Quotes' },
  { key: 'invoice',   label: 'Invoices' },
  { key: 'permits',   label: 'Permits' },
  { key: 'materials', label: 'Materials' },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'daily',     label: 'Daily Updates' },
  { key: 'subs',      label: 'Subcontractors' },
  { key: 'closeout',  label: 'Close-Out' },
  { key: 'documents', label: 'Documents' },
  { key: 'cost',      label: 'Cost Summary' },
]

export default async function JobDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab = 'overview' } = await searchParams
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: job } = await admin
    .from('con_jobs')
    .select('*, con_customers(id, name), profiles!con_jobs_assigned_manager_id_fkey(full_name)')
    .eq('id', id).eq('company_id', company_id).single()
  if (!job) notFound()

  // Per-tab data (and always what the Cost Summary needs)
  const [
    { data: quotes }, { data: invoices }, { data: materials },
    { data: schedule }, { data: closeout }, { data: labor }, { data: documents },
    { data: dailyUpdates }, { data: disposables },
    { data: assignedSubs }, { data: allSubs }, { data: vendorRows },
    { data: permitProjects }, { data: stageHistory },
  ] = await Promise.all([
    admin.from('con_quotes').select('id, quote_number, proposal_date, status, final_total, kind, parent_quote_id').eq('job_id', id).order('created_at', { ascending: false }),
    admin.from('con_invoices').select('id, invoice_number, invoice_date, status, invoice_grand_total, due_date').eq('job_id', id).order('created_at', { ascending: false }),
    admin.from('con_job_materials').select('*').eq('job_id', id).order('created_at'),
    admin.from('con_schedule_entries').select('*').eq('job_id', id).order('schedule_date', { ascending: false }),
    admin.from('con_closeout_tasks').select('*').eq('job_id', id).order('created_at'),
    admin.from('con_job_labor').select('*').eq('job_id', id).order('work_date', { ascending: false }),
    admin.from('con_documents').select('*').eq('job_id', id).order('created_at', { ascending: false }),
    admin.from('con_daily_updates').select('*, con_daily_update_techs(*), con_documents!con_documents_daily_update_id_fkey(id, file_name, doc_type)').eq('job_id', id).order('work_date', { ascending: false }),
    admin.from('con_disposables_forms').select('*').eq('job_id', id).order('form_date', { ascending: false }),
    admin.from('con_job_subcontractors').select('id, role, con_subcontractors(id, name, trade, phone)').eq('job_id', id),
    admin.from('con_subcontractors').select('id, name, trade').eq('company_id', company_id).eq('is_active', true).order('name'),
    admin.from('con_vendors').select('name').eq('company_id', company_id).eq('is_active', true).order('name'),
    admin.from('con_permit_projects').select('id, project_type, scheduled_work_date, ready_to_work, site_id, con_permit_sites(id, site_number, name)').eq('job_id', id),
    admin.from('con_job_stage_history').select('*').eq('job_id', id).order('changed_at', { ascending: false }).limit(20),
  ])

  // Field tickets the crew emailed in for this job (forwarded copies left out) — shown on the Daily Updates tab.
  const { data: ticketDocs } = await admin.from('svc_work_order_documents').select(TICKET_DOC_COLUMNS)
    .eq('company_id', company_id).eq('con_job_id', id).is('duplicate_of', null).order('received_at', { ascending: false })

  const permitProjectIds = (permitProjects ?? []).map((p) => p.id)
  const { data: jobPermits } = permitProjectIds.length
    ? await admin.from('con_permits').select('id, project_id, permit_key, permit_type, status, requirement_status').in('project_id', permitProjectIds)
    : { data: [] as { id: string; project_id: string; permit_key: string | null; permit_type: string; status: string; requirement_status: string }[] }

  // Documents filed against the site's OTHER projects. A site often runs
  // several jobs, and the importer could only tell which site a file came
  // from, not which of that site's projects — so surface them here rather
  // than let paperwork look missing.
  const siteJobIds = job.site_number
    ? ((await admin.from('con_jobs').select('id')
        .eq('company_id', company_id).eq('site_number', job.site_number)).data ?? [])
        .map((j) => j.id).filter((jid) => jid !== id)
    : []
  const { data: siteDocuments } = siteJobIds.length
    ? await admin.from('con_documents')
        .select('id, job_id, file_name, con_jobs(job_number, site_number)')
        .in('job_id', siteJobIds)
        .order('created_at', { ascending: false })
    : { data: [] as any[] }

  const customerName = (job as any).con_customers?.name
  const managerName = (job as any).profiles?.full_name
  const vendorNames = (vendorRows ?? []).map(v => v.name).filter(Boolean)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-5">
        <Link href="/construction/jobs" className="text-sm text-gray-500 hover:text-gray-700">← Back to Jobs</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="rp-title">{job.job_number ?? job.site_number ?? 'Job'}</h1>
              {job.job_number && job.site_number && (
                <span className="text-sm text-gray-400">Site {job.site_number}</span>
              )}
              <ConPriorityBadge priority={job.priority} />
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {customerName && <span>{customerName}</span>}
              {job.work_order_number && <span className="ml-2 font-mono text-gray-400">{job.work_order_number}</span>}
              {job.gas_brand && <span className="ml-2">· {job.gas_brand}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canWrite ? <StageSelect jobId={job.id} stage={job.stage} action={changeJobStage} /> : null}
            {canWrite && (
              <Link href={`/construction/jobs/${id}/edit`}>
                <Button variant="outline" className="gap-2"><Pencil className="w-3.5 h-3.5" />Edit</Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b border-gray-200 mb-5">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/construction/jobs/${id}?tab=${t.key}`}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── OVERVIEW ───────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="rp-card lg:col-span-2 p-5 space-y-4">
            {job.scope_of_work && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Scope of Work</h3>
                <p className="text-sm text-gray-800 whitespace-pre-line">{job.scope_of_work}</p>
              </div>
            )}
            {job.status_detail && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Current Status</h3>
                <p className="text-sm text-gray-800">{job.status_detail}</p>
              </div>
            )}
            {job.notes && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</h3>
                <p className="text-sm text-gray-800 whitespace-pre-line">{job.notes}</p>
              </div>
            )}
            {!job.scope_of_work && !job.status_detail && !job.notes && (
              <p className="text-sm text-gray-400">No scope or notes recorded yet.</p>
            )}
          </div>
          <div className="space-y-5">
            <NotificationCard jobId={job.id} status={projectNotificationStatus(job)} canWrite={canWrite} />
            <div className="rp-card p-5 space-y-3 text-sm">
              <Detail label="Customer PO #" value={job.po_number} />
              <Detail label="Program" value={job.program} />
              <Detail label="Facility Address" value={job.facility_address} />
              <Detail label="Manager" value={managerName} />
              <Detail label="Response Time" value={job.response_time} />
              <Detail label="Date Received" value={fmtDate(job.date_received)} />
              <Detail label="Project Start" value={fmtDate(job.project_start_date)} />
              {job.master_sync_hold && <p className="text-xs text-amber-700">Master Schedule sync is off for this job.</p>}
            </div>
            <div className="rp-card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Stage History</h2></div>
              {!stageHistory?.length ? (
                <p className="px-4 py-6 text-sm text-gray-400">No history yet.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {stageHistory.map((h) => (
                    <li key={h.id} className="px-4 py-2.5 text-sm">
                      <span className="text-gray-400 text-xs">{new Date(h.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      {' — '}
                      {h.from_stage ? (
                        <span className="text-gray-800">{stageMeta(h.from_stage).label} → {stageMeta(h.to_stage).label}</span>
                      ) : (
                        <span className="text-gray-800">created at {stageMeta(h.to_stage).label}</span>
                      )}
                      {h.changed_by_name && <span className="text-gray-400"> ({h.changed_by_name})</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── QUOTES ─────────────────────────────────────────── */}
      {tab === 'quote' && (
        <DocList
          title="Quotes"
          newHref={`/billing/quotes/new?job=${id}`}
          canWrite={canWrite}
          empty="No quotes for this job yet."
          rows={(quotes ?? []).map(q => ({
            id: q.id, href: `/billing/quotes/${q.id}`,
            left: (q.kind === 'change_order' ? 'CO · ' : '') + (q.quote_number ?? 'Draft'), sub: fmtDate(q.proposal_date),
            badge: <QuoteStatusBadge status={q.status} />, amount: money(q.final_total),
          }))}
        />
      )}

      {/* ── INVOICES ───────────────────────────────────────── */}
      {tab === 'invoice' && (
        <DocList
          title="Invoices"
          newHref={`/billing/invoices/new?job=${id}`}
          canWrite={canWrite}
          empty="No invoices for this job yet."
          rows={(invoices ?? []).map(inv => ({
            id: inv.id, href: `/billing/invoices/${inv.id}`,
            left: inv.invoice_number ?? 'Draft', sub: fmtDate(inv.invoice_date),
            badge: <InvoiceStatusBadge status={inv.status} />, amount: money(inv.invoice_grand_total),
          }))}
        />
      )}

      {/* ── PERMITS ────────────────────────────────────────── */}
      {tab === 'permits' && (
        <div className="rp-card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Permits ({(jobPermits ?? []).length})</h2></div>
          {!(jobPermits ?? []).length ? (
            <p className="px-4 py-6 text-sm text-gray-400">No permits linked to this job.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {(permitProjects ?? []).map((proj) => {
                const site = (proj as any).con_permit_sites
                const permitsForProject = (jobPermits ?? []).filter((p) => p.project_id === proj.id)
                if (!permitsForProject.length) return null
                return (
                  <li key={proj.id} className="px-4 py-3">
                    <Link href={site ? `/construction/permits/sites/${site.id}` : '/construction/permits'} className="text-sm font-medium text-blue-600 hover:underline">
                      {proj.project_type}{site ? ` — ${site.site_number}` : ''}
                    </Link>
                    <ul className="mt-1.5 space-y-1">
                      {permitsForProject.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-gray-700">{p.permit_key ?? p.permit_type}</span>
                          <span className={`px-2 py-0.5 rounded-full border ${permitStatusMeta(p.status).className}`}>{p.status}</span>
                          {p.requirement_status === 'Not Required' && <span className="text-gray-400">(not required)</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── MATERIALS ──────────────────────────────────────── */}
      {tab === 'materials' && (
        <div className="space-y-5">
          <div className="rp-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Materials ({materials?.length ?? 0})</h2></div>
            {!materials?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">No materials listed.</p>
            ) : (
              <table className="rp-table w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {materials.map(m => (
                    <tr key={m.id}>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">{m.description}</span>
                        <div className="text-xs text-gray-400">
                          {[m.part_number && `PN ${m.part_number}`, m.quantity != null && `Qty ${m.quantity}`, m.unit_cost != null && money(m.unit_cost), m.vendor].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {canWrite ? <MaterialStatusSelect id={m.id} status={m.status} action={setMaterialStatus} /> : <MaterialStatusBadge status={m.status} />}
                      </td>
                      {canWrite && <td className="px-4 py-3 text-right"><DeleteButton action={deleteMaterial.bind(null, m.id)} confirm="Remove this material?" iconOnly /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {canWrite && (
            <div className="rp-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Add Material</h3>
              <MaterialForm action={saveMaterial.bind(null, null)} jobId={id} vendors={vendorNames} />
            </div>
          )}
        </div>
      )}

      {/* ── SCHEDULE ───────────────────────────────────────── */}
      {tab === 'schedule' && (
        <div className="space-y-5">
          <div className="rp-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Scheduled Work</h2></div>
            {!schedule?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">Not scheduled yet.</p>
            ) : (
              <table className="rp-table w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {schedule.map(s => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700">{fmtDate(s.schedule_date)}</td>
                      <td className="px-4 py-3">
                        <span className="text-gray-900">{s.task_description ?? '—'}</span>
                        <div className="text-xs text-gray-400">{[s.crew?.join(', '), s.equipment].filter(Boolean).join(' · ')}</div>
                      </td>
                      {canWrite && <td className="px-4 py-3 text-right"><DeleteButton action={deleteScheduleEntry.bind(null, s.id)} confirm="Remove this schedule entry?" iconOnly /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {canWrite && (
            <div className="rp-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Add to Schedule</h3>
              <ScheduleEntryForm action={saveScheduleEntry.bind(null, null)} jobs={[]} fixedJobId={id} />
            </div>
          )}
        </div>
      )}

      {/* ── DAILY UPDATES ──────────────────────────────────── */}
      {tab === 'daily' && (() => {
        const updates = (dailyUpdates ?? []) as any[]
        const hoursOf = (u: any) => (u.con_daily_update_techs ?? []).reduce((s: number, t: any) => s + Number(t.hours ?? 0), 0)
        const totalManHours = updates.reduce((s, u) => s + hoursOf(u), 0)
        return (
          <div className="space-y-5">
            <TicketDocsCard docs={(ticketDocs ?? []) as unknown as TicketDocRow[]} />
            <div className="rp-card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Daily Updates ({updates.length})</h2>
                <span className="text-sm text-gray-500">Total man-hours: <span className="font-semibold text-gray-800">{totalManHours.toFixed(2)}</span></span>
              </div>
              {!updates.length ? (
                <p className="px-4 py-6 text-sm text-gray-400">No daily updates yet.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {updates.map((u) => {
                    const techs = (u.con_daily_update_techs ?? []) as any[]
                    return (
                      <li key={u.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-900">{fmtDate(u.work_date)}</span>
                              {u.update_number && <span className="text-xs text-gray-400">{u.update_number}</span>}
                              <span className="text-xs font-medium text-gray-600">· {hoursOf(u).toFixed(2)} hrs</span>
                              {u.review_status === 'needs_review' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 shrink-0">Needs review</span>}
                            </div>
                            {u.work_description && <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{u.work_description}</p>}
                            {techs.length > 0 && (
                              <div className="text-xs text-gray-500 mt-1">
                                {techs.map((t: any, i: number) => (
                                  <span key={t.id ?? i}>{i > 0 && ', '}{t.tech_name}{t.initials ? ` (${t.initials})` : ''} — {Number(t.hours ?? 0)}h</span>
                                ))}
                              </div>
                            )}
                            {u.notes && <p className="text-xs text-gray-400 mt-1">{u.notes}</p>}
                            {(() => {
                              // Everything filed against this update — the ticket plus any
                              // job photos — so the crew can see it without leaving the tab.
                              const files = ((u.con_documents ?? []) as any[])
                              if (!files.length) return null
                              return (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {files.map((f: any) => (
                                    <a
                                      key={f.id}
                                      href={`/api/construction/documents/${f.id}`}
                                      target="_blank"
                                      rel="noopener"
                                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                                    >
                                      {f.doc_type === 'daily_ticket' ? <FileText size={12} /> : <ImageIcon size={12} />}
                                      <span className="max-w-[10rem] truncate">
                                        {f.doc_type === 'daily_ticket' ? 'Ticket' : f.file_name}
                                      </span>
                                    </a>
                                  ))}
                                </div>
                              )
                            })()}
                          </div>
                          {canWrite && (
                            <div className="flex items-center gap-2 shrink-0">
                              {u.review_status === 'needs_review' && <ConfirmButton action={confirmFieldTicketDraft.bind(null, u.id)} />}
                              <DeleteButton action={deleteDailyUpdate.bind(null, u.id)} confirm="Delete this daily update?" iconOnly />
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {canWrite && (
              <div className="rp-card p-5">
                <h3 className="font-semibold text-gray-900 mb-3">Add Daily Update</h3>
                <DailyUpdateForm action={addDailyUpdate.bind(null, id)} />
              </div>
            )}

            {/* ── Disposables ─────────────────────────────── */}
            <div className="rp-card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Disposables ({disposables?.length ?? 0})</h2>
              </div>
              {!disposables?.length ? (
                <p className="px-4 py-4 text-sm text-gray-400">No disposables recorded.</p>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {disposables.map((f: any) => {
                    const items = (f.items ?? []) as any[]
                    const forms = (f.forms ?? []) as any[]
                    const reorder = items.filter((i) => Number(i.ordered) > 0)
                    return (
                      <li key={f.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-gray-900">{fmtDate(f.form_date)}</span>
                              {f.tech_name && <span className="text-xs text-gray-500">· {f.tech_name}</span>}
                              {f.truck && <span className="text-xs text-gray-500">· Truck {f.truck}</span>}
                              <span className="text-xs text-gray-400">· {items.length} items</span>
                            </div>
                            {reorder.length > 0 && (
                              <p className="text-xs text-amber-700 mt-1">
                                To order: {reorder.map((i) => `${i.label} (${i.ordered})`).join(', ')}
                              </p>
                            )}
                            {forms.length > 0 && (
                              <p className="text-xs text-gray-500 mt-1">
                                Forms: {forms.map((x) => `${x.name} ${x.copies}`).join(' · ')}
                              </p>
                            )}
                          </div>
                          {canWrite && <DeleteButton action={deleteDisposablesForm.bind(null, f.id)} confirm="Delete this disposables form?" iconOnly />}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {canWrite && (
                <div className="px-4 py-3 border-t border-gray-100">
                  <DisposablesForm action={addDisposablesForm} jobId={id} />
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── SUBCONTRACTORS ─────────────────────────────────── */}
      {tab === 'subs' && (
        <div className="space-y-5">
          <div className="rp-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Assigned Subcontractors ({assignedSubs?.length ?? 0})</h2></div>
            {!assignedSubs?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">No subcontractors assigned to this project.</p>
            ) : (
              <table className="rp-table w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {assignedSubs.map(a => {
                    const sc = (a as any).con_subcontractors
                    return (
                      <tr key={a.id}>
                        <td className="px-4 py-3">
                          {sc ? (
                            <Link href={`/construction/subcontractors/${sc.id}`} className="font-medium text-blue-600 hover:underline">{sc.name}</Link>
                          ) : <span className="text-gray-400">—</span>}
                          <div className="text-xs text-gray-400">{[sc?.trade, a.role, sc?.phone].filter(Boolean).join(' · ')}</div>
                        </td>
                        {canWrite && <td className="px-4 py-3 text-right"><DeleteButton action={unassignSubcontractor.bind(null, a.id)} confirm="Remove this subcontractor from the project?" iconOnly /></td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          {canWrite && (
            <div className="rp-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Assign a Subcontractor</h3>
              {allSubs?.length ? (
                <AssignSubcontractor action={assignSubcontractor.bind(null, id)} subs={allSubs} />
              ) : (
                <p className="text-sm text-gray-400">No subcontractors yet. <Link href="/construction/subcontractors" className="text-blue-600 hover:underline">Add one first.</Link></p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── CLOSE-OUT ──────────────────────────────────────── */}
      {tab === 'closeout' && (() => {
        // Everything already filed under Closeout for this job. The checklist
        // says what the package needs; this says what has actually been
        // collected, so nobody has to dig through Documents to find out.
        const closeoutDocs = (documents ?? []).filter((d: any) => d.category === 'closeout')
        const byType = new Map<string, any[]>()
        for (const d of closeoutDocs) {
          const k = d.doc_type || 'other'
          byType.set(k, [...(byType.get(k) ?? []), d])
        }
        const groups = [...byType.entries()]
          .map(([type, docs]) => ({ type, label: docTypeLabel(type) ?? 'Other closeout', docs }))
          .sort((a, b) => a.label.localeCompare(b.label))

        return (
          <div className="space-y-5">
            <CloseoutChecklist
              tasks={closeout ?? []}
              canWrite={canWrite}
              onToggle={toggleCloseoutTask}
              onDelete={deleteCloseoutTask}
              onAdd={addCloseoutTask.bind(null, id)}
              onSeed={seedCloseoutTasks.bind(null, id)}
            />

            <div className="rp-card overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">Closeout Documents ({closeoutDocs.length})</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Everything filed under Closeout for this job, grouped by what it is.
                </p>
              </div>
              {closeoutDocs.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400">
                  Nothing filed under Closeout yet for this job.
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {groups.map(g => (
                    <div key={g.type} className="px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                        {g.label} ({g.docs.length})
                      </p>
                      <ul className="space-y-1">
                        {g.docs.map((d: any) => (
                          <li key={d.id} className="flex items-center gap-3 py-1">
                            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                            <a
                              href={`/api/construction/documents/${d.id}`}
                              target="_blank"
                              rel="noopener"
                              className="flex-1 text-sm font-medium text-blue-600 hover:text-blue-800 truncate"
                            >
                              {d.file_name}
                            </a>
                            {canWrite && (
                              <DeleteButton action={deleteDocument.bind(null, d.id)} confirm="Delete this document?" iconOnly />
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── DOCUMENTS ──────────────────────────────────────── */}
      {tab === 'documents' && (
        <div className="space-y-5">
          {canWrite && (
            <div className="rp-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Upload Document</h3>
              <DocumentUpload jobId={id} />
            </div>
          )}
          <div className="rp-card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Documents ({documents?.length ?? 0})</h2>
            </div>
            {!documents?.length ? (
              <p className="px-4 py-6 text-sm text-gray-400">No documents uploaded.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {CON_DOC_CATEGORIES.map(cat => {
                  const inCat = documents.filter(d => (d.category ?? 'other') === cat.value)
                  if (!inCat.length) return null
                  return (
                    <div key={cat.value} className="px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{cat.label} ({inCat.length})</p>
                      <ul className="space-y-1">
                        {inCat.map(d => (
                          <li key={d.id} className="flex items-center gap-3 py-1.5">
                            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                            <a href={`/api/construction/documents/${d.id}`} target="_blank" rel="noopener" className="flex-1 text-sm font-medium text-blue-600 hover:text-blue-800 truncate">{d.file_name}</a>
                            {d.review_status === 'needs_review' && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 shrink-0">Needs review</span>}
                            {docTypeLabel(d.doc_type) && <span className="text-xs text-gray-400 shrink-0">{docTypeLabel(d.doc_type)}</span>}
                            {canWrite && <DeleteButton action={deleteDocument.bind(null, d.id)} confirm="Delete this document?" iconOnly />}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {siteDocuments && siteDocuments.length > 0 && (() => {
            // Documents now sit on the project they belong to, so listing every
            // sibling file here would just bury this job's own paperwork. Show
            // one line per sibling project instead.
            const bySibling = new Map<string, { jobId: string; label: string; count: number }>()
            for (const d of siteDocuments as any[]) {
              const label = d.con_jobs?.job_number ?? 'Unnumbered project'
              const cur = bySibling.get(d.job_id) ?? { jobId: d.job_id, label, count: 0 }
              cur.count++
              bySibling.set(d.job_id, cur)
            }
            const siblings = [...bySibling.values()].sort((a, b) => a.label.localeCompare(b.label))
            return (
              <div className="rp-card overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">
                    Other projects at site {job.site_number}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {siteDocuments.length} more documents across {siblings.length}{' '}
                    {siblings.length === 1 ? 'project' : 'projects'} at this site.
                  </p>
                </div>
                <ul className="divide-y divide-gray-50">
                  {siblings.map((s) => (
                    <li key={s.jobId}>
                      <Link
                        href={`/construction/jobs/${s.jobId}?tab=documents`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50"
                      >
                        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                        <span className="flex-1 text-sm font-medium text-blue-700">{s.label}</span>
                        <span className="text-xs text-gray-500">
                          {s.count} {s.count === 1 ? 'document' : 'documents'} →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── COST SUMMARY ───────────────────────────────────── */}
      {tab === 'cost' && (
        <CostSummary jobId={id} companyId={company_id} canWrite={canWrite} labor={labor ?? []} />
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-800 text-right">{value || '—'}</span>
    </div>
  )
}

type DocRow = { id: string; href: string; left: string; sub: string; badge: React.ReactNode; amount: string }
function DocList({ title, newHref, canWrite, empty, rows }: { title: string; newHref: string; canWrite: boolean; empty: string; rows: DocRow[] }) {
  return (
    <div className="rp-card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {canWrite && <Link href={newHref}><Button size="sm" className="gap-1.5"><Plus className="w-3.5 h-3.5" />New</Button></Link>}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-gray-50">
          {rows.map(r => (
            <li key={r.id}>
              <Link href={r.href} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                <div className="flex-1">
                  <span className="font-medium text-gray-900 font-mono text-sm">{r.left}</span>
                  <div className="text-xs text-gray-400">{r.sub}</div>
                </div>
                {r.badge}
                <span className="font-semibold text-gray-900 w-28 text-right">{r.amount}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

async function CostSummary({ jobId, companyId, canWrite, labor }: { jobId: string; companyId: string; canWrite: boolean; labor: any[] }) {
  const admin = createAdminClient()
  const [{ data: quotes }, { data: invoices }, { data: materials }] = await Promise.all([
    admin.from('con_quotes').select('final_total, status').eq('job_id', jobId).eq('company_id', companyId),
    admin.from('con_invoices').select('id, invoice_grand_total').eq('job_id', jobId).eq('company_id', companyId),
    admin.from('con_job_materials').select('quantity, unit_cost, status').eq('job_id', jobId).eq('company_id', companyId),
  ])

  const invoiceIds = (invoices ?? []).map(i => i.id)
  let invoiceLaborCost = 0
  if (invoiceIds.length) {
    const { data: liLabor } = await admin.from('con_invoice_line_items').select('total_labor').in('invoice_id', invoiceIds)
    invoiceLaborCost = (liLabor ?? []).reduce((a, l) => a + (Number(l.total_labor) || 0), 0)
  }

  const quotedTotal = (quotes ?? []).reduce((a, q) => a + (Number(q.final_total) || 0), 0)
  const invoicedTotal = (invoices ?? []).reduce((a, i) => a + (Number(i.invoice_grand_total) || 0), 0)
  const materialCost = (materials ?? [])
    .filter(m => ['ordered', 'received', 'in_stock'].includes(m.status))
    .reduce((a, m) => a + (Number(m.quantity) || 0) * (Number(m.unit_cost) || 0), 0)
  const manualLaborCost = (labor ?? []).reduce((a, l) => a + (Number(l.hours) || 0) * (Number(l.labor_rate) || 0), 0)
  const laborCost = invoiceLaborCost + manualLaborCost
  const margin = invoicedTotal - (materialCost + laborCost)
  const marginPct = invoicedTotal > 0 ? (margin / invoicedTotal) * 100 : null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat label="Quoted" value={money(quotedTotal)} />
        <Stat label="Invoiced" value={money(invoicedTotal)} />
        <Stat label="Material Cost" value={money(materialCost)} />
        <Stat label="Labor Cost" value={money(laborCost)} />
        <Stat label="Margin" value={money(margin)} accent={margin >= 0 ? 'text-green-700' : 'text-red-700'} sub={marginPct != null ? `${marginPct.toFixed(1)}%` : undefined} />
      </div>

      <div className="rp-card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Manual Labor Log</h2></div>
        {!labor?.length ? (
          <p className="px-4 py-6 text-sm text-gray-400">No manual labor logged. (Invoice labor is included in the totals above.)</p>
        ) : (
          <table className="rp-table w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {labor.map(l => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{fmtDate(l.work_date)}</td>
                  <td className="px-4 py-2.5 text-gray-900">{l.crew_member ?? '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{l.hours} hr{l.labor_rate ? ` @ ${money(l.labor_rate)}` : ''}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{l.task_note ?? ''}</td>
                  {canWrite && <td className="px-4 py-2.5 text-right"><DeleteButton action={deleteJobLabor.bind(null, l.id)} confirm="Remove this labor entry?" iconOnly /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canWrite && (
          <div className="px-4 py-4 border-t border-gray-100 bg-gray-50">
            <JobLaborForm action={addJobLabor.bind(null, jobId)} />
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rp-card p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
