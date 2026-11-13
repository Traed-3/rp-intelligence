import Link from 'next/link'
import { ScrollText, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ClickableRow } from '@/components/clickable-row'
import { LOG_VIEWS, type LogView, type TicketPart, safeSearch, ticketSite, fmtDay, hoursLabel } from '@/lib/ticket-log'

const PAGE_SIZE = 50
const inp = 'rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'

type Row = {
  id: string; subject: string | null; sender: string | null; received_at: string | null; work_date: string | null
  extract_status: string; extract_version: number; status: string
  ticket_site: string | null; ticket_wo_number: string | null; technician: string | null; helper: string | null
  onsite_hours: number | null; crew_size: number | null; completion: string | null
  parts: TicketPart[] | null; front_text: string | null; transcript: string | null; duplicate_of: string | null
  work_order_id: string | null; con_job_id: string | null
  svc_work_orders: { site_number: string | null; portal_wo_number: string | null } | null
  con_jobs: { site_number: string | null; job_number: string | null } | null
}

export default async function TicketLogPage({ searchParams }: {
  searchParams: Promise<{ q?: string; view?: string; from?: string; to?: string; page?: string }>
}) {
  const sp = await searchParams
  const q = safeSearch(sp.q)
  const view = (LOG_VIEWS.some(v => v.value === sp.view) ? sp.view : 'all') as LogView
  const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '')
  const from = day(sp.from), to = day(sp.to)
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()
  const companyId = profile!.company_id

  let query = admin.from('svc_work_order_documents')
    .select('id, subject, sender, received_at, work_date, extract_status, extract_version, status, ticket_site, ticket_wo_number, technician, helper, onsite_hours, crew_size, completion, parts, front_text, transcript, duplicate_of, work_order_id, con_job_id, svc_work_orders(site_number, portal_wo_number), con_jobs(site_number, job_number)', { count: 'exact' })
    .eq('company_id', companyId)
  if (view === 'copies') query = query.not('duplicate_of', 'is', null)
  else query = query.is('duplicate_of', null)
  if (view === 'parts') query = query.neq('parts', '[]')
  if (view === 'rtn') query = query.eq('completion', 'rtn')
  if (view === 'unlinked') query = query.is('work_order_id', null).is('con_job_id', null)
  if (view === 'untyped') query = query.neq('extract_status', 'done')
  if (from) query = query.gte('received_at', `${from}T00:00:00-05:00`)
  if (to) query = query.lte('received_at', `${to}T23:59:59-05:00`)
  if (q) {
    const like = `%${q}%`
    query = query.or(['subject', 'transcript', 'ticket_site', 'ticket_wo_number', 'technician', 'helper', 'sender'].map(c => `${c}.ilike.${like}`).join(','))
  }
  const { data, count, error } = await query
    .order('received_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  const rows = (data ?? []) as unknown as Row[]
  const total = count ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // The strip of totals across the whole log (copies left out), not just this page.
  const head = (f: (b: any) => any) => f(admin.from('svc_work_order_documents').select('id', { count: 'exact', head: true }).eq('company_id', companyId).is('duplicate_of', null))
  const [all, typed, withParts, rtn] = await Promise.all([
    head(b => b), head(b => b.eq('extract_status', 'done')), head(b => b.neq('parts', '[]')), head(b => b.eq('completion', 'rtn')),
  ])

  const href = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    const merged = { q, view, from, to, page: 1, ...over }
    for (const [k, v] of Object.entries(merged)) if (v !== '' && v != null && !(k === 'view' && v === 'all') && !(k === 'page' && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return `/service/tickets/log${s ? `?${s}` : ''}`
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-5">
        <Link href="/service" className="text-sm text-gray-500 hover:text-gray-700">← Service Dispatch</Link>
        <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mt-1 before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">
          <ScrollText className="w-6 h-6 text-blue-600" />All Tickets
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Every ticket emailed in, typed out: the front, and the parts on the back. Search by store, work order, tech, part number or any word on the ticket.
          {' '}<Link href="/service/tickets/inbox" className="text-blue-600 hover:text-blue-800">Review queue →</Link>
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Tickets on file', n: all.count ?? 0 },
          { label: 'Typed out', n: typed.count ?? 0 },
          { label: 'With parts listed', n: withParts.count ?? 0 },
          { label: 'Return needed', n: rtn.count ?? 0 },
        ].map(s => (
          <div key={s.label} className="rp-card px-4 py-3">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className="text-2xl font-semibold text-gray-900 tabular-nums">{s.n.toLocaleString('en-US')}</p>
          </div>
        ))}
      </div>

      <form action="/service/tickets/log" className="flex flex-wrap items-end gap-2 mb-3">
        {view !== 'all' && <input type="hidden" name="view" value={view} />}
        <div className="flex-1 min-w-[14rem]">
          <label htmlFor="q" className="block text-xs font-medium text-gray-500 mb-1">Search</label>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input id="q" name="q" defaultValue={q} placeholder="33244, WOT1907296, shear valve, GRD-OPW10P…" className={`${inp} w-full pl-9`} />
          </div>
        </div>
        <div>
          <label htmlFor="from" className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input id="from" type="date" name="from" defaultValue={from} className={inp} />
        </div>
        <div>
          <label htmlFor="to" className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input id="to" type="date" name="to" defaultValue={to} className={inp} />
        </div>
        <button type="submit" className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">Search</button>
        {(q || from || to) && <Link href={href({ q: '', from: '', to: '' })} className="text-sm text-gray-500 hover:text-gray-700 py-2">Clear</Link>}
      </form>

      <div className="flex gap-1.5 flex-wrap mb-4">
        {LOG_VIEWS.map(v => (
          <Link key={v.value} href={href({ view: v.value })}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${view === v.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {v.label}
          </Link>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">Could not load the tickets: {error.message}</div>}

      {rows.length === 0 ? (
        <div className="rp-card p-12 text-center"><p className="text-gray-400 text-sm">No tickets match.</p></div>
      ) : (
        <div className="rp-card overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Site</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Tech</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Hours</th>
                <th className="text-left px-4 py-3">What the ticket says</th>
                <th className="text-left px-4 py-3 hidden lg:table-cell">Parts</th>
                <th className="text-left px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(d => {
                const wo = d.svc_work_orders, job = d.con_jobs
                const parts = Array.isArray(d.parts) ? d.parts : []
                const text = (d.front_text || d.transcript || '').replace(/\s+/g, ' ').trim()
                const woNo = wo?.portal_wo_number || d.ticket_wo_number || (job?.job_number ? `Job ${job.job_number}` : null)
                return (
                  <ClickableRow key={d.id} href={`/service/tickets/inbox/${d.id}?from=log`}>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700 align-top">
                      {fmtDay(d.work_date ?? d.received_at)}
                      {!d.work_date && <div className="text-[11px] text-gray-400">emailed</div>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="font-medium text-gray-900">{ticketSite(d, wo, job)}</span>
                      {woNo && <div className="text-xs text-gray-400 font-mono">{woNo}</div>}
                      {!d.work_order_id && !d.con_job_id && <div className="text-[11px] text-amber-600 font-medium">Not tied to a call</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs hidden md:table-cell align-top">
                      {d.technician || d.sender || '—'}{d.helper && <div className="text-gray-400">+ {d.helper}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums whitespace-nowrap hidden sm:table-cell align-top">{hoursLabel(d.onsite_hours, d.crew_size)}</td>
                    <td className="px-4 py-3 text-gray-700 align-top max-w-md">
                      {d.extract_status === 'done'
                        ? <p className="line-clamp-2">{text || <span className="text-gray-400">Nothing readable on it.</span>}</p>
                        : <p className="text-gray-400 text-xs">{d.extract_status === 'pending' ? 'Being typed out…' : 'Not typed out yet — open it to read the scan.'}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 hidden lg:table-cell align-top max-w-[16rem]">
                      {parts.length === 0 ? <span className="text-gray-300">—</span> : (
                        <>
                          <p className="line-clamp-2">{parts.slice(0, 3).map(p => `${p.qty != null ? `${p.qty} × ` : ''}${p.description || p.part_number}`).join('; ')}</p>
                          {parts.length > 3 && <p className="text-gray-400">+ {parts.length - 3} more</p>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap align-top">
                      {d.completion === 'rtn' && <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 mr-2">RTN</span>}
                      {d.completion === 'complete' && <span className="text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200 mr-2">Complete</span>}
                      <span className="text-xs font-medium text-blue-600">View →</span>
                    </td>
                  </ClickableRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
        <p>{total.toLocaleString('en-US')} ticket{total === 1 ? '' : 's'}{total > PAGE_SIZE ? ` · page ${page} of ${pages}` : ''}</p>
        <div className="flex gap-2">
          {page > 1 && <Link href={href({ page: page - 1 })} className="px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 text-gray-700">← Newer</Link>}
          {page < pages && <Link href={href({ page: page + 1 })} className="px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 text-gray-700">Older →</Link>}
        </div>
      </div>
    </div>
  )
}
