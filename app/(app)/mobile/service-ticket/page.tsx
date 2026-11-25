import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canWriteServiceTickets, ticketStatusMeta, completionLabel, BRANDS } from '@/lib/service-tickets'
import { createServiceTicket } from '@/app/(app)/service/tickets/actions'
import { canPostDailyUpdate } from '@/lib/construction'
import { Wrench, Search } from 'lucide-react'
import { TitleIcon } from '@/components/ui/title-icon'

const OPEN_WO = ['dispatched', 'new', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

export default async function MobileServiceTicketsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const term = ((await searchParams).q ?? '').trim().slice(0, 60)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user!.id).single()
  const canWrite = canWriteServiceTickets(profile?.role)
  const company_id = profile!.company_id
  // Service tickets are the service department's (one ticket per call). Everyone else is pointed to their own screen.
  if (!canWrite) return (
    <div className="min-h-screen p-5">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="rp-title"><TitleIcon icon={Wrench} tone="info" />Service Tickets</h1>
          <Link href="/mobile" className="text-sm text-blue-600">← Home</Link>
        </div>
        <div className="rp-card p-5 text-sm text-gray-600 space-y-3">
          <p>Service tickets are for the service department: one ticket for each service call.</p>
          {canPostDailyUpdate({ id: profile?.id, role: profile?.role }) && <p>On a construction job, send your ticket with a Daily Update. Each day&apos;s ticket goes on the job.</p>}
          {canPostDailyUpdate({ id: profile?.id, role: profile?.role }) && <Link href="/mobile/daily-update" className="block text-center rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5">Daily Update</Link>}
        </div>
      </div>
    </div>
  )

  const { data: tech } = await admin.from('svc_technicians').select('id').eq('company_id', company_id).eq('profile_id', profile!.id).maybeSingle()

  const WO_COLS = 'id, portal_wo_number, client_name, site_number, site_address, site_city, priority_raw, status, assigned_technician_id'
  const openWos = () => admin.from('svc_work_orders').select(WO_COLS).eq('company_id', company_id).eq('archived', false).in('status', OPEN_WO)
  const mineFilter = `created_by.eq.${profile!.id}${tech ? `,technician_id.eq.${tech.id}` : ''}`
  const since = new Date(Date.now() - 14 * 86400000).toISOString()
  // Search: every word has to be somewhere in the call (WO number, store, street, city, customer). Letters, digits and - only.
  const words = term.split(/\s+/).map(w => w.replace(/[^a-zA-Z0-9-]/g, '')).filter(w => w.length >= 2).slice(0, 4)
  let found = openWos()
  for (const w of words) found = found.or(['portal_wo_number', 'incident_number', 'site_number', 'site_name', 'site_address', 'site_city', 'client_name'].map(c => `${c}.ilike.%${w}%`).join(','))

  const [{ data: mine }, { data: turnedIn }, { data: assigned }, { data: hits }] = await Promise.all([
    admin.from('service_tickets').select('id, ticket_number, status, brand, store_number, csr_number, updated_at')
      .eq('company_id', company_id).not('status', 'in', '(invoiced,void)').is('finished_at', null).or(mineFilter)
      .order('updated_at', { ascending: false }).limit(20),
    admin.from('service_tickets').select('id, ticket_number, status, brand, store_number, csr_number, completion, finished_at')
      .eq('company_id', company_id).gte('finished_at', since).or(mineFilter)
      .order('finished_at', { ascending: false }).limit(15),
    tech ? openWos().eq('assigned_technician_id', tech.id).order('priority_rank').order('dispatched_at', { ascending: false }).limit(40) : Promise.resolve({ data: [] as never[] }),
    words.length ? found.order('dispatched_at', { ascending: false }).limit(25) : Promise.resolve({ data: [] as never[] }),
  ])
  const { data: started } = await admin.from('service_tickets').select('work_order_id').eq('company_id', company_id).not('work_order_id', 'is', null).not('status', 'eq', 'void')
  const startedIds = new Set((started ?? []).map(s => s.work_order_id))
  const myWos = (assigned ?? []).filter(w => !startedIds.has(w.id))
  const foundWos = (hits ?? []).filter(w => !startedIds.has(w.id))
  const alreadyStarted = (hits ?? []).length - foundWos.length

  return (
    <div className="min-h-screen p-5">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="rp-title"><TitleIcon icon={Wrench} tone="info" />Service Tickets</h1>
          <Link href="/mobile" className="text-sm text-blue-600">← Home</Link>
        </div>

        <section className="rp-card overflow-hidden">
          <h2 className="px-4 py-3 font-semibold text-gray-900 border-b border-gray-100">My open tickets</h2>
          {(mine ?? []).length === 0 ? <p className="px-4 py-4 text-sm text-gray-400">Nothing in progress.</p> : (
            <ul className="divide-y divide-gray-100">
              {(mine ?? []).map(t => { const st = ticketStatusMeta(t.status); return (
                <li key={t.id}>
                  <Link href={`/mobile/service-ticket/${t.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                    <span><div className="font-medium text-gray-900">{t.brand ?? 'Customer'}{t.store_number ? ` · ${t.store_number}` : ''}</div><div className="text-xs text-gray-500 font-mono">{t.ticket_number}{t.csr_number ? ` · ${t.csr_number}` : ''}</div></span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${st.className}`}>{st.label}</span>
                  </Link>
                </li>) })}
            </ul>
          )}
        </section>

        {canWrite && (
          <>
            <section className="rp-card p-4">
              <h2 className="font-semibold text-gray-900 mb-2">Find a call</h2>
              <form action="/mobile/service-ticket" method="get" className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input name="q" defaultValue={term} inputMode="search" autoComplete="off" placeholder="WO #, store #, street or city" className="w-full rounded-xl border border-gray-300 pl-9 pr-3 py-2.5 text-sm" />
                </div>
                <button type="submit" className="rounded-xl bg-primary text-primary-foreground text-sm font-semibold px-4">Search</button>
              </form>
              {term && foundWos.length === 0 && <p className="mt-3 text-sm text-gray-500">{alreadyStarted ? 'That call already has a ticket started. Look under My open tickets, or ask the office.' : 'No open call matches. Check the number, or start a blank ticket below.'}</p>}
            </section>

            {[{ title: `Calls matching "${term}"`, rows: foundWos }, { title: 'Dispatched to me', rows: term ? [] : myWos }].map(g => g.rows.length > 0 && (
              <section key={g.title} className="rp-card overflow-hidden">
                <h2 className="px-4 py-3 font-semibold text-gray-900 border-b border-gray-100">{g.title}</h2>
                <ul className="divide-y divide-gray-100">
                  {g.rows.map(w => (
                    <li key={w.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0"><div className="font-medium text-gray-900 truncate">{w.client_name ?? 'Customer'} · {w.site_number ?? '—'}</div><div className="text-xs text-gray-500 truncate">{[w.portal_wo_number, w.priority_raw, w.site_address, w.site_city].filter(Boolean).join(' · ')}</div></span>
                        <form action={createServiceTicket}><input type="hidden" name="work_order_id" value={w.id} /><input type="hidden" name="from" value="mobile" /><button type="submit" className="shrink-0 rounded-lg bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5">Start ticket</button></form>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {(turnedIn ?? []).length > 0 && (
              <section className="rp-card overflow-hidden">
                <h2 className="px-4 py-3 font-semibold text-gray-900 border-b border-gray-100">Turned in, last 14 days</h2>
                <ul className="divide-y divide-gray-100">
                  {(turnedIn ?? []).map(t => (
                    <li key={t.id}>
                      <Link href={`/mobile/service-ticket/${t.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                        <span><div className="font-medium text-gray-900">{t.brand ?? 'Customer'}{t.store_number ? ` · ${t.store_number}` : ''}</div><div className="text-xs text-gray-500 font-mono">{t.ticket_number}{t.csr_number ? ` · ${t.csr_number}` : ''}</div></span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${t.completion === 'rtn' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-green-100 text-green-800 border-green-200'}`}>{completionLabel(t.completion) ?? 'Turned in'}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <details className="rp-card">
              <summary className="px-4 py-3 cursor-pointer font-semibold text-gray-900">Blank ticket (no dispatch)</summary>
              <form action={createServiceTicket} className="px-4 pb-4 space-y-3">
                <input type="hidden" name="from" value="mobile" />
                <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="nt-brand">Brand</label>
                  <select id="nt-brand" name="brand" className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm" defaultValue="7-Eleven">{BRANDS.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="nt-store">Store #</label><input id="nt-store" name="store_number" className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm" placeholder="41617" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="nt-problem">Problem reported</label><input id="nt-problem" name="problem_reported" className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm" placeholder="PUL spill bucket sensor alarm" /></div>
                <button type="submit" className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5">Start ticket</button>
              </form>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
