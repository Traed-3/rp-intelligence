import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canReadConstruction, money } from '@/lib/construction'
import { moduleLabel } from '@/lib/modules'
import { ArrowRight, Wrench, HardHat, Fuel, AlertTriangle, CheckCircle } from 'lucide-react'

const SVC_OPEN_STATUSES = ['dispatched', 'new', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

type Figure = { label: string; value: string | number; alert?: boolean }

function DepartmentCard({
  href, title, icon: Icon, accent, figures, allClear, badge,
}: {
  href: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  figures: Figure[]
  allClear?: boolean
  badge?: string
}) {
  return (
    <Link
      href={href}
      className="group relative bg-white rounded-2xl border border-gray-200 shadow-sm p-5 hover:border-blue-300 hover:shadow-md transition-all flex flex-col"
    >
      {badge && (
        <span className="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200 shadow-sm">
          {badge}
        </span>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent}`}>
            <Icon className="w-4.5 h-4.5" />
          </span>
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
        </div>
        <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
      </div>

      {allClear ? (
        <div className="flex items-center gap-2 text-green-700 text-sm font-medium py-2">
          <CheckCircle className="w-4 h-4" /> All caught up
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {figures.map((f) => (
            <div key={f.label}>
              <p className={`text-2xl font-bold ${f.alert ? 'text-red-600' : 'text-gray-900'}`}>{f.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{f.label}</p>
            </div>
          ))}
        </div>
      )}
    </Link>
  )
}

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
    showConstruction
      ? Promise.all([
          admin.from('con_jobs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).neq('stage', 'complete'),
          admin.from('con_documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('review_status', 'needs_review'),
          admin.from('con_invoices').select('invoice_grand_total, invoice_date').eq('company_id', companyId).neq('status', 'void').neq('status', 'draft'),
        ])
      : Promise.resolve(null),
  ])

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

  const totalAttention = (maintCritical ?? 0) + (maintDown ?? 0) + (svcRtn ?? 0) + svcStale

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">

      {blocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You don&apos;t have access to <strong>{moduleLabel(blocked)}</strong>. Contact your manager if this is unexpected.
        </div>
      )}

      {/* Hero header band */}
      <div className="relative overflow-hidden rounded-3xl px-6 py-7 sm:px-8 sm:py-8 shadow-lg"
        style={{ background: 'linear-gradient(135deg, #16243d 0%, #1e3558 55%, #2d4e7a 100%)' }}>
        <div className="pointer-events-none absolute -top-20 -right-12 w-64 h-64 rounded-full bg-blue-300/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 w-64 h-64 rounded-full bg-green-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-200/70">{dateLabel}</p>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mt-1.5 tracking-tight">
              Good {greeting}, {profile?.full_name?.split(' ')[0]}
            </h1>
            <p className="text-sm text-blue-100/60 mt-1.5">Here&apos;s how every department is doing right now.</p>
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

      {/* Department cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <DepartmentCard
          href="/maintenance"
          title="Maintenance & Fleet"
          icon={Wrench}
          accent="bg-blue-100 text-blue-700"
          figures={[
            { label: 'Open Tickets', value: maintOpen ?? 0 },
            { label: 'Critical / Safety', value: maintCritical ?? 0, alert: !!maintCritical },
            { label: 'Vehicles Down', value: maintDown ?? 0, alert: !!maintDown },
          ]}
        />

        <DepartmentCard
          href="/service"
          title="Service Dispatch"
          icon={Fuel}
          accent="bg-green-100 text-green-700"
          figures={[
            { label: 'Open Work Orders', value: svcOpen ?? 0 },
            { label: 'Return Trip Needed', value: svcRtn ?? 0, alert: !!svcRtn },
            { label: 'No Update 7+ Days', value: svcStale, alert: !!svcStale },
            { label: 'Invoice Rejected', value: svcRejected ?? 0, alert: !!svcRejected },
          ]}
        />

        {showConstruction && (
          <DepartmentCard
            href="/construction"
            title="Construction"
            icon={HardHat}
            accent="bg-amber-100 text-amber-700"
            figures={[
              { label: 'Active Jobs', value: conJobsActive },
              { label: 'Docs to Review', value: conReviewCount, alert: !!conReviewCount },
              { label: `Invoiced ${thisYear}`, value: money(conInvoicedThisYear) },
            ]}
          />
        )}
      </div>
    </div>
  )
}
