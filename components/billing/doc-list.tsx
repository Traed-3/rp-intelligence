import Link from 'next/link'
import { Plus } from 'lucide-react'
import { ClickableRow } from '@/components/clickable-row'
import { money, fmtDate } from '@/lib/billing'
import { QuoteStatusBadge, InvoiceStatusBadge } from '@/components/construction/badges'

export type DocRow = { id: string; number: string | null; date: string | null; status: string; total: number | null; store_label: string | null; department: string | null; customer: string | null; isChangeOrder?: boolean }

/** Shared list for /billing/quotes and /billing/invoices. */
export function DocList({ kind, rows, status, department, canWrite, statuses }: { kind: 'quotes' | 'invoices'; rows: DocRow[]; status: string; department: string; canWrite: boolean; statuses: string[] }) {
  const isQ = kind === 'quotes'
  const q = (s: string, d: string) => `/billing/${kind}${s || d ? `?${[s ? `status=${s}` : '', d ? `department=${d}` : ''].filter(Boolean).join('&')}` : ''}`
  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="rp-title">{isQ ? 'Quotes' : 'Invoices'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{rows.length} {isQ ? 'quote' : 'invoice'}{rows.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/billing" className="text-sm text-gray-500 hover:text-gray-700">← Billing</Link>
          {isQ && <Link href="/billing/quotes/templates" className="text-sm text-gray-500 hover:text-gray-700">Templates</Link>}
          {canWrite && <Link href={`/billing/${kind}/new`} className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium px-3 py-2 hover:bg-primary/90"><Plus className="w-4 h-4" />{isQ ? 'New quote' : 'New invoice'}</Link>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {['', ...statuses].map(s => <Link key={s || 'all'} href={q(s, department)} className={`px-3 py-1.5 text-xs font-medium rounded-full border capitalize ${status === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'}`}>{s === 'sent' && !isQ ? 'Invoiced' : s || 'All'}</Link>)}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {[['', 'Both departments'], ['construction', 'Construction'], ['service', 'Service']].map(([d, l]) => <Link key={d} href={q(status, d)} className={`px-3 py-1 text-xs rounded-full border ${department === d ? 'bg-foreground text-background border-foreground' : 'bg-card text-gray-600 border-gray-200'}`}>{l}</Link>)}
      </div>
      <div className="rp-card overflow-hidden">
        {!rows.length ? <p className="p-12 text-center text-sm text-gray-400">Nothing here yet.</p> : (
          <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50"><th className="text-left px-4 py-3">#</th><th className="text-left px-4 py-3 hidden sm:table-cell">Customer</th><th className="text-left px-4 py-3 hidden md:table-cell">Store</th><th className="text-left px-4 py-3 hidden md:table-cell">Dept</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3 hidden lg:table-cell">Date</th><th className="text-right px-4 py-3">Total</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <ClickableRow key={r.id} href={`/billing/${kind}/${r.id}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.isChangeOrder && <span className="text-purple-600">CO · </span>}{r.number ?? 'DRAFT'}</td>
                  <td className="px-4 py-3 text-gray-700 hidden sm:table-cell">{r.customer ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{r.store_label ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell capitalize">{r.department ?? 'construction'}</td>
                  <td className="px-4 py-3">{isQ ? <QuoteStatusBadge status={r.status} /> : <InvoiceStatusBadge status={r.status} />}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">{fmtDate(r.date)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">{money(r.total)}</td>
                  <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Open →</span></td>
                </ClickableRow>
              ))}
            </tbody></table></div>
        )}
      </div>
    </div>
  )
}
