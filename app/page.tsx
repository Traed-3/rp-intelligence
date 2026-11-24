import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_LANDING_PAGE, VALID_LANDING_PAGES } from '@/lib/landing-pages'
import { isLockedRole, lockedLanding } from '@/lib/role-access'

// Opening the app while already signed in lands on the same page as signing in: the landing page chosen for the
// person in Settings -> Users, else My Plate (shop employees: the shop dashboard).
export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await createAdminClient()
    .from('profiles')
    .select('default_landing_page, role')
    .eq('id', user.id)
    .maybeSingle()
  const page = profile?.default_landing_page
  if (isLockedRole(profile?.role)) redirect(lockedLanding(profile?.role, page && page !== '/dashboard' ? page : null))
  redirect(page && (VALID_LANDING_PAGES as readonly string[]).includes(page) ? page : DEFAULT_LANDING_PAGE)
}
