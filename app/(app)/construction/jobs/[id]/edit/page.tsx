import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { JobForm } from '@/components/construction/job-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveJob, deleteJob } from '../../../actions'

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  if (!canWrite) redirect(`/construction/jobs/${id}`)
  const admin = createAdminClient()

  const [{ data: job }, { data: customers }, { data: sites }, { data: managers }] = await Promise.all([
    admin.from('con_jobs').select('*').eq('id', id).eq('company_id', company_id).single(),
    admin.from('con_customers').select('id, name, brand').eq('company_id', company_id).order('name'),
    admin.from('con_sites').select('id, site_number, store_brand, customer_id').eq('company_id', company_id).order('site_number'),
    admin.from('profiles').select('id, full_name').eq('company_id', company_id).in('role', ['owner', 'manager', 'construction_manager', 'estimator']).eq('is_active', true).order('full_name'),
  ])
  if (!job) notFound()

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href={`/construction/jobs/${id}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to Job</Link>
        <h1 className="rp-title mt-2">Edit Job</h1>
      </div>
      <div className="rp-card p-6">
        <JobForm action={saveJob.bind(null, id)} job={job} customers={customers ?? []} sites={sites ?? []} managers={managers ?? []} />
      </div>
      <div className="mt-4 flex justify-end">
        <DeleteButton action={deleteJob.bind(null, id)} confirm="Delete this job? Materials, labor and close-out items will be removed; quotes/invoices will be unlinked." label="Delete Job" />
      </div>
    </div>
  )
}
