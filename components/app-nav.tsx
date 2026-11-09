'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import {
  LayoutDashboard,
  Truck,
  Wrench,
  ClipboardList,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Receipt,
  FileText,
  Home,
  HardHat,
  CalendarDays,
  Fuel,
  Package,
  type LucideIcon, ListChecks, ClipboardCheck, ShieldCheck, Menu, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { canReadConstruction } from '@/lib/construction'
import { canUseFieldSurveys, isSurveyOnly } from '@/lib/field-surveys'
import { BILLING_READ_ROLES } from '@/lib/billing'
import { canReadCompliance } from '@/lib/compliance'

type NavItem = { href: string; label: string; icon: LucideIcon; match?: string[]; construction?: boolean; billing?: boolean; compliance?: boolean; module?: string }

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/my', label: 'My Plate', icon: ListChecks, construction: true },
  // Maintenance is now a module hub: Assets, Tickets and Shop live inside it
  // (they keep their own URLs, so the module stays highlighted while you're in any of them).
  // No `module` here on purpose — Shop/Tickets can be blocked separately from
  // Maintenance itself (see lib/modules.ts), so this hub link only disappears
  // if the Maintenance & Assets module specifically is blocked, checked below.
  { href: '/maintenance', label: 'Maintenance', icon: Wrench, match: ['/maintenance', '/assets', '/tickets', '/shop'], module: 'maintenance' },
  // `construction: true` marks this link as gated to the Construction
  // allowlist (see CON_ALLOWED_USER_IDS) while the module is being refined.
  { href: '/construction', label: 'Construction', icon: HardHat, construction: true, module: 'construction' },
  // 7-Eleven / Wawa / Sunoco service calls, synced from rpdispatcher + rpinvoicing.
  { href: '/service', label: 'Service Dispatch', icon: Fuel, module: 'service_dispatch' },
  { href: '/billing', label: 'Quotes & Invoices', icon: FileText, billing: true, module: 'billing' },
  { href: '/inventory', label: 'Inventory', icon: Package, module: 'inventory' },
  { href: '/compliance', label: 'DQF & Certs', icon: ShieldCheck, compliance: true, module: 'compliance' },
  // Company-wide calendar that overlays Maintenance and Construction items.
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/reports', label: 'Reports', icon: BarChart3, module: 'reports_payroll' },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export default function AppNav({ email, role, userId, blockedModules, complianceGranted }: { email: string; role?: string; userId?: string; blockedModules?: string[]; complianceGranted?: boolean }) {
  const pathname = usePathname()
  const router = useRouter()
  const isAdmin = ['owner', 'manager'].includes(role ?? '')
  const canSeeConstruction = canReadConstruction({ id: userId, role })
  const blocked = new Set(blockedModules ?? [])
  const surveyOnly = isSurveyOnly(role)
  // Crew who can run surveys but do not have the Construction module (construction techs) get a Field Surveys link of their own.
  const surveysLink: NavItem = { href: '/construction/surveys', label: 'Field Surveys', icon: ClipboardCheck }
  const needsSurveysLink = canUseFieldSurveys({ id: userId, role }) && !canSeeConstruction

  // Construction and My Plate show for the construction roles (Settings → role); billing for its own roles too.
  const canSeeBilling = canSeeConstruction || (BILLING_READ_ROLES as readonly string[]).includes(role ?? '')
  const visibleNavItems = surveyOnly ? [surveysLink] : [
    ...(needsSurveysLink ? [navItems[0], surveysLink, ...navItems.slice(1)] : navItems),
  ].filter(i =>
    (canSeeConstruction || !('construction' in i)) &&
    (canSeeBilling || !('billing' in i)) &&
    (canReadCompliance({ id: userId, role }, !!complianceGranted) || !('compliance' in i)) &&
    !(i.module && blocked.has(i.module))
  )

  // Mobile bottom-bar items — owners/managers get Settings so they can reach
  // user management, company info, alerts, etc. from a phone or the iPad app.
  const mobileItems = surveyOnly ? [{ href: '/construction/surveys', label: 'Surveys', icon: ClipboardCheck }] : [
    { href: '/mobile',    label: 'Home',      icon: Home },
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ...(canSeeConstruction ? [{ href: '/my', label: 'Plate', icon: ListChecks }] : []),
    { href: '/assets',    label: 'Assets',    icon: Truck },
    { href: '/tickets',   label: 'Tickets',   icon: ClipboardList },
    { href: '/shop',      label: 'Shop',      icon: Users },
    ...(canSeeConstruction ? [{ href: '/construction', label: 'Build', icon: HardHat }] : []),
    ...(needsSurveysLink ? [{ href: '/construction/surveys', label: 'Surveys', icon: ClipboardCheck }] : []),
  ]
  // Everything else the sidebar shows (DQF & Certs, Quotes & Invoices, Inventory, Expenses…)
  // lives behind a "More" tab so the phone bar stays readable.
  const moreItems = surveyOnly ? [] : visibleNavItems.filter(i => !mobileItems.some(m => m.href === i.href))
    .filter(i => i.href !== '/settings' || isAdmin)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = moreItems.some(i => (i.match ?? [i.href]).some(m => pathname === m || pathname.startsWith(m + '/')))

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex print:hidden w-60 flex-col bg-white border-r border-gray-200 min-h-screen">
        {/* Brand */}
        <div className="px-4 py-4 border-b border-gray-200">
          <Image
            src="/logo-full-v4.png"
            alt="RP Intelligence"
            width={220}
            height={100}
            priority
            className="h-20 w-auto"
          />
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {visibleNavItems.map((item) => {
            const matches = item.match ?? [item.href]
            const isActive = matches.some(m => pathname === m || pathname.startsWith(m + '/'))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                  isActive
                    ? 'bg-gradient-to-r from-[#16243d] to-[#2d4e7a] text-white shadow-md shadow-blue-900/20'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User / sign out */}
        <div className="px-3 py-4 border-t border-gray-200">
          <p className="px-3 text-xs text-gray-400 truncate mb-1">{email}</p>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden print:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-50">
        {mobileItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/mobile' && pathname.startsWith(item.href + '/'))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors',
                isActive ? 'text-blue-600' : 'text-gray-500'
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          )
        })}
        {moreItems.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(o => !o)}
            className={cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors', moreOpen || moreActive ? 'text-blue-600' : 'text-gray-500')}
            aria-expanded={moreOpen}
          >
            {moreOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            More
          </button>
        )}
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="md:hidden print:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute bottom-14 left-0 right-0 bg-white rounded-t-2xl shadow-xl p-3 pb-4 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="grid grid-cols-3 gap-2">
              {moreItems.map(item => (
                <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 px-2 py-3 text-xs font-medium text-gray-700 active:bg-gray-100 text-center">
                  <item.icon className="w-5 h-5 text-[#2d4e7a]" />
                  {item.label}
                </Link>
              ))}
            </div>
            <button onClick={handleSignOut} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600">
              <LogOut className="w-4 h-4" />Sign out
            </button>
          </div>
        </div>
      )}
    </>
  )
}
