import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { ReportIssueForm } from './report-issue-form'
import { createTicket } from '@/app/(app)/tickets/actions'

export default async function ReportIssuePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id').eq('id', user!.id).single()

  const { data: assets } = await admin
    .from('assets')
    .select('id, unit_number, name, make, model, year')
    .eq('company_id', profile!.company_id)
    .in('status', ['active', 'available', 'in_shop'])
    .order('unit_number')

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-sm mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="rp-title">Report an Issue</h1>
          <Link href="/mobile" className="text-sm text-blue-600">← Home</Link>
        </div>

        <div className="rp-card p-5">
          <ReportIssueForm action={createTicket} assets={assets ?? []} />
        </div>
      </div>
    </div>
  )
}
