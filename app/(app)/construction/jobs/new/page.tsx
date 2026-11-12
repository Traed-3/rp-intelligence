import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { JobForm } from '@/components/construction/job-form'
import { saveJob } from '../../actions'

export default async function NewJobPage() {
  const { company_id, canWrite } = await requireConstruction()
  if (!canWrite) redirect('/construction/jobs')
  const admin = createAdminClient()

  const [{ data: customers }, { data: sites }, { data: managers }] = await Promise.all([
    admin.from('con_customers').select('id, name, brand').eq('company_id', company_id).order('name'),
    admin.from('con_sites').select('id, site_number, store_brand, customer_id').eq('company_id', company_id).order('site_number'),
    admin.from('profiles').select('id, full_name').eq('company_id', company_id).in('role', ['owner', 'manager', 'construction_manager', 'estimator']).eq('is_active', true).order('full_name'),
  ])

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <Link href="/construction/jobs" className="text-sm text-gray-500 hover:text-gray-700">← Back to Jobs</Link>
        <h1 className="rp-title mt-2">New Job</h1>
      </div>
      <div className="rp-card p-6">
        <JobForm action={saveJob.bind(null, null)} customers={customers ?? []} sites={sites ?? []} managers={managers ?? []} />
      </div>
    </div>
  )
}
