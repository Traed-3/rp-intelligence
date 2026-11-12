import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { ClickableItem } from '@/components/clickable-item'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/dashboard/stat-card'
import { TicketStatusBadge, PriorityBadge } from '@/components/tickets/ticket-badges'
import { StatusBadge } from '@/components/assets/status-badge'
import { calcDateDue, calcOilChangeDue, toBand, BAND_CONFIG, sortByUrgency, type DueStatus } from '@/lib/maintenance'
import { checkOverdueMaintenanceNotifications, checkForgotClockOut } from '@/lib/notifications'
import { createOverdueMaintenanceTickets } from '@/lib/auto-tickets'
import { ClipboardList, AlertTriangle, Truck, Package, Wrench, Calendar, Users, Clock, Droplets, Circle, CircleDot, CalendarClock, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { revalidatePath } from 'next/cache'
import { RemindersCard } from './reminders-card'
import { MiscTasksCard } from './misc-tasks-card'
import { DailySummaryCard } from './daily-summary-card'

const STATUS_LABELS: Record<string, string> = {
  clocked_out: 'Clocked Out', at_shop: 'At Shop', working_on_ticket: 'Working on Ticket',
  waiting_parts: 'Waiting on Parts', parts_run: 'Parts Run', cleaning_shop: 'Cleaning Shop',
  helping_employee: 'Helping Employee', general_maintenance: 'General Maintenance',
  break: 'Break', lunch: 'Lunch', meeting: 'Meeting', off_site: 'Off Site', other: 'Other',
}

function minsAgo(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'just now'
  if (diff < 60) return `${diff}m ago`
  const h = Math.floor(diff / 60); const m = diff % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function fmtMins(mins: number) {
  const h = Math.floor(mins / 60); const m = mins % 60
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

// ── "Coming Due" — asset-level due dates (oil/brakes/tires/inspection/registration) ─

type AssetRow = {
  id: string; unit_number: string; name: string | null; make: string | null; model: string | null
  status: string; current_mileage: number | null; next_oil_change_mileage: number | null
  next_brake_inspection_date: string | null; next_tire_inspection_date: string | null
  inspection_due_date: string | null; registration_due_date: string | null
}
type AlertItem = {
  assetId: string; unitNumber: string; vehicleLabel: string
  category: string; status: DueStatus; daysUntil: number | null; detail: string; href: string
}

const BAND_ORDER: Array<keyof typeof BAND_CONFIG> = ['overdue', 'due_this_week', 'due_next_2_weeks', 'due_this_month']
const BAND_STYLES = {
  overdue:          'border-red-200 bg-red-50',
  due_this_week:    'border-orange-200 bg-orange-50',
  due_next_2_weeks: 'border-yellow-200 bg-yellow-50',
  due_this_month:   'border-blue-100 bg-blue-50',
}
const BAND_HEADER = {
  overdue:          'text-red-700 bg-red-100',
  due_this_week:    'text-orange-700 bg-orange-100',
  due_next_2_weeks: 'text-yellow-700 bg-yellow-100',
  due_this_month:   'text-blue-700 bg-blue-100',
}

function buildAlerts(assets: AssetRow[]): AlertItem[] {
  const items: AlertItem[] = []
  for (const a of assets) {
    if (a.status === 'retired') continue
    const label = [a.make, a.model].filter(Boolean).join(' ') || a.name || ''
    const base = { assetId: a.id, unitNumber: a.unit_number, vehicleLabel: label }
    const checks = [
      { r: calcOilChangeDue(a.current_mileage, a.next_oil_change_mileage), category: 'Oil Change', href: `/assets/${a.id}/maintenance/oil-change` },
      { r: calcDateDue(a.next_brake_inspection_date), category: 'Brake Inspection', href: `/assets/${a.id}/maintenance/brakes` },
      { r: calcDateDue(a.next_tire_inspection_date), category: 'Tire Inspection', href: `/assets/${a.id}/maintenance/tires` },
      { r: calcDateDue(a.inspection_due_date), category: 'Inspection', href: `/assets/${a.id}/edit` },
      { r: calcDateDue(a.registration_due_date), category: 'Registration', href: `/assets/${a.id}/edit` },
    ]
    for (const { r, category, href } of checks) {
      if (r.status !== 'ok' && r.status !== 'no_data') items.push({ ...base, category, status: r.status, daysUntil: r.daysUntil, detail: r.label, href })
    }
  }
  return sortByUrgency(items)
}

// Roles shown in the default "shop" view
const SHOP_ROLES = ['shop_employee', 'shop_manager', 'mechanic', 'service_tech', 'construction_tech']
// All roles that can appear in the employee status table
const ALL_STAFF_ROLES = ['owner', 'manager', 'shop_manager', 'shop_employee', 'mechanic', 'service_tech', 'construction_tech', 'office_staff']

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string }>
}) {
  const { staff = 'shop' } = await searchParams
  const showAll = staff === 'all'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, full_name, role').eq('id', user!.id).single()
  const companyId = profile!.company_id
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  // Non-vehicle asset types whose open tickets belong on the Misc Tasks list
  const { data: miscTypes } = await admin.from('asset_types').select('id, name')
    .eq('company_id', companyId).in('name', ['Building / Facility', 'Equipment', 'Machine'])
  const miscTypeIds = (miscTypes ?? []).map(t => t.id)
  const buildingFacilityId = (miscTypes ?? []).find(t => t.name === 'Building / Facility')?.id ?? null

  const canAssign = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')
  const { data: assignable } = await admin.from('profiles').select('id, full_name')
    .eq('company_id', companyId).eq('is_active', true)
    .in('role', ['owner', 'manager', 'shop_manager', 'shop_employee', 'mechanic', 'service_tech', 'construction_tech'])
    .order('full_name')

  const weekStart  = new Date(todayStart); weekStart.setDate(todayStart.getDate() - todayStart.getDay())
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1)
  const weekEnd      = new Date(todayStart); weekEnd.setDate(todayStart.getDate() + 7)
  const monthEnd     = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0)
  const todayStr      = todayStart.toISOString().split('T')[0]
  const weekStartStr  = weekStart.toISOString().split('T')[0]
  const monthStartStr = monthStart.toISOString().split('T')[0]
  const weekEndStr    = weekEnd.toISOString().split('T')[0]
  const monthEndStr   = monthEnd.toISOString().split('T')[0]

  const [
    { count: openCount },
    { count: criticalCount },
    { count: waitingCount },
    { data: downAssets },
    { data: allAssets },
    { data: employees },
    { data: todayClocks },
    { data: recentTickets },
    { count: completedToday },
    { count: completedWeek },
    { count: completedMonth },
    { count: overdueTicketCount },
    { count: dueThisWeekTicketCount },
    { data: gpsTickets },
    { data: oilChangeTickets },
    { data: partsReceivedTickets },
    { data: maintenanceAlertTickets },
    { data: reminderTickets },
    { data: miscTasks },
  ] = await Promise.all([
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').not('title', 'ilike', 'Registration%').not('title', 'ilike', 'State Inspection%'),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('priority', ['critical', 'safety']).not('status', 'in', '(completed,closed,deferred)'),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).or('waiting_on_parts.eq.true,status.eq.waiting_parts').not('status', 'in', '(completed,closed,deferred)'),
    admin.from('assets').select('id, unit_number, name, make, model, year, status').eq('company_id', companyId).in('status', ['down', 'unsafe']),
    admin.from('assets').select('id, unit_number, name, make, model, status, current_mileage, next_oil_change_mileage, next_brake_inspection_date, next_tire_inspection_date, inspection_due_date, registration_due_date').eq('company_id', companyId).neq('status', 'retired'),
    admin.from('profiles').select('id, full_name, role').eq('company_id', companyId).in('role', showAll ? ALL_STAFF_ROLES : SHOP_ROLES).eq('is_active', true).order('full_name'),
    admin.from('time_clock_entries').select('profile_id, clock_in, clock_out, total_minutes').eq('company_id', companyId).gte('clock_in', todayStart.toISOString()),
    admin.from('repair_tickets').select('id, ticket_number, title, status, priority, updated_at, assigned_to, assets(unit_number), profiles!repair_tickets_assigned_to_fkey(full_name)').eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').not('title', 'ilike', 'Registration%').not('title', 'ilike', 'State Inspection%').order('updated_at', { ascending: false }).limit(20),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['completed','closed']).gte('date_completed', todayStr),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['completed','closed']).gte('date_completed', weekStartStr),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).in('status', ['completed','closed']).gte('date_completed', monthStartStr),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').not('due_date', 'is', null).lt('due_date', todayStr),
    admin.from('repair_tickets').select('*', { count: 'exact', head: true }).eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').not('due_date', 'is', null).gte('due_date', todayStr).lte('due_date', weekEndStr),
    admin.from('repair_tickets').select('id, ticket_number, title, status, assigned_to, due_date, assets(unit_number, asset_type_id), profiles!repair_tickets_assigned_to_fkey(full_name)').eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').ilike('title', '%GPS Unit Needed%').order('due_date'),
    admin.from('repair_tickets').select('id, ticket_number, title, due_date, assets(unit_number)').eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').or('title.ilike.*oil change*,title.ilike.*service due*,title.ilike.*service needed*').order('due_date'),
    admin.from('repair_tickets').select('id, ticket_number, title, status, assets(unit_number)').eq('company_id', companyId).eq('parts_ordered', true).eq('waiting_on_parts', false).not('status', 'in', '(completed,closed,deferred,waiting_parts)').order('updated_at', { ascending: false }),
    admin.from('repair_tickets').select('id, ticket_number, title, status, priority, due_date, assets(unit_number)').eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').not('due_date', 'is', null).lte('due_date', monthEndStr).not('title', 'ilike', 'Registration%').not('title', 'ilike', 'State Inspection%').order('due_date'),
    admin.from('repair_tickets').select('id, ticket_number, title, due_date, assets(unit_number, make, model, name, registration_due_date, inspection_due_date)').eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').or('title.ilike.Registration*,title.ilike.State Inspection*').order('due_date', { nullsFirst: false }),
    admin.from('repair_tickets').select('id, ticket_number, title, status, assigned_to, assets!inner(unit_number, asset_type_id), profiles!repair_tickets_assigned_to_fkey(full_name)').eq('company_id', companyId).not('status', 'in', '(completed,closed,deferred)').in('assets.asset_type_id', miscTypeIds.length ? miscTypeIds : ['00000000-0000-0000-0000-000000000000']).order('updated_at', { ascending: false }).limit(50),
  ])

  const empIds = (employees ?? []).map(e => e.id)
  const { data: empStatusData } = await admin
    .from('employee_statuses')
    .select('profile_id, clock_status, current_status, current_ticket_id, status_updated_at, repair_tickets(id, ticket_number, title)')
    .in('profile_id', empIds)

  const { data: latestSummary } = await admin
    .from('daily_summaries')
    .select('content, period_start, period_end, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const statusMap = Object.fromEntries((empStatusData ?? []).map(s => [s.profile_id, s]))
  const clockedInCount = (empStatusData ?? []).filter(s => s.clock_status === 'clocked_in').length
  const now = Date.now()

  const totalShopMins = (todayClocks ?? []).reduce((sum, e) => {
    return sum + (e.clock_out ? (e.total_minutes ?? 0) : Math.round((now - new Date(e.clock_in).getTime()) / 60000))
  }, 0)
  const hoursToday: Record<string, number> = {}
  for (const e of todayClocks ?? []) {
    const m = e.clock_out ? (e.total_minutes ?? 0) : Math.round((now - new Date(e.clock_in).getTime()) / 60000)
    hoursToday[e.profile_id] = (hoursToday[e.profile_id] ?? 0) + m
  }

  // Asset-level "Coming Due" — the full breakdown (oil/brakes/tires/inspection/registration)
  const alerts = buildAlerts(allAssets ?? [])
  const totalAlerts = alerts.length
  const bands = {
    overdue:          alerts.filter(a => toBand(a.status) === 'overdue'),
    due_this_week:    alerts.filter(a => toBand(a.status) === 'due_this_week'),
    due_next_2_weeks: alerts.filter(a => toBand(a.status) === 'due_next_2_weeks'),
    due_this_month:   alerts.filter(a => toBand(a.status) === 'due_this_month'),
  }

  // Misc Tasks = open tickets on non-vehicle assets (property/equipment/machine) + GPS-install tickets
  const miscSeen = new Set<string>()
  const miscItems = [...(miscTasks ?? []), ...(gpsTickets ?? [])]
    .filter(t => {
      const id = (t as any).id as string
      if (miscSeen.has(id)) return false
      miscSeen.add(id); return true
    })
    .map(t => {
      const a = (t as any).assets
      const typeId = a?.asset_type_id ?? null
      return {
        id: (t as any).id as string,
        title: (t as any).title as string,
        unitNumber: a?.unit_number ?? '—',
        status: (t as any).status as string,
        assignedId: (t as any).assigned_to ?? null,
        assignedName: (t as any).profiles?.full_name ?? null,
        category: (typeId && typeId === buildingFacilityId ? 'property' : 'equipment') as 'property' | 'equipment',
      }
    })

  // Fire-and-forget background tasks
  checkOverdueMaintenanceNotifications(admin, companyId).catch(() => {})
  checkForgotClockOut(admin, companyId).catch(() => {})
  createOverdueMaintenanceTickets(admin, companyId).catch(() => {})

  // Close a reminder (Registration / State Inspection) from this page
  async function completeReminder(ticketId: string) {
    'use server'
    const sb = await createClient()
    const { data: { user: u } } = await sb.auth.getUser()
    if (!u) return
    const a = createAdminClient()
    await a.from('repair_tickets')
      .update({ status: 'completed', date_completed: new Date().toISOString().split('T')[0], completed_by: u.id })
      .eq('id', ticketId).eq('company_id', companyId)
    revalidatePath('/maintenance')
  }

  const tiles = [
    { href: '/assets',                    label: 'Assets',        icon: Truck,         sub: 'Fleet & equipment' },
    { href: '/tickets',                   label: 'Tickets',       icon: ClipboardList, sub: 'Repairs & work orders' },
    { href: '/shop',                      label: 'Shop',          icon: Users,         sub: 'Clock, tasks & time' },
    { href: '/maintenance/oil-changes',   label: 'Oil Changes',   icon: Droplets },
    { href: '/maintenance/brakes',        label: 'Brakes',        icon: Circle },
    { href: '/maintenance/tires',         label: 'Tires',         icon: CircleDot },
    { href: '/maintenance/inspections',   label: 'Inspections',   icon: CalendarClock },
    { href: '/maintenance/registrations', label: 'Registrations', icon: FileText },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="rp-title">
          Maintenance & Fleet
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {totalAlerts === 0 ? 'All assets are up to date.' : `${totalAlerts} maintenance item${totalAlerts !== 1 ? 's' : ''} need${totalAlerts === 1 ? 's' : ''} attention`}
        </p>
      </div>

      {/* Module tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="rp-card rp-card-link p-4">
            <t.icon className="w-5 h-5 text-blue-600 mb-2" />
            <p className="text-sm font-semibold text-gray-900">{t.label}</p>
            {'sub' in t && t.sub && <p className="text-xs text-gray-400 mt-0.5">{t.sub}</p>}
          </Link>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Open Tickets"      value={openCount ?? 0}           icon={ClipboardList} color="blue"   href="/tickets" />
        <StatCard label="Critical / Safety" value={criticalCount ?? 0}       icon={AlertTriangle} color="red"    href="/tickets?priority=critical" alert />
        <StatCard label="Vehicles Down"     value={downAssets?.length ?? 0}  icon={Truck}         color="red"    href="/assets?status=down" alert />
        <StatCard label="Waiting on Parts"  value={waitingCount ?? 0}        icon={Package}       color="orange" href="/tickets?status=waiting_parts" />
        <StatCard label="Overdue Maint."    value={overdueTicketCount ?? 0}   icon={Wrench}    color="red"    href="/tickets?due=overdue" alert />
        <StatCard label="Due This Week"     value={dueThisWeekTicketCount ?? 0} icon={Calendar}  color="orange" href="/tickets?due=week" />
        <StatCard label="Clocked In"        value={clockedInCount}           icon={Users}         color="green"  href="/shop" />
        <StatCard label="Shop Hrs Today"    value={(totalShopMins / 60).toFixed(1) + 'h'} icon={Clock} color="gray" href="/shop" />
      </div>

      {/* Today's 3pm recap */}
      <DailySummaryCard
        generatedAt={latestSummary?.created_at  ?? null}
        periodStart={latestSummary?.period_start ?? null}
        periodEnd={latestSummary?.period_end     ?? null}
        content={latestSummary?.content          ?? null}
      />

      {/* Misc Tasks */}
      <MiscTasksCard items={miscItems} employees={assignable ?? []} canAssign={canAssign} />

      {/* Completed + Oil Change + Parts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="rp-card overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <h3 className="text-xs font-bold text-gray-600 uppercase tracking-wide">Tickets Completed</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {[
              { label: 'Today',      value: completedToday ?? 0 },
              { label: 'This Week',  value: completedWeek ?? 0 },
              { label: 'This Month', value: completedMonth ?? 0 },
            ].map(row => (
              <Link key={row.label} href="/tickets?status=completed" className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <span className="text-sm text-gray-600">{row.label}</span>
                <span className="text-lg font-bold text-green-700">{row.value}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rp-card overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-amber-700 uppercase tracking-wide">🔧 Oil Change Due</h3>
            <span className="text-xs font-bold text-amber-600">{oilChangeTickets?.length ?? 0}</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-40 overflow-y-auto">
            {oilChangeTickets?.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">All oil changes current ✓</p>}
            {(oilChangeTickets ?? []).map(t => (
              <Link key={t.id} href={`/tickets/${t.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                <span className="text-sm font-medium text-gray-900">{(t as any).assets?.unit_number ?? '—'}</span>
                {(t as any).due_date && (
                  <span className={`text-xs font-semibold ${new Date((t as any).due_date) <= new Date() ? 'text-red-600' : 'text-amber-600'}`}>
                    {new Date((t as any).due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="rp-card overflow-hidden">
          <div className="px-4 py-2.5 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-purple-700 uppercase tracking-wide">📦 Parts In – Schedule</h3>
            <span className="text-xs font-bold text-purple-600">{partsReceivedTickets?.length ?? 0}</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-40 overflow-y-auto">
            {partsReceivedTickets?.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">No parts awaiting scheduling</p>}
            {(partsReceivedTickets ?? []).map(t => (
              <Link key={t.id} href={`/tickets/${t.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                  <p className="text-xs text-gray-400">{(t as any).assets?.unit_number ?? '—'}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Maintenance Alerts — ticket due_date based */}
      {(maintenanceAlertTickets ?? []).length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 before:content-[''] before:w-1.5 before:h-5 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">Maintenance Alerts</h2>
            <Link href="/tickets" className="text-sm text-blue-600 hover:text-blue-800 font-medium">All tickets →</Link>
          </div>
          {(() => {
            const nowD = new Date(todayStr)
            const w7  = new Date(weekEndStr)
            const w14 = new Date(todayStr); w14.setDate(w14.getDate() + 14)
            const bands2 = {
              overdue:          (maintenanceAlertTickets ?? []).filter(t => new Date((t as any).due_date) < nowD),
              due_this_week:    (maintenanceAlertTickets ?? []).filter(t => { const d = new Date((t as any).due_date); return d >= nowD && d <= w7 }),
              due_next_2_weeks: (maintenanceAlertTickets ?? []).filter(t => { const d = new Date((t as any).due_date); return d > w7 && d <= w14 }),
              due_this_month:   (maintenanceAlertTickets ?? []).filter(t => { const d = new Date((t as any).due_date); return d > w14 }),
            }
            const bandDefs = {
              overdue:          { label: 'Overdue',        header: 'bg-red-600 text-white' },
              due_this_week:    { label: 'Due This Week',  header: 'bg-orange-500 text-white' },
              due_next_2_weeks: { label: 'Due in 2 Weeks', header: 'bg-yellow-400 text-gray-900' },
              due_this_month:   { label: 'Due This Month', header: 'bg-primary text-primary-foreground' },
            }
            return (
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                {(Object.entries(bands2) as [keyof typeof bands2, typeof maintenanceAlertTickets][]).map(([band, items]) => {
                  if (!items || items.length === 0) return null
                  const def = bandDefs[band]
                  return (
                    <div key={band} className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                      <div className={cn('px-3 py-2 text-xs font-bold uppercase tracking-wide flex justify-between', def.header)}>
                        <span>{def.label}</span>
                        <span>{items.length}</span>
                      </div>
                      <div className="divide-y divide-gray-50 bg-card max-h-48 overflow-y-auto">
                        {items.map(t => (
                          <ClickableItem key={t.id} href={`/tickets/${t.id}`} className="px-3 py-2 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-900 truncate">{(t as any).assets?.unit_number ?? '—'}</p>
                              <p className="text-xs text-gray-500 truncate">{t.title.replace(/ — .*/, '')}</p>
                            </div>
                            <span className="text-xs text-blue-600 shrink-0 font-medium">Open →</span>
                          </ClickableItem>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </section>
      )}

      {/* Employee Status */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 before:content-[''] before:w-1.5 before:h-5 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">Employee Status</h2>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              <Link href="/maintenance?staff=shop" className={`px-3 py-1.5 transition-colors ${!showAll ? 'bg-primary text-primary-foreground' : 'bg-card text-gray-600 hover:bg-gray-50'}`}>Shop View</Link>
              <Link href="/maintenance?staff=all" className={`px-3 py-1.5 transition-colors ${showAll ? 'bg-primary text-primary-foreground' : 'bg-card text-gray-600 hover:bg-gray-50'}`}>All Staff</Link>
            </div>
            <Link href="/shop" className="text-sm text-blue-600 hover:text-blue-800 font-medium">Shop →</Link>
          </div>
        </div>
        <div className="rp-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5">Employee</th>
                  <th className="text-left px-4 py-2.5">Current Status</th>
                  <th className="text-left px-4 py-2.5 hidden md:table-cell">Working On</th>
                  <th className="text-left px-4 py-2.5 hidden lg:table-cell">Time on Status</th>
                  <th className="text-right px-4 py-2.5">Hours Today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(employees ?? [])
                  .filter(emp => statusMap[emp.id]?.clock_status === 'clocked_in')
                  .map(emp => {
                  const s = statusMap[emp.id]
                  const mins = hoursToday[emp.id] ?? 0
                  return (
                    <ClickableRow key={emp.id} href={`/shop/employees/${emp.id}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0 bg-green-500" />
                          <Link href={`/shop/employees/${emp.id}`} className="font-medium text-gray-900 hover:text-blue-600">{emp.full_name}</Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-sm">{s ? STATUS_LABELS[s.current_status] ?? s.current_status : '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {(s as any)?.repair_tickets ? (
                          <Link href={`/tickets/${(s as any).repair_tickets.id}`} className="text-xs text-blue-600 hover:underline">{(s as any).repair_tickets.ticket_number}</Link>
                        ) : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden lg:table-cell">{s?.status_updated_at ? minsAgo(s.status_updated_at) : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">{mins > 0 ? fmtMins(mins) : '—'}</td>
                    </ClickableRow>
                  )
                })}
                {(employees ?? []).filter(emp => statusMap[emp.id]?.clock_status === 'clocked_in').length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No employees currently clocked in.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Reminders */}
      <RemindersCard reminders={(reminderTickets ?? []).map(t => {
        const a = (t as any).assets
        const isReg = /^registration/i.test(t.title)
        return {
          id: t.id,
          title: t.title,
          unit: a?.unit_number ?? null,
          description: [a?.make, a?.model].filter(Boolean).join(' ') || a?.name || null,
          dueDate: (isReg ? a?.registration_due_date : a?.inspection_due_date) ?? (t as any).due_date ?? null,
        }
      })} onComplete={completeReminder} />

      {/* Coming Due — full asset-level breakdown */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Coming Due</h2>
        {totalAlerts === 0 ? (
          <div className="rp-card p-12 text-center">
            <div className="text-4xl mb-3">✅</div>
            <p className="font-semibold text-gray-900">All clear!</p>
            <p className="text-sm text-gray-500 mt-1">No maintenance items are overdue or coming due soon.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {BAND_ORDER.map((band) => {
              const items = bands[band]
              if (items.length === 0) return null
              const cfg = BAND_CONFIG[band]
              return (
                <div key={band} className={`rounded-xl border overflow-hidden ${BAND_STYLES[band]}`}>
                  <div className={`px-5 py-3 flex items-center justify-between ${BAND_HEADER[band]}`}>
                    <h2 className="font-bold text-sm uppercase tracking-wide">{cfg.label}</h2>
                    <span className="text-sm font-semibold">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-white/60">
                    {items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between px-5 py-3 bg-card/60">
                        <div className="flex items-center gap-3 min-w-0">
                          <div>
                            <Link href={`/assets/${item.assetId}`} className="font-semibold text-gray-900 hover:text-blue-600 text-sm">{item.unitNumber}</Link>
                            {item.vehicleLabel && <span className="text-gray-500 text-sm ml-2">{item.vehicleLabel}</span>}
                            <p className="text-xs text-gray-500 mt-0.5">{item.category}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <span className="text-xs text-gray-600 hidden sm:block">{item.detail}</span>
                          <Link href={item.href} className="text-xs font-medium text-blue-600 hover:text-blue-800 whitespace-nowrap">Record →</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Assets Down */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 before:content-[''] before:w-1.5 before:h-5 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">Assets Down</h2>
          <Link href="/assets?status=down" className="text-sm text-blue-600 hover:text-blue-800 font-medium">Assets →</Link>
        </div>
        <div className="rp-card overflow-hidden">
          {!downAssets?.length
            ? <p className="px-5 py-6 text-center text-sm text-gray-400">No assets currently down. ✅</p>
            : <div className="divide-y divide-gray-50">
                {downAssets.map(a => (
                  <div key={a.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <Link href={`/assets/${a.id}`} className="text-sm font-semibold text-gray-900 hover:text-blue-600">{a.unit_number}</Link>
                      <p className="text-xs text-gray-500">{[a.year, a.make, a.model].filter(Boolean).join(' ') || a.name || '—'}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
              </div>
          }
        </div>
      </section>

      {/* Open Tickets — a compact panel, not a full list; /tickets is where you browse */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 before:content-[''] before:w-1.5 before:h-5 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">Open Tickets</h2>
          <Link href="/tickets" className="text-sm text-blue-600 hover:text-blue-800 font-medium">{openCount ?? 0} total — view all →</Link>
        </div>
        <div className="rp-card overflow-hidden">
          {!recentTickets?.length ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No open tickets. 🎉</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentTickets.slice(0, 6).map(t => (
                <ClickableItem key={t.id} href={`/tickets/${t.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{t.title}</p>
                    <p className="text-xs text-gray-400">{t.ticket_number} · {(t as any).assets?.unit_number ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PriorityBadge priority={t.priority} />
                    <TicketStatusBadge status={t.status} />
                  </div>
                </ClickableItem>
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  )
}
