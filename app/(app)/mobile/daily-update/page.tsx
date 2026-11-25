import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canPostDailyUpdate, DAILY_UPDATE_ACTIVE_STAGES } from '@/lib/construction'
import { DailyUpdateForm, type JobOption } from '@/components/construction/daily-update-form'
import { addDailyUpdateForPickedJob } from '@/app/(app)/construction/actions'
import { CalendarCheck } from 'lucide-react'
import { TitleIcon } from '@/components/ui/title-icon'

export default async function MobileDailyUpdatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, company_id, role').eq('id', user!.id).single()

  if (!profile || !canPostDailyUpdate(profile)) {
    return (
      <div className="min-h-screen p-6">
        <div className="max-w-sm mx-auto">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="rp-title"><TitleIcon icon={CalendarCheck} tone="info" />Daily Update</h1>
            <Link href="/mobile" className="text-sm text-blue-600">← Home</Link>
          </div>
          <p className="rp-card p-5 text-sm text-gray-500">
            Daily updates are for the construction crews. Ask the office to turn it on for you.
          </p>
        </div>
      </div>
    )
  }

  const { data: jobs } = await admin
    .from('con_jobs')
    .select('id, site_number, job_number, scope_of_work, stage')
    .eq('company_id', profile.company_id)
    .in('stage', DAILY_UPDATE_ACTIVE_STAGES as string[])
    .order('site_number')

  const options: JobOption[] = (jobs ?? []).map((j) => ({
    id: j.id,
    label: [j.job_number || j.site_number || 'Job', j.scope_of_work?.slice(0, 40)]
      .filter(Boolean).join(' — '),
  }))

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="rp-title"><TitleIcon icon={CalendarCheck} tone="info" />Daily Update</h1>
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
