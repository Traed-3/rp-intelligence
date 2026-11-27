import { canUseSettings } from '@/lib/role-access'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canReadConstruction, money } from '@/lib/construction'
import { moduleLabel } from '@/lib/modules'
import { CheckCircle } from 'lucide-react'
import { Wrench, HardHat, Fuel, AlertTriangle, FileText, Package, ShieldCheck, ListChecks, SlidersHorizontal } from '@/components/icons/solar'
import { hasComplianceGrant } from '@/lib/compliance-guard'
import { loadFiles } from '@/lib/compliance-data'
import { allowedDashboardCards, type DashboardCardKey } from '@/lib/nav-items'
import { loadUiPrefs, visible, cardStyleOf } from '@/lib/ui-prefs'
import { DepartmentCard } from '@/components/dashboard/department-card'
import { SortableGrid } from '@/components/dashboard/sortable-grid'

const SVC_OPEN_STATUSES = ['dispatched', 'new', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

export default async function CompanyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ blocked?: string }>
}) {
  const { blocked } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('id, company_id, full_name, role').eq('id', user!.id).single()
  const companyId = profile!.company_id
  const showConstruction = canReadConstruction(profile ?? undefined)

  // Which cards this person may have (role + module access), then which of those they chose to show, in their order.
  const [{ data: blocks }, complianceGranted, prefs] = await Promise.all([
    admin.from('profile_module_blocks').select('module').eq('profile_id', user!.id),
    hasComplianceGrant(admin, companyId, user!.id),
    loadUiPrefs(admin, user!.id),
  ])
  const allowed = allowedDashboardCards({ role: profile?.role, userId: user!.id, blockedModules: (blocks ?? []).map(b => b.module), complianceGranted })
  const cards = visible([...allowed], prefs.dashboard)
  const look = cardStyleOf(prefs)   // the square style picked in Settings → Personalize
  const show = (k: DashboardCardKey) => cards.some(c => c.key === k)
  const none = Promise.resolve(null)
  const todayStr = new Date().toISOString().split('T')[0]

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const thisYear = String(new Date().getFullYear())

  const [
    { count: maintOpen },
    { count: maintCritical },
    { count: maintDown },
    { data: svcStaleCandidates },
    { count: svcOpen },
    { count: svcRtn },
    { count: svcRejected },
    conStats,
  ] = await Promise.all([
    admin.from('repair_tickets').select('id', { count: 'exact', head: true }).eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)'),
    admin.from('repair_tickets').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('priority', ['critical', 'safety']).not('status', 'in', '(completed,closed,deferred)'),
    admin.from('assets').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['down', 'unsafe']),
    admin.from('svc_work_orders').select('id, last_update_at').eq('company_id', companyId).in('status', SVC_OPEN_STATUSES).not('last_update_at', 'is', null),
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('status', SVC_OPEN_STATUSES),
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('return_trip_needed', true).not('status', 'in', '(completed,invoiced,paid)'),
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('invoice_rejected', true),
    showConstruction && show('construction')
      ? Promise.all([
          admin.from('con_jobs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).neq('stage', 'complete'),
          admin.from('con_documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('review_status', 'needs_review'),
          admin.from('con_invoices').select('invoice_grand_total, invoice_date').eq('company_id', companyId).neq('status', 'void').neq('status', 'draft'),
        ])
      : Promise.resolve(null),
  ])

  // Extra cards are only queried when the person has them switched on.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [plateStats, billingStats, inventoryStats, complianceStats] = await Promise.all([
    show('my_plate') ? Promise.all([
      admin.from('con_tasks').select('id', { count: 'exact', head: true }).eq('owner_id', user!.id).eq('status', 'open'),
      admin.from('con_tasks').select('id', { count: 'exact', head: true }).eq('owner_id', user!.id).eq('status', 'waiting'),
      admin.from('con_tasks').select('id', { count: 'exact', head: true }).eq('owner_id', user!.id).eq('status', 'open').lt('due_date', today),
    ]) : none,
    show('billing') ? Promise.all([
      admin.from('con_quotes').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['draft', 'sent']),
      admin.from('con_invoices').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'draft'),
      admin.from('con_invoices').select('invoice_grand_total').eq('company_id', companyId).neq('status', 'void').neq('status', 'draft').gte('invoice_date', `${thisYear}-01-01`),
    ]) : none,
    show('inventory') ? Promise.all([
      admin.from('parts').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('active', true).neq('price_status', 'ok'),
      admin.from('billing_inbox_documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'new'),
      admin.from('stock_transfers').select('id', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['pending', 'picked']),
    ]) : none,
    show('compliance') ? loadFiles(admin, companyId) : none,
  ])

  // Same rules as the DQF & Certs page: required DOT-driver items that are expired or inside the notice window.
  let dotExpired = 0, dotSoon = 0, dqfIncomplete = 0
  if (complianceStats) {
    const drivers = complianceStats.files.filter(f => f.employee.is_active && f.employee.is_dot_driver)
    for (const f of drivers) for (const r of f.rows) {
      if (r.type.category !== 'dqf' || !r.required) continue
      if (r.health === 'expired') dotExpired++
      else if (r.health === 'due_soon') dotSoon++
    }
    dqfIncomplete = drivers.filter(f => f.rows.some(r => r.required && r.type.category === 'dqf' && r.health === 'missing')).length
  }
  const billedThisYear = (billingStats?.[2].data ?? []).reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)

  const svcStale = (svcStaleCandidates ?? []).filter(w => new Date(w.last_update_at as string).getTime() < sevenDaysAgo).length

  let conJobsActive = 0
  let conReviewCount = 0
  let conInvoicedThisYear = 0
  if (conStats) {
    const [{ count: activeJobCount }, { count: reviewCount }, { data: invoices }] = conStats
    conJobsActive = activeJobCount ?? 0
    conReviewCount = reviewCount ?? 0
    conInvoicedThisYear = (invoices ?? [])
      .filter(i => String(i.invoice_date ?? '').startsWith(thisYear))
      .reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Only count what this person can actually see on their dashboard.
  const totalAttention = (show('maintenance') ? (maintCritical ?? 0) + (maintDown ?? 0) : 0) + (show('service') ? (svcRtn ?? 0) + svcStale : 0) + (show('compliance') ? dotExpired : 0)

  const cardFor: Record<DashboardCardKey, React.ReactNode> = {
    maintenance: (
      <DepartmentCard key="maintenance" cardKey="maintenance" look={look} href="/maintenance" title="Maintenance & Fleet" icon={Wrench}
        figures={[
          { label: 'Open Tickets', value: maintOpen ?? 0 },
          { label: 'Critical / Safety', value: maintCritical ?? 0, alert: !!maintCritical },
          { label: 'Vehicles Down', value: maintDown ?? 0, alert: !!maintDown },
        ]} />
    ),
    service: (
      <DepartmentCard key="service" cardKey="service" look={look} href="/service" title="Service Dispatch" icon={Fuel}
        figures={[
          { label: 'Open Work Orders', value: svcOpen ?? 0 },
          { label: 'Return Trip Needed', value: svcRtn ?? 0, alert: !!svcRtn },
          { label: 'No Update 7+ Days', value: svcStale, alert: !!svcStale },
          { label: 'Invoice Rejected', value: svcRejected ?? 0, alert: !!svcRejected },
        ]} />
    ),
    construction: (
      <DepartmentCard key="construction" cardKey="construction" look={look} href="/construction" title="Construction" icon={HardHat}
        figures={[
          { label: 'Active Jobs', value: conJobsActive },
          { label: 'Docs to Review', value: conReviewCount, alert: !!conReviewCount },
          { label: `Invoiced ${thisYear}`, value: money(conInvoicedThisYear) },
        ]} />
    ),
    my_plate: (
      <DepartmentCard key="my_plate" cardKey="my_plate" look={look} href="/my" title="My Plate" icon={ListChecks}
        figures={[
          { label: 'Your Move', value: plateStats?.[0].count ?? 0 },
          { label: 'Waiting On', value: plateStats?.[1].count ?? 0 },
          { label: 'Overdue', value: plateStats?.[2].count ?? 0, alert: !!plateStats?.[2].count },
        ]} />
    ),
    billing: (
      <DepartmentCard key="billing" cardKey="billing" look={look} href="/billing" title="Quotes & Invoices" icon={FileText}
        figures={[
          { label: 'Open Quotes', value: billingStats?.[0].count ?? 0 },
          { label: 'Draft Invoices', value: billingStats?.[1].count ?? 0 },
          { label: `Invoiced ${thisYear}`, value: money(billedThisYear) },
        ]} />
    ),
    inventory: (
      <DepartmentCard key="inventory" cardKey="inventory" look={look} href="/inventory" title="Inventory" icon={Package}
        figures={[
          { label: 'Parts Need a Price', value: inventoryStats?.[0].count ?? 0, alert: !!inventoryStats?.[0].count },
          { label: 'Paperwork to Receive', value: inventoryStats?.[1].count ?? 0 },
          { label: 'Transfers in Motion', value: inventoryStats?.[2].count ?? 0 },
        ]} />
    ),
    compliance: (
      <DepartmentCard key="compliance" cardKey="compliance" look={look} href="/compliance" title="DQF & Certs" icon={ShieldCheck}
        figures={[
          { label: 'DOT Items Expired', value: dotExpired, alert: !!dotExpired },
          { label: 'DOT Items Due Soon', value: dotSoon },
          { label: 'Driver Files Incomplete', value: dqfIncomplete, alert: !!dqfIncomplete },
        ]} />
    ),
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">

      {blocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You don&apos;t have access to <strong>{moduleLabel(blocked)}</strong>. Contact your manager if this is unexpected.
        </div>
      )}

      {/* Hero header band */}
      <div className="relative overflow-hidden rounded-3xl px-6 py-7 sm:px-8 sm:py-8 shadow-lg"
        data-hero>
        <div className="pointer-events-none absolute -top-20 -right-12 w-64 h-64 rounded-full bg-blue-300/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 w-64 h-64 rounded-full bg-green-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-200/70">{dateLabel}</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mt-1.5 tracking-tight">
              Good {greeting}, {profile?.full_name?.split(' ')[0]}
            </h1>
            <p className="text-sm text-blue-100/60 mt-1.5">Here&apos;s how your departments are doing right now.</p>
          </div>
          {totalAttention > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-400/15 border border-amber-300/30 px-4 py-2 text-sm font-semibold text-amber-100 backdrop-blur-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {totalAttention} item{totalAttention !== 1 ? 's' : ''} need attention company-wide
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-green-400/15 border border-green-300/30 px-4 py-2 text-sm font-semibold text-green-100 backdrop-blur-sm">
              <CheckCircle className="w-4 h-4 shrink-0" /> All caught up
            </span>
          )}
        </div>
      </div>

      {/* Department cards: the ones this person switched on, in their order (drag them here, or Settings → Personalize) */}
      {cards.length === 0 ? (
        <div className="rp-empty">
          <p>Every dashboard card is switched off.</p>
          {canUseSettings(profile?.role) && <Link href="/settings/personalize" className="text-blue-600">Choose your cards</Link>}
        </div>
      ) : (
        <SortableGrid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          items={cards.map(c => ({ key: c.key, node: cardFor[c.key] }))} />
      )}

      {canUseSettings(profile?.role) && <p className="text-center">
        <Link href="/settings/personalize" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
          <SlidersHorizontal className="w-3.5 h-3.5" /> Personalize this dashboard
        </Link>
      </p>}
    </div>
  )
}
