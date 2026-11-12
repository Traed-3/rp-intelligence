import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canWriteConstruction } from '@/lib/construction'
import { DailyUpdateForm, type JobOption } from '@/components/construction/daily-update-form'
import { addDailyUpdateForPickedJob } from '@/app/(app)/construction/actions'

// Stages where a crew is realistically standing on the site today.
const ACTIVE_STAGES = ['scheduled', 'in_progress', 'return_needed', 'on_hold']

export default async function MobileDailyUpdatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, company_id, role').eq('id', user!.id).single()

  if (!profile || !canWriteConstruction(profile as any)) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-sm mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="rp-title">Daily Update</h1>
            <Link href="/mobile" className="text-sm text-blue-600">← Home</Link>
          </div>
          <p className="rp-card p-5 text-sm text-gray-500">
            You don&apos;t have access to construction jobs. Ask the office to turn it on for you.
          </p>
        </div>
      </div>
    )
  }

  const { data: jobs } = await admin
    .from('con_jobs')
    .select('id, site_number, job_number, scope_of_work, stage')
    .eq('company_id', profile.company_id)
    .in('stage', ACTIVE_STAGES)
    .order('site_number')

  const options: JobOption[] = (jobs ?? []).map((j) => ({
    id: j.id,
    label: [j.job_number || j.site_number || 'Job', j.scope_of_work?.slice(0, 40)]
      .filter(Boolean).join(' — '),
  }))

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="rp-title">Daily Update</h1>
          <Link href="/mobile" className="text-sm text-blue-600">← Home</Link>
        </div>

        <div className="rp-card p-5">
          {options.length === 0 ? (
            <p className="text-sm text-gray-500">
              No active jobs right now. A job shows up here once the office moves it to
              Scheduled or In Progress.
            </p>
          ) : (
            <DailyUpdateForm action={addDailyUpdateForPickedJob} jobs={options} />
          )}
        </div>
      </div>
    </div>
  )
}
