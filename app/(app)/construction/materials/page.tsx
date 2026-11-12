import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { MATERIAL_STATUSES, money } from '@/lib/construction'
import { MaterialStatusSelect } from '@/components/construction/material-status-select'
import { MaterialForm } from '@/components/construction/material-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { setMaterialStatus, deleteMaterial, saveMaterial } from '../actions'

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job = '' } = await searchParams
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  let mq = admin
    .from('con_job_materials')
    .select('*, con_jobs(id, site_number)')
    .eq('company_id', company_id)
    .order('created_at', { ascending: false })
  if (job) mq = mq.eq('job_id', job)

  const [{ data: materials }, { data: jobs }, { data: vendorRows }] = await Promise.all([
    mq,
    // Material tracking is about open work — also keeps this well under
    // Supabase's default 1000-row cap now that completed jobs have piled up.
    admin.from('con_jobs').select('id, site_number, work_order_number').eq('company_id', company_id).neq('stage', 'complete').order('created_at', { ascending: false }),
    admin.from('con_vendors').select('name').eq('company_id', company_id).eq('is_active', true).order('name'),
  ])
  const vendorNames = (vendorRows ?? []).map(v => v.name).filter(Boolean)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Materials
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{materials?.length ?? 0} item{materials?.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>

      {/* Job filter */}
      <form method="GET" className="flex items-center gap-2 mb-5">
        <select name="job" defaultValue={job} className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-card">
          <option value="">All jobs</option>
          {jobs?.map(j => <option key={j.id} value={j.id}>{j.site_number ?? '—'}{j.work_order_number ? ` (${j.work_order_number})` : ''}</option>)}
        </select>
        <button type="submit" className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg">Filter</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {MATERIAL_STATUSES.map(s => {
          const col = (materials ?? []).filter(m => m.status === s.value)
          return (
            <div key={s.value} className="bg-gray-50 rounded-2xl border border-gray-200 p-3">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${s.className}`}>{s.label}</span>
                <span className="text-xs text-gray-400">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map(m => (
                  <div key={m.id} className="rp-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-gray-900">{m.description}</p>
                      {canWrite && <DeleteButton action={deleteMaterial.bind(null, m.id)} confirm="Remove this material?" iconOnly />}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {[m.part_number && `PN ${m.part_number}`, m.quantity != null && `Qty ${m.quantity}`, m.unit_cost != null && money(m.unit_cost), m.vendor].filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <Link href={`/construction/jobs/${(m as any).con_jobs?.id}`} className="text-xs text-blue-600 hover:text-blue-800">{(m as any).con_jobs?.site_number ?? 'Job'}</Link>
                      {canWrite && <MaterialStatusSelect id={m.id} status={m.status} action={setMaterialStatus} />}
                    </div>
                  </div>
                ))}
                {col.length === 0 && <p className="text-xs text-gray-300 px-1 py-2">—</p>}
              </div>
            </div>
          )
        })}
      </div>

      {canWrite && (
        <div className="rp-card p-5 mt-6 max-w-2xl">
          <h3 className="font-semibold text-gray-900 mb-3">Add Material</h3>
          <MaterialForm action={saveMaterial.bind(null, null)} jobs={jobs ?? []} vendors={vendorNames} />
        </div>
      )}
    </div>
  )
}
