import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasComplianceGrant } from '@/lib/compliance-guard'
import { isSurveyOnly } from '@/lib/field-surveys'
import { allowedDashboardCards, buildNav } from '@/lib/nav-items'
import { arrange, loadUiPrefs, MAX_TABS } from '@/lib/ui-prefs'
import { PageHeader } from '@/components/ui/page-header'
import { PersonalizeEditor } from './editor'

export const dynamic = 'force-dynamic'

/** Everyone gets this page: it only changes what they see, never what they are allowed to open. */
export default async function PersonalizePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile) redirect('/login?denied=1')
  if (isSurveyOnly(profile.role)) redirect('/construction/surveys')

  const [{ data: blocks }, complianceGranted, prefs] = await Promise.all([
    admin.from('profile_module_blocks').select('module').eq('profile_id', user.id),
    hasComplianceGrant(admin, profile.company_id, user.id),
    loadUiPrefs(admin, user.id),
  ])
  const who = { role: profile.role, userId: user.id, blockedModules: (blocks ?? []).map(b => b.module), complianceGranted }
  const { sidebar, defaultTabs, tabChoices } = buildNav(who)

  const cards = arrange([...allowedDashboardCards(who)], prefs.dashboard).map(c => ({ key: c.key, label: c.label, desc: c.desc, hidden: c.hidden }))
  const menu = arrange(sidebar, prefs.nav, ['/settings']).map(i => ({ key: i.key, label: i.label, hidden: i.hidden, locked: i.key === '/settings' }))
  const choices = tabChoices.map(t => ({ key: t.href, label: t.label }))
  const picked = (prefs.tabs ?? []).filter(k => choices.some(c => c.key === k))
  const standard = defaultTabs.map(t => t.href)

  const isAdmin = ['owner', 'manager'].includes(profile.role)
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Personalize"
        description="Choose what you see and in what order. This only changes your own screen, on every device you sign in on."
        crumbs={isAdmin ? [{ label: 'Settings', href: '/settings' }, { label: 'Personalize' }] : undefined}
      />
      <PersonalizeEditor cards={cards} menu={menu} tabChoices={choices} tabs={picked} standardTabs={standard} maxTabs={MAX_TABS} />
    </div>
  )
}
