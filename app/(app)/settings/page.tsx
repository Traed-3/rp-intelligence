import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Users, Building2, CreditCard, BookOpen, Bell, Inbox, SlidersHorizontal } from 'lucide-react'
import { GmailSyncPanel } from './gmail-sync-panel'
import { BillingInboxPanel } from './billing-inbox-panel'

const LINKS = [
  { href: '/settings/personalize',     icon: SlidersHorizontal, title: 'Personalize',        desc: 'Your own dashboard cards, side menu and phone buttons. Every user has this page.' },
  { href: '/review',                   icon: Inbox,       title: 'Email Review',           desc: "Resolve emails that didn't match an asset — suggested matches, assign, or create." },
  { href: '/settings/alerts',          icon: Bell,        title: 'Alerts & Notifications', desc: 'Choose which alerts you receive and how — in-app, email, text, or push.' },
  { href: '/settings/users',           icon: Users,       title: 'User Management',        desc: 'Change employee roles, activate or deactivate accounts.' },
  { href: '/settings/company',         icon: Building2,   title: 'Company Settings',       desc: 'Update company name and timezone.' },
  { href: '/settings/payment-methods', icon: CreditCard,  title: 'Payment Methods',        desc: 'Manage expense payment codes (TEC, HDP, CASH, custom).' },
  { href: '/settings/guide',           icon: BookOpen,    title: 'User Guide',             desc: 'Instructions for the owner and shop employees.' },
]

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('role, company_id').eq('id', user!.id).single()

  if (!['owner', 'manager'].includes(profile?.role ?? '')) {
    redirect('/settings/personalize')   // everyone else gets their own layout page
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="rp-title">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your RPS platform.</p>
      </div>

      <GmailSyncPanel />
      <BillingInboxPanel companyId={profile!.company_id} />

      <div className="space-y-3 mt-6">
        {LINKS.map(l => (
          <Link
            key={l.href}
            href={l.href}
            className="rp-card rp-card-link flex items-center gap-4 p-5"
          >
            <div className="p-2.5 rounded-lg bg-gray-100 border border-gray-200">
              <l.icon className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">{l.title}</p>
              <p className="text-sm text-gray-500 mt-0.5">{l.desc}</p>
            </div>
            <span className="ml-auto text-gray-400">&rarr;</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
