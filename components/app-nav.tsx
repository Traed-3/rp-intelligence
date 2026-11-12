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
import { ThemeToggle } from '@/components/ui/theme-toggle'

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

  const tabClass = (on: boolean) => cn(
    'relative flex min-w-0 flex-auto flex-col items-center gap-1 px-1 pt-2 pb-1.5 text-xs font-medium transition-colors active:bg-raised',
    on ? 'text-brand' : 'text-gray-500'
  )
  // The label sits in its own span so it can be a touch smaller than the bold-link rule's size and never collide with its neighbours.
  const tabLabel = 'block max-w-full truncate text-[10.5px] leading-none tracking-tight'
  const tabMark = (on: boolean) => on && <span aria-hidden className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-brand" />

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex print:hidden sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        {/* Brand */}
        <div className="px-4 pt-4 pb-3">
          <Link href="/dashboard" aria-label="RP Intelligence home" className="inline-block rounded-lg bg-white px-1.5 py-1 dark:ring-1 dark:ring-white/10">
            <Image
              src="/logo-full-v4.png"
              alt="RP Intelligence"
              width={220}
              height={100}
              priority
              className="h-14 w-auto"
            />
          </Link>
        </div>

        {/* Nav links */}
        <nav aria-label="Main" className="flex-1 space-y-px overflow-y-auto px-3 py-2">
          {visibleNavItems.map((item) => {
            const matches = item.match ?? [item.href]
            const isActive = matches.some(m => pathname === m || pathname.startsWith(m + '/'))
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-foreground'
                    : 'text-gray-600 hover:bg-sidebar-accent/70 hover:text-foreground active:bg-sidebar-accent'
                )}
              >
                {isActive && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-brand" />}
                <item.icon className={cn('size-[18px] shrink-0 transition-colors', isActive ? 'text-brand' : 'text-gray-400 group-hover:text-gray-600')} strokeWidth={isActive ? 2.2 : 1.9} />
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Appearance, user, sign out */}
        <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
          <ThemeToggle className="w-full" />
          <p className="truncate px-2.5 text-xs text-gray-500" title={email}>{email}</p>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm font-medium text-gray-600 transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <LogOut className="size-[18px] shrink-0 text-gray-400" strokeWidth={1.9} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav aria-label="Main" className="md:hidden print:hidden fixed bottom-0 left-0 right-0 z-50 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        {mobileItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/mobile' && pathname.startsWith(item.href + '/'))
          return (
            <Link key={item.href} href={item.href} aria-current={isActive ? 'page' : undefined} className={tabClass(isActive)}>
              {tabMark(isActive)}
              <item.icon className="size-[22px]" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className={tabLabel}>{item.label}</span>
            </Link>
          )
        })}
        {moreItems.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(o => !o)}
            className={tabClass(moreOpen || moreActive)}
            aria-expanded={moreOpen}
          >
            {tabMark(moreOpen || moreActive)}
            {moreOpen ? <X className="size-[22px]" /> : <Menu className="size-[22px]" strokeWidth={1.8} />}
            <span className={cn(tabLabel, 'font-bold')}>More</span>
          </button>
        )}
      </nav>

      {/* Mobile "More" sheet */}
      {moreOpen && (
        <div className="md:hidden print:hidden fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40 rp-sent-in" />
          <div className="absolute bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-3 pb-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-300" />
            <div className="grid grid-cols-3 gap-2">
              {moreItems.map(item => (
                <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-center text-xs font-medium text-gray-700 active:bg-raised">
                  <item.icon className="size-5 text-brand" />
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <ThemeToggle className="w-32 shrink-0" />
              <button onClick={handleSignOut} className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2 text-sm font-medium text-gray-600 active:bg-raised">
                <LogOut className="size-4" />Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
