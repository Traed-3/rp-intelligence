import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canWriteServiceTickets, ticketStatusMeta, BRANDS } from '@/lib/service-tickets'
import { createServiceTicket } from '@/app/(app)/service/tickets/actions'

const OPEN_WO = ['dispatched', 'new', 'on_site', 'in_progress', 'waiting_parts', 'rtn_needed']

export default async function MobileServiceTicketsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user!.id).single()
  const canWrite = canWriteServiceTickets(profile?.role)
  const company_id = profile!.company_id

  const { data: tech } = await admin.from('svc_technicians').select('id').eq('company_id', company_id).eq('profile_id', profile!.id).maybeSingle()

  const [{ data: mine }, { data: dispatched }] = await Promise.all([
    admin.from('service_tickets').select('id, ticket_number, status, brand, store_number, csr_number, updated_at')
      .eq('company_id', company_id).not('status', 'in', '(invoiced,void)')
      .or(`created_by.eq.${profile!.id}${tech ? `,technician_id.eq.${tech.id}` : ''}`)
      .order('updated_at', { ascending: false }).limit(20),
    admin.from('svc_work_orders').select('id, portal_wo_number, client_name, site_number, site_address, site_city, priority_raw, status, assigned_technician_id')
      .eq('company_id', company_id).eq('archived', false).in('status', OPEN_WO)
      .order('priority_rank').order('dispatched_at', { ascending: false }).limit(30),
  ])
  const { data: started } = await admin.from('service_tickets').select('work_order_id').eq('company_id', company_id).not('work_order_id', 'is', null)
  const startedIds = new Set((started ?? []).map(s => s.work_order_id))
  const wos = (dispatched ?? []).filter(w => !startedIds.has(w.id))
  const myWos = tech ? wos.filter(w => w.assigned_technician_id === tech.id) : []
  const otherWos = wos.filter(w => !myWos.includes(w))

  return (
    <div className="min-h-screen bg-gray-50 p-5">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="rp-title">Service Tickets</h1>
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
            {[{ title: 'Dispatched to me', rows: myWos }, { title: 'Other open work orders', rows: otherWos }].map(g => g.rows.length > 0 && (
              <section key={g.title} className="rp-card overflow-hidden">
                <h2 className="px-4 py-3 font-semibold text-gray-900 border-b border-gray-100">{g.title}</h2>
                <ul className="divide-y divide-gray-100">
                  {g.rows.map(w => (
                    <li key={w.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0"><div className="font-medium text-gray-900 truncate">{w.client_name ?? 'Customer'} · {w.site_number ?? '—'}</div><div className="text-xs text-gray-500 truncate">{w.portal_wo_number} · {w.priority_raw ?? ''}{w.site_city ? ` · ${w.site_city}` : ''}</div></span>
                        <form action={createServiceTicket}><input type="hidden" name="work_order_id" value={w.id} /><input type="hidden" name="from" value="mobile" /><button type="submit" className="shrink-0 rounded-lg bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5">Start ticket</button></form>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

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
