'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LogOut, Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { buildNav, type NavItem } from '@/lib/nav-items'
import { visible, MAX_TABS, type UiPrefs } from '@/lib/ui-prefs'

export default function AppNav({ email, role, userId, blockedModules, complianceGranted, prefs }: { email: string; role?: string; userId?: string; blockedModules?: string[]; complianceGranted?: boolean; prefs?: UiPrefs }) {
  const pathname = usePathname()
  const router = useRouter()
  const { sidebar, defaultTabs, tabChoices, surveyOnly } = buildNav({ role, userId, blockedModules, complianceGranted })

  // The person's own order and hidden entries (Settings → Personalize). Settings itself can never be hidden.
  const visibleNavItems = surveyOnly ? sidebar : visible(sidebar, prefs?.nav, ['/settings'])

  // Phone bottom bar: the tabs they picked, or the standard set.
  const picked = (prefs?.tabs ?? []).map(href => tabChoices.find(t => t.href === href)).filter((t): t is NavItem => !!t).slice(0, MAX_TABS)
  const mobileItems = surveyOnly || picked.length === 0 ? defaultTabs : picked
  // Everything else lives behind "More": the rest of the sidebar, plus any standard tab they took off the bar.
  const moreItems = surveyOnly ? [] : [
    ...visibleNavItems,
    ...(picked.length ? defaultTabs.filter(t => !visibleNavItems.some(v => v.href === t.href)) : []),
  ].filter(i => !mobileItems.some(m => m.href === i.href))
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
      <aside className="dark rp-sidebar hidden md:flex print:hidden sticky top-0 h-screen w-60 shrink-0 flex-col border-r border-sidebar-border text-foreground">
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
