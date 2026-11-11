import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { CON_STAGES, money, fmtDate, projectNotificationStatus } from '@/lib/construction'
import { loadPermitGraph, computeAlerts, loadHashEnteredAt } from '@/lib/permits-data'
import { FOCUS_TILES, buildFocusTiles, tallyMaterials, daysSince, packingSlipSiteKey, type FocusJob, type PackingSlip } from '@/lib/construction-dashboard'
import { StageBadge } from '@/components/construction/badges'
import { Users, Contact, HardHat, FileText, Receipt, Package, CalendarDays, BarChart3, ClipboardList, ListChecks, Truck, Inbox, FileCheck2, AlertTriangle } from 'lucide-react'

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default async function ConstructionDashboard() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()
  const today = new Date()
  const todayIso = iso(today)
  const monday = new Date(today); monday.setDate(today.getDate() + ((today.getDay() === 0 ? -6 : 1) - today.getDay()))
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)

  // con_jobs has 1000+ rows once completed work piles up, and an unfiltered
  // select silently caps at Supabase's default 1000-row limit — so this only
  // ever loads OPEN jobs (everything the dashboard shows is about active work
  // anyway) and gets the completed count separately, cheaply, via head:true.
  const [{ data: jobs }, { count: completeCount }, { data: invoices }, { data: materialRows }, { data: slipRows }, { data: schedule }, permitGraph, hashEnteredAt] = await Promise.all([
    admin.from('con_jobs').select('id, site_number, job_number, work_order_number, stage, status_detail, scope_of_work, gas_brand, priority, date_received, project_start_date, updated_at, notification_sent_at, notification_waived, program, con_customers(name)').eq('company_id', company_id).neq('stage', 'complete'),
    admin.from('con_jobs').select('*', { count: 'exact', head: true }).eq('company_id', company_id).eq('stage', 'complete'),
    admin.from('con_invoices').select('id, invoice_number, invoice_date, status, invoice_grand_total, con_customers(name)').eq('company_id', company_id).neq('status', 'void'),
    admin.from('con_job_materials').select('id, job_id, status').eq('company_id', company_id),
    admin.from('billing_inbox_documents').select('id, subject, received_at, vendor, body_preview, status, note, thread_replies').eq('company_id', company_id).eq('kind', 'packing_slip').gte('received_at', iso(new Date(today.getTime() - 120 * 86_400_000))).order('received_at', { ascending: false }),
    admin.from('con_schedule_entries').select('*').eq('company_id', company_id).gte('schedule_date', iso(monday)).lte('schedule_date', iso(sunday)).order('schedule_date'),
    loadPermitGraph(admin, company_id),
    loadHashEnteredAt(admin, company_id),
  ])
  const permitAlerts = computeAlerts(permitGraph, { hashEnteredAt })
  const topAlert = permitAlerts.find(a => a.key === 'unknown-window')
  const otherAlerts = permitAlerts.filter(a => a.key !== 'unknown-window')

  const allJobs = jobs ?? []
  const neededMaterials = (materialRows ?? []).filter(m => m.status === 'needed' || m.status === 'ordered')
  const tallies = tallyMaterials((materialRows ?? []).map(m => ({ job_id: m.job_id, status: m.status })))
  const focusJobs: FocusJob[] = allJobs.map(j => ({
    id: j.id, site_number: j.site_number, job_number: (j as any).job_number, work_order_number: (j as any).work_order_number,
    stage: j.stage, status_detail: (j as any).status_detail, scope_of_work: (j as any).scope_of_work, gas_brand: (j as any).gas_brand,
    priority: j.priority, date_received: (j as any).date_received, project_start_date: j.project_start_date, updated_at: (j as any).updated_at,
    customer_name: (j as any).con_customers?.name ?? null,
  }))
  const slips: PackingSlip[] = (slipRows ?? [])
    .filter(r => !/^\s*\[test\]/i.test(r.subject ?? ''))
    .map(r => {
      const replies = ((r.thread_replies ?? []) as { text?: string }[]).map(x => x.text ?? '').filter(Boolean)
      return { id: r.id, subject: r.subject ?? '', received_at: r.received_at, vendor: r.vendor, status: r.status, note: r.note, replies,
        stock: /\bstock\b/i.test(`${r.subject ?? ''} ${r.body_preview ?? ''} ${r.note ?? ''} ${replies.join(' ')}`),
        site_key: packingSlipSiteKey(r.subject ?? '', r.body_preview, replies) }
    })
  // still nagging only while nobody has placed it: no site, not stock, still 'new', and no note saying where it went
  const unmatchedSlips = slips.filter(sl => !sl.site_key && !sl.stock && sl.status === 'new' && !sl.note).length
  const focus = buildFocusTiles(focusJobs, tallies, slips, todayIso)
  const notifyDue = allJobs
    .map(j => ({ job: j, n: projectNotificationStatus(j) }))
    .filter(x => x.n.isDue)
    .sort((a, b) => (a.n.daysToDeadline ?? 0) - (b.n.daysToDeadline ?? 0))
  const stageCounts = CON_STAGES.map(s => ({ ...s, count: s.value === 'complete' ? (completeCount ?? 0) : allJobs.filter(j => j.stage === s.value).length }))

  // Invoiced means done — accounting takes it from there. No A/R, nothing
  // overdue. What's useful here is how much has been invoiced this year and
  // what is still sitting unbilled.
  const thisYear = String(new Date().getFullYear())
  const invoiced = (invoices ?? []).filter(i => i.status !== 'draft')
  const invoicedThisYear = invoiced
    .filter(i => String(i.invoice_date ?? '').startsWith(thisYear))
    .reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)

  const [{ count: docReviewCount }, { count: ticketDraftCount }] = await Promise.all([
    admin.from('con_documents').select('id', { count: 'exact', head: true })
      .eq('company_id', company_id).eq('review_status', 'needs_review'),
    admin.from('con_daily_updates').select('id', { count: 'exact', head: true })
      .eq('company_id', company_id).eq('review_status', 'needs_review'),
  ])
  const reviewCount = (docReviewCount ?? 0) + (ticketDraftCount ?? 0)

  const tiles = [
    { href: '/construction/jobs', label: 'Jobs', icon: HardHat, value: allJobs.length },
    { href: '/construction/permits', label: 'Permits', icon: FileCheck2, value: permitGraph.enriched.filter(p => p.requirement_status === 'Required').length, sub: 'tracked' },
    { href: '/billing/quotes', label: 'Quotes', icon: FileText },
    { href: '/billing/invoices', label: 'Invoices', icon: Receipt, value: money(invoicedThisYear), sub: `invoiced ${thisYear}` },
    { href: '/construction/materials', label: 'Materials', icon: Package, value: neededMaterials?.length ?? 0, sub: 'to order/receive' },
    { href: '/construction/vendors', label: 'Vendors', icon: Truck },
    { href: '/construction/schedule', label: 'Schedule', icon: CalendarDays },
    { href: '/construction/surveys', label: 'Field Surveys', icon: ClipboardList },
    { href: '/construction/surveys/tests', label: 'Sump / Spill Tests', icon: ListChecks },
    { href: '/construction/customers', label: 'Customers', icon: Users },
    { href: '/construction/contacts', label: 'Contacts', icon: Contact },
    { href: '/construction/documents/review', label: 'Doc Review', icon: Inbox, value: reviewCount ?? 0, sub: 'to review' },
    { href: '/construction/reports', label: 'Reports', icon: BarChart3 },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto overflow-x-hidden">
      <div className="mb-6">
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
          Construction
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Job pipeline, quotes, invoices & scheduling</p>
      </div>

      {/* Focus tiles — the five lists the department is run from (workbook legend colors) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-6 min-w-0">
        {FOCUS_TILES.map(t => {
          const list = focus[t.key]
          return (
            <section key={t.key} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-w-0">
              <div className={`px-3 py-2 flex items-start justify-between gap-2 ${t.band}`}>
                <div className="min-w-0">
                  <h2 className="font-bold text-sm leading-tight break-words">{t.title}</h2>
                  <p className="text-[11px] opacity-80 mt-0.5 leading-snug break-words">{t.blurb}</p>
                </div>
                <span className="text-2xl font-bold tabular-nums leading-none shrink-0">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-400">Nothing here right now.</p>
              ) : (
                <ul className="divide-y divide-gray-50 flex-1 min-w-0">
                  {list.slice(0, 6).map(j => {
                    const idle = daysSince(j.updated_at, today)
                    return (
                      <li key={j.id} className="min-w-0">
                        <Link href={`/construction/jobs/${j.id}`} className="block px-3 py-2 hover:bg-gray-50 min-w-0">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="font-semibold text-gray-900 text-sm truncate min-w-0">{j.site_number ?? '—'}{j.gas_brand ? <span className="ml-1.5 text-[11px] font-normal text-gray-400">{j.gas_brand}</span> : null}</span>
                            {idle != null && <span className={`shrink-0 text-[11px] tabular-nums ${idle >= 14 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{idle}d</span>}
                          </div>
                          {j.scope_of_work && <p className="text-xs text-gray-600 truncate">{j.scope_of_work}</p>}
                          <div className="flex items-center gap-2 mt-0.5 min-w-0">
                            <span className="shrink-0 whitespace-nowrap"><StageBadge stage={j.stage} /></span>
                            <p className={`text-[11px] truncate min-w-0 ${j.signal ? 'text-emerald-700 font-medium' : 'text-gray-400'}`}>{j.signal ?? [j.work_order_number, j.status_detail].filter(Boolean).join(' · ')}</p>
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
              {t.key === 'parts_in' && unmatchedSlips > 0 && (
                <Link href="/inventory/receive/queue" className="px-3 py-1.5 text-[11px] text-amber-700 border-t border-gray-100 hover:bg-amber-50">
                  {unmatchedSlips} packing slip{unmatchedSlips === 1 ? '' : 's'} with no site number in the subject →
                </Link>
              )}
              <Link href={`/construction/jobs?view=table&stage=${t.linkStage}`} className="px-3 py-1.5 text-[11px] font-medium text-blue-600 hover:text-blue-800 border-t border-gray-100">
                {list.length > 6 ? `View all ${list.length} →` : 'Open the list →'}
              </Link>
            </section>
          )
        })}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {tiles.map(t => (
          <Link key={t.href} href={t.href} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow transition-all">
            <t.icon className="w-5 h-5 text-blue-600 mb-2" />
            <p className="text-sm font-semibold text-gray-900 break-words leading-tight">{t.label}</p>
            {t.value != null && <p className="text-xs text-gray-500 mt-0.5">{t.value}{t.sub ? ` ${t.sub}` : ''}</p>}
          </Link>
        ))}
      </div>

      {/* Permit alert #1 — impossible to ignore */}
      {topAlert && topAlert.count > 0 && (
        <Link href="/construction/permits?alert=unknown-window" className="block mb-4 rounded-2xl border-2 border-red-400 bg-red-50 shadow-sm hover:bg-red-100 transition-colors">
          <div className="px-5 py-4 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-bold text-red-900">{topAlert.count} permit{topAlert.count !== 1 ? 's' : ''} may be needed and nobody has confirmed it</p>
              <p className="text-sm text-red-800 mt-0.5">{topAlert.description}</p>
              <p className="text-xs text-red-700 mt-1 font-semibold">Review now →</p>
            </div>
          </div>
        </Link>
      )}

      {/* The other four permit alerts, as counts that click through */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {otherAlerts.map(a => (
          <Link key={a.key} href={`/construction/permits?alert=${a.key}`}
            className={`rounded-2xl border shadow-sm p-4 transition-all ${a.count > 0 ? 'bg-white border-amber-300 hover:border-amber-400' : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`}>
            <p className={`text-2xl font-bold ${a.count > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{a.count}</p>
            <p className="text-xs font-semibold text-gray-700 mt-0.5 leading-tight">{a.label}</p>
          </Link>
        ))}
      </div>

      {/* Project notifications due */}
      {notifyDue.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-300 shadow-sm overflow-hidden mb-6">
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
            <h2 className="font-semibold text-amber-900 text-sm">⚠ Project Notifications to send</h2>
            <span className="text-xs font-semibold text-amber-800">{notifyDue.length}</span>
          </div>
          <ul className="divide-y divide-gray-50">
            {notifyDue.map(({ job, n }) => (
              <li key={job.id}>
                <Link href={`/construction/jobs/${job.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-gray-50">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">{job.site_number ?? '—'}</span>
                    {(job as any).con_customers?.name && <span className="text-xs text-gray-400 ml-2">{(job as any).con_customers.name}</span>}
                    <div className="text-xs text-gray-400">Starts {fmtDate(job.project_start_date)} · send by {fmtDate(n.deadline)}</div>
                  </div>
                  <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${n.className}`}>{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pipeline counts */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">
        <h2 className="font-semibold text-gray-900 mb-3">Pipeline by Stage</h2>
        <div className="flex flex-wrap gap-2">
          {stageCounts.map(s => (
            <Link key={s.value} href={`/construction/jobs?view=table&stage=${s.value}`}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${s.className} hover:opacity-80`}>
              {s.label}<span className="bg-white/60 rounded-full px-1.5">{s.count}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* This week's schedule */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">This Week&apos;s Schedule</h2>
          <Link href="/construction/schedule" className="text-xs font-medium text-blue-600 hover:text-blue-800">Open schedule →</Link>
        </div>
        {!schedule?.length ? <Empty>Nothing scheduled this week.</Empty> : (
          <ul className="divide-y divide-gray-50">
            {schedule.map(e => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-16 text-xs text-gray-500">{fmtDate(e.schedule_date)}</span>
                <span className="flex-1 text-gray-900">{e.site_number ?? e.task_description ?? '—'}</span>
                {e.crew?.length ? <span className="text-xs text-gray-500">{e.crew.join(', ')}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-gray-400">{children}</p>
}
