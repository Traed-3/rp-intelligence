import Link from 'next/link'
import { FileText, Receipt, Users, Package, Plus } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireBilling } from '@/lib/billing-guard'
import { money, fmtDate } from '@/lib/billing'
import { ClickableRow } from '@/components/clickable-row'
import { QuoteStatusBadge, InvoiceStatusBadge } from '@/components/construction/badges'

export default async function BillingHubPage() {
  const { company_id, canWrite } = await requireBilling()
  const admin = createAdminClient()
  const year = String(new Date().getFullYear())
  const [{ data: quotes }, { data: invoices }] = await Promise.all([
    admin.from('con_quotes').select('id, quote_number, proposal_date, status, final_total, store_label, department, con_customers(name)').eq('company_id', company_id).order('created_at', { ascending: false }).limit(8),
    admin.from('con_invoices').select('id, invoice_number, invoice_date, status, invoice_grand_total, store_label, department, con_customers(name)').eq('company_id', company_id).order('created_at', { ascending: false }).limit(8),
  ])
  const { data: allInv } = await admin.from('con_invoices').select('invoice_grand_total, invoice_date, status, department').eq('company_id', company_id).neq('status', 'draft').neq('status', 'void').gte('invoice_date', `${year}-01-01`)
  const ytd = (allInv ?? []).reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)
  const ytdSvc = (allInv ?? []).filter(r => r.department === 'service').reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)
  const openQuotes = (quotes ?? []).filter(q => q.status === 'draft' || q.status === 'sent').length

  const tiles = [
    { href: '/billing/quotes', icon: FileText, title: 'Quotes', body: `${openQuotes} open · REV19 twelve-category starting quotes` },
    { href: '/billing/invoices', icon: Receipt, title: 'Invoices', body: `${money(ytd)} invoiced ${year}${ytdSvc ? ` · ${money(ytdSvc)} service` : ''}` },
    { href: '/construction/customers', icon: Users, title: 'Customers & rate cards', body: '7-Eleven $78.50 · Global $82.50 · Sunoco $80 · Independent $95' },
    { href: '/inventory/parts', icon: Package, title: 'Price book', body: 'Catalog costs with source and date feed every material line' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="rp-title">Quotes &amp; Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">Quotes and invoices for Construction and Service, priced the REV19 way.</p>
        </div>
        {canWrite && <div className="flex gap-2"><Link href="/billing/quotes/new" className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-3 py-2 hover:bg-primary/90"><Plus className="w-4 h-4" />New quote</Link><Link href="/billing/invoices/new" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium px-3 py-2 hover:border-blue-300"><Plus className="w-4 h-4" />New invoice</Link></div>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {tiles.map(t => { const Icon = t.icon; return (
          <Link key={t.href} href={t.href} className="rp-card rp-card-link block p-5">
            <div className="flex items-start gap-3"><span className="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Icon className="w-5 h-5" /></span><div><div className="font-semibold text-gray-900">{t.title}</div><div className="text-sm text-gray-500 mt-0.5">{t.body}</div></div></div>
          </Link>) })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rp-card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"><h2 className="font-semibold text-gray-900">Recent quotes</h2><Link href="/billing/quotes" className="text-xs text-blue-600">All →</Link></div>
          <table className="rp-table w-full text-sm"><tbody className="divide-y divide-gray-50">
            {(quotes ?? []).map(q => <ClickableRow key={q.id} href={`/billing/quotes/${q.id}`}><td className="px-4 py-2.5 font-mono text-xs text-gray-700">{q.quote_number}</td><td className="px-2 py-2.5 text-gray-700">{(q as unknown as { con_customers: { name: string } | null }).con_customers?.name ?? '—'}<div className="text-xs text-gray-400">{q.store_label ?? ''} · {q.department}</div></td><td className="px-2 py-2.5"><QuoteStatusBadge status={q.status} /></td><td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(q.final_total)}</td></ClickableRow>)}
            {!(quotes ?? []).length && <tr><td className="px-5 py-6 text-sm text-gray-400">No quotes yet.</td></tr>}
          </tbody></table>
        </div>
        <div className="rp-card overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between"><h2 className="font-semibold text-gray-900">Recent invoices</h2><Link href="/billing/invoices" className="text-xs text-blue-600">All →</Link></div>
          <table className="rp-table w-full text-sm"><tbody className="divide-y divide-gray-50">
            {(invoices ?? []).map(i => <ClickableRow key={i.id} href={`/billing/invoices/${i.id}`}><td className="px-4 py-2.5 font-mono text-xs text-gray-700">{i.invoice_number}</td><td className="px-2 py-2.5 text-gray-700">{(i as unknown as { con_customers: { name: string } | null }).con_customers?.name ?? '—'}<div className="text-xs text-gray-400">{i.store_label ?? ''} · {fmtDate(i.invoice_date)}</div></td><td className="px-2 py-2.5"><InvoiceStatusBadge status={i.status} /></td><td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(i.invoice_grand_total)}</td></ClickableRow>)}
            {!(invoices ?? []).length && <tr><td className="px-5 py-6 text-sm text-gray-400">No invoices yet.</td></tr>}
          </tbody></table>
        </div>
      </div>
    </div>
  )
}
