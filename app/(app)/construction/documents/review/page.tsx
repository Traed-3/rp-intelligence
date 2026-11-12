import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { ReviewRow } from '@/components/construction/review-row'
import { Inbox, ArrowLeft } from 'lucide-react'

// Company-wide triage queue for documents the importer (or an upload) couldn't
// confidently file. Pick a category and File to clear each one.
export default async function DocReviewPage() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  const [{ data: docs }, { data: drafts }] = await Promise.all([
    admin
      .from('con_documents')
      .select('id, file_name, category, doc_type, source_path, job_id, con_jobs(site_number, con_customers(name))')
      .eq('company_id', company_id)
      .eq('review_status', 'needs_review')
      .order('created_at', { ascending: false }),
    admin
      .from('con_daily_updates')
      .select('id, job_id, work_date, work_description, source, con_jobs(site_number, work_order_number, con_customers(name))')
      .eq('company_id', company_id)
      .eq('review_status', 'needs_review')
      .order('work_date', { ascending: false }),
  ])

  const rows = (docs ?? []).map(d => {
    const job = (d as any).con_jobs
    const jobLabel = job?.site_number
      ? `${job.site_number}${job?.con_customers?.name ? ' · ' + job.con_customers.name : ''}`
      : null
    return {
      id: d.id as string,
      file_name: d.file_name as string | null,
      category: d.category as string | null,
      doc_type: d.doc_type as string | null,
      source_path: d.source_path as string | null,
      jobLabel,
    }
  })

  const draftRows = (drafts ?? []).map(d => {
    const job = (d as any).con_jobs
    return {
      id: d.id as string,
      jobId: d.job_id as string,
      workDate: d.work_date as string,
      description: d.work_description as string | null,
      jobLabel: job ? `${job.site_number ?? ''}${job.work_order_number ? ` · ${job.work_order_number}` : ''}${job?.con_customers?.name ? ' · ' + job.con_customers.name : ''}` : null,
    }
  })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/construction" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Construction
      </Link>

      <div className="mb-6">
        <h1 className="rp-title">
          Document Review
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Files the importer wasn&apos;t sure about. Pick a category and File each one.</p>
      </div>

      <div className="rp-card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Needs Review ({rows.length})</h2>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <Inbox className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">Nothing to review — everything&apos;s filed. 🎉</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {rows.map(doc => <ReviewRow key={doc.id} doc={doc} />)}
          </ul>
        )}
      </div>

      <div className="rp-card overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Field Ticket Drafts ({draftRows.length})</h2>
          <span className="text-xs text-gray-400">Backfilled from Gmail — confirm on the job&apos;s Daily Updates tab</span>
        </div>
        {draftRows.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400">
            <Inbox className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No backfilled tickets waiting on a review.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {draftRows.map(d => (
              <li key={d.id} className="px-4 py-3">
                <Link href={`/construction/jobs/${d.jobId}?tab=daily`} className="block hover:bg-gray-50 -mx-4 -my-3 px-4 py-3 rounded-lg">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-gray-900">{d.workDate}</span>
                    {d.jobLabel && <span className="text-gray-500">· {d.jobLabel}</span>}
                  </div>
                  {d.description && <p className="text-xs text-gray-500 mt-1 truncate">{d.description}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
