import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export default async function CompanySettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  if (!['owner', 'manager'].includes(profile?.role ?? '')) redirect('/settings')

  const { data: company } = await admin
    .from('companies').select('*').eq('id', profile!.company_id).single()

  async function saveCompany(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const admin = createAdminClient()
    const { data: p } = await admin.from('profiles').select('company_id, role').eq('id', user.id).single()
    if (!p || !['owner', 'manager'].includes(p.role)) return

    await admin.from('companies').update({
      name:     (formData.get('name') as string).trim(),
      timezone: (formData.get('timezone') as string).trim(),
    }).eq('id', p.company_id)

    revalidatePath('/settings/company')
  }

  const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="p-6 max-w-xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-700">← Settings</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Company Settings</h1>
      </div>

      <div className="rp-card p-6">
        <form action={saveCompany} className="space-y-5">
          <div>
            <label className={lbl}>Company Name</label>
            <input name="name" className={inp} defaultValue={company?.name ?? ''} required />
          </div>
          <div>
            <label className={lbl}>Timezone</label>
            <select name="timezone" className={inp} defaultValue={company?.timezone ?? 'America/New_York'}>
              <option value="America/New_York">Eastern Time (ET)</option>
              <option value="America/Chicago">Central Time (CT)</option>
              <option value="America/Denver">Mountain Time (MT)</option>
              <option value="America/Los_Angeles">Pacific Time (PT)</option>
            </select>
          </div>
          <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors">
            Save Changes
          </button>
        </form>
      </div>
    </div>
  )
}
