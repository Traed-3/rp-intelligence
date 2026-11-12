import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { SubcontractorForm, type SubcontractorRecord } from '@/components/construction/subcontractor-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveSubcontractor, deleteSubcontractor } from '../../actions'

export default async function SubcontractorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: sub } = await admin.from('con_subcontractors').select('*')
    .eq('id', id).eq('company_id', company_id).single()
  if (!sub) notFound()

  const { data: assignments } = await admin.from('con_job_subcontractors')
    .select('id, role, con_jobs(id, site_number, stage)')
    .eq('subcontractor_id', id).eq('company_id', company_id)

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-5">
        <Link href="/construction/subcontractors" className="text-sm text-gray-500 hover:text-gray-700">← Subcontractors</Link>
        <h1 className="rp-title mt-2">{sub.name}</h1>
      </div>

      <div className="rp-card p-5 mb-5">
        <SubcontractorForm action={saveSubcontractor.bind(null, id)} sub={sub as SubcontractorRecord} />
      </div>

      <div className="rp-card overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">Assigned Projects ({assignments?.length ?? 0})</h2></div>
        {!assignments?.length ? (
          <p className="px-4 py-6 text-sm text-gray-400">Not assigned to any projects yet. Assign from a job's Subcontractors tab.</p>
        ) : (
          <ul className="divide-y divide-gray-50">
            {assignments.map(a => {
              const j = (a as any).con_jobs
              if (!j) return null
              return (
                <li key={a.id}>
                  <Link href={`/construction/jobs/${j.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                    <span className="font-medium text-gray-900">{j.site_number ?? '—'}</span>
                    <span className="text-xs text-gray-400">{a.role ?? j.stage}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {canWrite && (
        <DeleteButton action={deleteSubcontractor.bind(null, id)} confirm={`Delete ${sub.name}? This removes them from all projects.`} label="Delete subcontractor" />
      )}
    </div>
  )
}
