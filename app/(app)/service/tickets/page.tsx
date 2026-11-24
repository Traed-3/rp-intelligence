import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TICKET_STATUSES, ticketStatusMeta, canWriteServiceTickets, BRANDS } from '@/lib/service-tickets'
import { createServiceTicket } from './actions'
import { fmtDate } from '@/lib/billing'
import { Plus } from 'lucide-react'

const th = 'text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap'

export default async function ServiceTicketsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user!.id).single()
  const company_id = profile!.company_id
  const canWrite = canWriteServiceTickets(profile?.role)

  let q = admin.from('service_tickets').select('id, ticket_number, status, brand, store_number, csr_number, work_performed, updated_at, needs_quote, svc_technicians(full_name), site_signed_at, tech_signed_at')
    .eq('company_id', company_id).order('updated_at', { ascending: false }).limit(200)
  if (status === 'open') q = q.not('status', 'in', '(invoiced,void)')
  else if (status === 'to_invoice') q = q.eq('status', 'signed')
  else if (status) q = q.eq('status', status)
  const { data: rows } = await q
  const list = rows ?? []

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">
            Field Tickets
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{list.length} ticket{list.length !== 1 ? 's' : ''} · signed tickets become invoices with one click</p>
        </div>
        <Link href="/service" className="text-sm text-gray-500 hover:text-gray-700">← Service Dispatch</Link>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {[{ v: '', l: 'All' }, { v: 'open', l: 'Open' }, { v: 'to_invoice', l: 'Signed · ready to invoice' }, ...TICKET_STATUSES.map(s => ({ v: s.value, l: s.label }))].map(f => (
          <Link key={f.v} href={f.v ? `/service/tickets?status=${f.v}` : '/service/tickets'} className={`text-xs px-3 py-1.5 rounded-full border ${status === f.v ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-blue-300'}`}>{f.l}</Link>
        ))}
      </div>

      <div className="rp-card overflow-hidden mb-5">
        {list.length === 0 ? <div className="p-12 text-center text-sm text-gray-400">No tickets yet. Techs start them from a dispatched work order on their phone.</div> : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50"><th className={th}>Ticket</th><th className={th}>Site</th><th className={`${th} hidden md:table-cell`}>Technician</th><th className={`${th} hidden lg:table-cell`}>Work performed</th><th className={th}>Signed</th><th className={th}>Status</th><th className="px-4 py-3" /></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {list.map(t => { const st = ticketStatusMeta(t.status); const tech = (t as unknown as { svc_technicians?: { full_name: string } | null }).svc_technicians; return (
                  <ClickableRow key={t.id} href={`/service/tickets/${t.id}`}>
                    <td className="px-4 py-3"><div className="font-mono text-gray-900">{t.ticket_number}</div><div className="text-xs text-gray-400">{fmtDate(t.updated_at)}</div></td>
                    <td className="px-4 py-3"><div className="text-gray-900">{t.brand ?? '—'}{t.store_number ? ` · ${t.store_number}` : ''}</div><div className="text-xs text-gray-400 font-mono">{t.csr_number ?? ''}</div></td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{tech?.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell max-w-md truncate">{t.work_performed ?? <span className="text-gray-300">—</span>}{t.needs_quote && <span className="ml-2 text-xs text-amber-700">needs quote</span>}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{t.tech_signed_at ? 'Tech ✓' : 'Tech –'} / {t.site_signed_at ? 'Site ✓' : 'Site –'}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full border ${st.className}`}>{st.label}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Open →</span></td>
                  </ClickableRow>) })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canWrite && (
        <details className="rp-card">
          <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />New ticket (no dispatch)</summary>
          <form action={createServiceTicket} className="px-5 pb-5 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="st-brand">Brand</label><select id="st-brand" name="brand" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" defaultValue="7-Eleven">{BRANDS.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="st-store">Store #</label><input id="st-store" name="store_number" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="st-problem">Problem reported</label><input id="st-problem" name="problem_reported" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></div>
            <div className="sm:col-span-3"><button type="submit" className="rounded-lg bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90">Create ticket</button></div>
          </form>
        </details>
      )}
    </div>
  )
}
