import Link from 'next/link'
import { LayoutGrid, List, Search } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { WorkOrderArchiveTable } from '@/components/svc/work-order-archive-table'
import { WorkOrderBoard } from '@/components/svc/work-order-board'
import { loadConstructionLinks } from '@/lib/svc-construction-link'
import { isTicketSender } from '@/lib/svc-work-order-parser'

// 'new' / 'accepted' / 'en_route' are retired (everything is auto-accepted under
// contract); 'new' stays in the query only so a straggler row is still counted.
const OPEN_STATUSES = ['dispatched', 'new', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']
const BOARD_STATUSES = ['dispatched', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

const STATUS_FILTERS = [
  { value: '',           label: 'All Open' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',  label: 'Completed' },
]

const CLIENT_FILTERS = [
  { value: '',                label: 'All Clients' },
  { value: '7help',           label: '7-Eleven' },
  { value: 'wtsc',            label: 'Wawa' },
  { value: 'it_service_desk', label: 'Sunoco' },
]

// Rank 1 = most urgent .. 4 = routine (matches PriorityBadge's PRIORITY_CLASS).
const PRIORITY_FILTERS = [
  { rank: 1, label: 'P1 · Critical',  activeClass: 'bg-red-600 text-white border-red-600',       idleClass: 'bg-white text-red-700 border-red-200 hover:border-red-400' },
  { rank: 2, label: 'P2 · Emergency', activeClass: 'bg-orange-600 text-white border-orange-600', idleClass: 'bg-white text-orange-700 border-orange-200 hover:border-orange-400' },
  { rank: 3, label: 'P3 · Rush',      activeClass: 'bg-amber-600 text-white border-amber-600',   idleClass: 'bg-white text-amber-700 border-amber-200 hover:border-amber-400' },
  { rank: 4, label: 'P4 · Routine',   activeClass: 'bg-blue-600 text-white border-blue-600',     idleClass: 'bg-white text-blue-700 border-blue-200 hover:border-blue-400' },
]

export default async function ServiceDispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; client?: string; view?: string; priority?: string; rtn?: string; layout?: string; q?: string }>
}) {
  const { status = '', client = '', view = '', priority = '', rtn = '', layout = '', q = '' } = await searchParams
  // Search text goes into a PostgREST filter string, so drop the characters that would break it.
  const term = q.replace(/[,()"'\\%*:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  const searching = term.length > 0
  const priorityRank = priority ? parseInt(priority, 10) : null
  const rtnOnly = rtn === '1'
  const staleOnly = view === 'stale'
  const oldOnly = view === 'old'
  const showArchived = view === 'archived'
  const constructionOnly = view === 'construction'
  // Tiles by status are the default — bulk-select tools (archive/unarchive) only
  // make sense in the table, so Old/Archived force it regardless of the toggle.
  const boardView = layout !== 'list' && !showArchived && !oldOnly && !searching
  const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id').eq('id', user!.id).single()
  const companyId = profile!.company_id

  // Calls handed to construction: WO# → the con_jobs row carrying it (and how far along it is).
  const links = await loadConstructionLinks(admin, companyId)
  const linkedWos = Array.from(links.keys())

  // Summary counts — the supervisor view: what's overdue, what needs a return trip,
  // what's unbilled. These drive the cards above the table.
  const [{ count: openCount }, { count: rtnCount }, { count: rejectedCount }, { data: staleCandidates }, { count: needsReviewCount }] = await Promise.all([
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('archived', false).in('status', OPEN_STATUSES),
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('archived', false).eq('return_trip_needed', true).not('status', 'in', '(completed,invoiced,paid)'),
    admin.from('svc_work_orders').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('archived', false).eq('invoice_rejected', true),
    admin.from('svc_work_orders').select('id, last_update_at').eq('company_id', companyId).eq('archived', false).in('status', OPEN_STATUSES).not('last_update_at', 'is', null),
    admin.from('svc_work_order_documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'needs_review'),
  ])
  // Tickets from an RPS address that is not on the service roster can't credit a tech — show who, so
  // someone adds them (audit 2026-11-05: Donald Sutphin's calls sat unassigned).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: recentSenders }, { data: rosterEmails }] = await Promise.all([
    admin.from('svc_gmail_imports').select('sender').eq('company_id', companyId).eq('mailbox', 'rpinvoicing').gte('received_at', thirtyDaysAgo).limit(5000),
    admin.from('svc_technicians').select('personal_email').eq('company_id', companyId),
  ])
  const roster = new Set((rosterEmails ?? []).map(t => (t.personal_email ?? '').toLowerCase()).filter(Boolean))
  const unknownSenderCounts = new Map<string, number>()
  for (const r of recentSenders ?? []) {
    const e = (r.sender ?? '').toLowerCase()
    if (!e || roster.has(e) || !isTicketSender(e) || !/\.rp@gmail\.com$/.test(e)) continue
    unknownSenderCounts.set(e, (unknownSenderCounts.get(e) ?? 0) + 1)
  }
  // Construction crews, managers and office mailboxes send tickets too — only flag addresses the company directory
  // lists as service staff (Sutphin's case) or doesn't know at all.
  const { data: directory } = unknownSenderCounts.size
    ? await admin.from('con_contacts').select('email, title').eq('company_id', companyId)
        .or(Array.from(unknownSenderCounts.keys()).map(e => `email.ilike.${e}`).join(','))
    : { data: [] as { email: string | null; title: string | null }[] }
  const nonService = new Set((directory ?? []).filter(c => !/service/i.test(c.title ?? '')).map(c => (c.email ?? '').toLowerCase()))
  const unknownSenders = Array.from(unknownSenderCounts.entries()).filter(([e]) => !nonService.has(e)).sort((a, b) => b[1] - a[1])

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const staleCount = (staleCandidates ?? []).filter(w => new Date(w.last_update_at as string).getTime() < sevenDaysAgo).length

  const WO_COLUMNS = `
      id, source_portal, client_name, portal_wo_number, site_number, site_name,
      priority_raw, priority_rank, status, last_update_at, dispatched_at,
      return_trip_needed, invoice_rejected, archived, archived_at, archived_reason,
      svc_technicians(full_name)
    `
  let query = admin
    .from('svc_work_orders')
    .select(WO_COLUMNS)
    .eq('company_id', companyId)
    .limit(200)

  if (showArchived) {
    query = query.eq('archived', true).order('archived_at', { ascending: false })
  } else {
    query = query.eq('archived', false)
    if (constructionOnly) {
      query = query.in('status', OPEN_STATUSES).in('portal_wo_number', linkedWos.length ? linkedWos : ['—'])
    } else if (staleOnly) {
      query = query.in('status', OPEN_STATUSES).lt('last_update_at', new Date(sevenDaysAgo).toISOString())
    } else if (oldOnly) {
      // Any status — the point is to surface everything old enough to be
      // clutter (including long-stuck "new" rows) so it can be bulk-archived.
      query = query.lt('dispatched_at', new Date(sixtyDaysAgo).toISOString())
    } else if (status && !boardView) {
      query = query.eq('status', status)
    } else {
      query = query.in('status', OPEN_STATUSES)
    }
    query = query.order(oldOnly ? 'dispatched_at' : 'last_update_at', { ascending: true })
    // Quick filters — combine on top of whatever status view is active.
    if (priorityRank) query = query.eq('priority_rank', priorityRank)
    if (rtnOnly) query = query.eq('return_trip_needed', true).not('status', 'in', '(completed,invoiced,paid)')
  }
  if (client) query = query.eq('source_portal', client)

  let rawWorkOrders
  let searchTotal: number | null = null
  if (searching) {
    // Search looks at everything — open, completed and archived — by WO#, incident, site number/name/address/city,
    // technician name and construction job number. Typing "SU 5015" still finds "SU-5015".
    const like = `%${term.replace(/[\s\-_.#/]+/g, '%')}%`
    const lower = term.toLowerCase()
    const { data: techs } = await admin.from('svc_technicians').select('id').eq('company_id', companyId).ilike('full_name', like)
    const techIds = (techs ?? []).map(t => t.id)
    const conWos = Array.from(links.entries())
      .filter(([, l]) => (l.jobNumber ?? '').toLowerCase().includes(lower) || (l.siteNumber ?? '').toLowerCase().includes(lower))
      .map(([wo]) => wo)
    const ors = ['portal_wo_number', 'incident_number', 'site_number', 'site_name', 'site_address', 'site_city', 'subject_raw'].map(c => `${c}.ilike.${like}`)
    if (techIds.length) ors.push(`assigned_technician_id.in.(${techIds.join(',')})`)
    if (conWos.length) ors.push(`portal_wo_number.in.(${conWos.join(',')})`)
    let sq = admin.from('svc_work_orders').select(WO_COLUMNS, { count: 'exact' })
      .eq('company_id', companyId).or(ors.join(',')).order('dispatched_at', { ascending: false }).limit(200)
    if (client) sq = sq.eq('source_portal', client)
    const res = await sq
    rawWorkOrders = res.data
    searchTotal = res.count
  } else {
    rawWorkOrders = (await query).data
  }
  const workOrders = (rawWorkOrders ?? []).map(w => {
    const l = w.portal_wo_number ? links.get(w.portal_wo_number) : undefined
    return { ...w, construction: l ? { jobId: l.jobId, jobNumber: l.jobNumber, stage: l.stage } : null }
  })

  // How many open calls have been handed to construction (drives the filter pill).
  const { data: openLinked } = linkedWos.length
    ? await admin.from('svc_work_orders').select('id').eq('company_id', companyId).eq('archived', false).in('status', OPEN_STATUSES).in('portal_wo_number', linkedWos)
    : { data: [] as { id: string }[] }
  const constructionCount = openLinked?.length ?? 0

  // Every quick/status/client pill below is built from the same current selection,
  // so clicking one preserves whatever else is already active (e.g. P1 + Wawa + RTN).
  // `view` is single-select: '' | 'stale' | 'old' | 'archived' | 'construction'.
  function buildHref(overrides: { status?: string; client?: string; priority?: string | null; rtn?: boolean; view?: string; layout?: string; q?: string }) {
    const next = {
      q: term, status, client, priority: priorityRank ? String(priorityRank) : '',
      rtn: rtnOnly, view: showArchived ? 'archived' : staleOnly ? 'stale' : oldOnly ? 'old' : constructionOnly ? 'construction' : '',
      layout,
      ...overrides,
    }
    const params = new URLSearchParams()
    if (next.q) params.set('q', next.q)
    if (next.status) params.set('status', next.status)
    if (next.client) params.set('client', next.client)
    if (next.priority) params.set('priority', next.priority)
    if (next.rtn) params.set('rtn', '1')
    if (next.view) params.set('view', next.view)
    if (next.layout) params.set('layout', next.layout)
    const qs = params.toString()
    return `/service${qs ? `?${qs}` : ''}`
  }
  function layoutHref(next: 'board' | 'list') {
    return buildHref({ layout: next === 'board' ? '' : 'list' })
  }

  function priorityFilterHref(rank: number) {
    return buildHref({ priority: priorityRank === rank ? null : String(rank) })
  }
  function rtnFilterHref() {
    return buildHref({ rtn: !rtnOnly })
  }
  function staleFilterHref() {
    return buildHref({ view: staleOnly ? '' : 'stale' })
  }
  function oldFilterHref() {
    return buildHref({ view: oldOnly ? '' : 'old', status: '' })
  }
  function constructionFilterHref() {
    return buildHref({ view: constructionOnly ? '' : 'construction', status: '' })
  }
  function archivedFilterHref() {
    return buildHref({ view: showArchived ? '' : 'archived', status: '', rtn: false, priority: null })
  }
  function statusFilterHref(statusValue: string) {
    return buildHref({ status: statusValue, view: '' })
  }
  function clientFilterHref(clientValue: string) {
    return buildHref({ client: clientValue })
  }

  return (
    <div className={boardView ? 'p-6' : 'p-6 max-w-7xl mx-auto'}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
            Service Dispatch
          </h1>
          <Link href="/service/tickets" className="ml-3 text-sm text-blue-600 hover:text-blue-800 align-middle">Field tickets →</Link>
          <Link href="/service/tickets/inbox" className="ml-3 text-sm text-blue-600 hover:text-blue-800 align-middle">
            Completed ticket review{needsReviewCount ? <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-[11px] font-bold rounded-full bg-amber-500 text-white">{needsReviewCount}</span> : ' →'}
          </Link>
          <p className="text-sm text-gray-500 mt-0.5">
            7-Eleven, Wawa & Sunoco work orders — synced automatically from rpdispatcher and rpinvoicing; calls handed to construction follow their job
          </p>
        </div>
        {!showArchived && !oldOnly && (
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
            <Link href={layoutHref('board')} className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 ${boardView ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}><LayoutGrid className="w-3.5 h-3.5" />Tiles</Link>
            <Link href={layoutHref('list')} className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 ${!boardView ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}><List className="w-3.5 h-3.5" />List</Link>
          </div>
        )}
      </div>

      {unknownSenders.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span className="font-semibold">Tickets from people not on the service roster (last 30 days):</span>{' '}
          {unknownSenders.map(([e, n]) => `${e} (${n})`).join(', ')}.{' '}
          Their calls can&apos;t be credited to a tech until they&apos;re added to the technician list.
        </div>
      )}

      {/* Search — across every call (open, completed, archived): WO #, incident, site #, store name, address, tech, construction job. */}
      <form action="/service" method="get" className="mb-4 flex items-center gap-2">
        {client && <input type="hidden" name="client" value={client} />}
        {layout && <input type="hidden" name="layout" value={layout} />}
        <div className="relative flex-1 max-w-2xl">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            name="q"
            defaultValue={term}
            autoComplete="off"
            placeholder="Search WO #, site #, incident, store name, address, tech, construction job…"
            className="w-full text-sm border border-gray-300 rounded-lg pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button type="submit" className="text-sm font-medium bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700">Search</button>
        {searching && <Link href={buildHref({ q: '' })} className="text-sm text-gray-500 hover:text-gray-800 px-2">Clear</Link>}
      </form>

      {/* Quick filters — the things a supervisor needs to jump to first thing.
          Independent toggles: combine freely with each other and with the status/client
          pills below (e.g. P1 + Wawa + RTN all at once). Priority is single-select
          (a work order only has one priority); RTN and Updates Needed toggle on their own.
          None of these apply in the Archived view, so they're hidden there. */}
      {!showArchived && !searching && (
        <div className="flex gap-1.5 flex-wrap mb-4">
          {PRIORITY_FILTERS.map((f) => (
            <Link
              key={f.rank}
              href={priorityFilterHref(f.rank)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
                priorityRank === f.rank ? f.activeClass : f.idleClass
              }`}
            >
              {f.label}
            </Link>
          ))}
          <Link
            href={rtnFilterHref()}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              rtnOnly
                ? 'bg-red-800 text-white border-red-800'
                : 'bg-white text-red-700 border-red-200 hover:border-red-400'
            }`}
          >
            ⟲ RTN — Return Trip Needed
          </Link>
          <Link
            href={staleFilterHref()}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              staleOnly
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-500'
            }`}
          >
            ⏰ Updates Needed (7+ Days)
          </Link>
          <Link
            href={oldFilterHref()}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              oldOnly
                ? 'bg-slate-700 text-white border-slate-700'
                : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
            }`}
          >
            📦 60+ Days Old
          </Link>
          <Link
            href={constructionFilterHref()}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-full border transition-colors ${
              constructionOnly
                ? 'bg-amber-700 text-white border-amber-700'
                : 'bg-white text-amber-800 border-amber-300 hover:border-amber-500'
            }`}
          >
            🏗 In Construction ({constructionCount})
          </Link>
        </div>
      )}

      {/* Supervisor summary cards */}
      {!searching && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Link href="/service" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 transition-colors">
          <p className="text-2xl font-bold text-gray-900">{openCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Open Work Orders</p>
        </Link>
        <Link href="/service?view=stale" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-red-300 transition-colors">
          <p className={`text-2xl font-bold ${staleCount ? 'text-red-600' : 'text-gray-900'}`}>{staleCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">No Update in 7+ Days</p>
        </Link>
        <Link href="/service?rtn=1" className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-red-300 transition-colors">
          <p className={`text-2xl font-bold ${rtnCount ? 'text-red-600' : 'text-gray-900'}`}>{rtnCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Return Trip Needed</p>
        </Link>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <p className={`text-2xl font-bold ${rejectedCount ? 'text-amber-600' : 'text-gray-900'}`}>{rejectedCount ?? 0}</p>
          <p className="text-xs text-gray-500 mt-0.5">Invoice Rejected</p>
        </div>
      </div>}

      {/* Status filter pills — the board already sorts by status via its columns */}
      {!showArchived && !boardView && !searching && (
        <div className="flex gap-1.5 flex-wrap mb-3">
          {STATUS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={statusFilterHref(f.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                status === f.value && !staleOnly && !oldOnly
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      )}

      {/* Client filter pills + Archived toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div className="flex gap-1.5 flex-wrap">
          {CLIENT_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={clientFilterHref(f.value)}
              className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                client === f.value
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <Link
          href={archivedFilterHref()}
          className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
            showArchived
              ? 'bg-gray-800 text-white border-gray-800'
              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
          }`}
        >
          🗄 {showArchived ? 'Back to Active' : 'Archived'}
        </Link>
      </div>

      {showArchived && (
        <p className="text-xs text-gray-500 mb-3">
          Archived work orders — hidden from the active dashboard. Click ↩ to bring one back.
        </p>
      )}

      {searching && (
        <p className="text-sm text-gray-600 mb-3">
          {(searchTotal ?? workOrders.length) === 0
            ? <>No work orders match &ldquo;{term}&rdquo;. Try part of the number, or a store name.</>
            : <><b>{searchTotal ?? workOrders.length}</b> result{(searchTotal ?? workOrders.length) === 1 ? '' : 's'} for &ldquo;{term}&rdquo; — open, completed and archived{(searchTotal ?? 0) > workOrders.length ? ` (showing the newest ${workOrders.length})` : ''}.</>}
        </p>
      )}

      {constructionOnly && (
        <p className="text-xs text-gray-500 mb-3">
          Open calls that have been handed to a construction job. When the job reaches close-out, invoicing or complete the call is marked completed automatically.
        </p>
      )}

      {oldOnly && (
        <p className="text-xs text-gray-500 mb-3">
          Dispatched more than 60 days ago, any status — check the box next to &quot;WO #&quot; to select all, then Archive Selected.
        </p>
      )}

      {boardView ? (
        <WorkOrderBoard workOrders={workOrders} statuses={BOARD_STATUSES} />
      ) : (
        <WorkOrderArchiveTable workOrders={workOrders} showArchived={showArchived} mixed={searching} />
      )}
    </div>
  )
}
