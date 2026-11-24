import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { money, fmtDate, stageMeta, CON_STAGES } from '@/lib/construction'
import { jobCostRows, sumBy } from '@/lib/construction-reports'
import { Download } from 'lucide-react'

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`)

export default async function ReportsPage() {
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  const rows = await jobCostRows(admin, company_id)
  const byCustomer = sumBy(rows, 'customer')
  const byProgram = sumBy(rows, 'program')

  const totals = rows.reduce((a, r) => ({
    quoted: a.quoted + r.quoted, invoiced: a.invoiced + r.invoiced,
    cost: a.cost + r.materialCost + r.laborCost, margin: a.margin + r.margin,
  }), { quoted: 0, invoiced: 0, cost: 0, margin: 0 })

  // Pipeline aging by stage
  const { data: openJobs } = await admin
    .from('con_jobs').select('stage, date_received').eq('company_id', company_id).neq('stage', 'complete')
  const today = new Date()
  const aging = CON_STAGES.filter(s => s.value !== 'complete').map(s => {
    const inStage = (openJobs ?? []).filter(j => j.stage === s.value)
    const ages = inStage.map(j => j.date_received ? Math.floor((today.getTime() - new Date(j.date_received + 'T00:00:00').getTime()) / 86400000) : null).filter((x): x is number => x != null)
    const avg = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null
    return { stage: s.value, label: s.label, count: inStage.length, avgAge: avg }
  }).filter(s => s.count > 0)

  // Invoiced revenue by year. RPS runs no receivables here — once a job is
  // invoiced it is revenue, so what matters is the history, not who owes what.
  const { data: allInv } = await admin
    .from('con_invoices').select('id, invoice_number, invoice_date, status, invoice_grand_total, con_customers(name)')
    .eq('company_id', company_id).neq('status', 'void').order('invoice_date', { ascending: false, nullsFirst: false })
  const invoiced = allInv ?? []
  const invoicedTotal = invoiced.reduce((a, r) => a + (Number(r.invoice_grand_total) || 0), 0)
  const byYear = new Map<string, { year: string; count: number; total: number }>()
  for (const inv of invoiced) {
    const y = String(inv.invoice_date ?? '').slice(0, 4) || 'Undated'
    const cur = byYear.get(y) ?? { year: y, count: 0, total: 0 }
    cur.count++; cur.total += Number(inv.invoice_grand_total) || 0
    byYear.set(y, cur)
  }
  const years = [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year))

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Construction Reports
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Job cost · margin · pipeline aging · invoiced revenue</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Total Quoted" value={money(totals.quoted)} />
        <Stat label="Total Invoiced" value={money(totals.invoiced)} />
        <Stat label="Total Cost (Mat+Labor)" value={money(totals.cost)} />
        <Stat label="Total Margin" value={money(totals.margin)} accent={totals.margin >= 0 ? 'text-green-700' : 'text-red-700'} sub={totals.invoiced > 0 ? `${((totals.margin / totals.invoiced) * 100).toFixed(1)}%` : undefined} />
      </div>

      {/* Job cost */}
      <Section title="Job Cost" csv="job_cost">
        <div className="overflow-x-auto">
          <table className="rp-table w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-4 py-2">Job</th>
                <th className="text-left px-4 py-2 hidden md:table-cell">Customer</th>
                <th className="text-left px-4 py-2 hidden lg:table-cell">Stage</th>
                <th className="text-right px-4 py-2">Quoted</th>
                <th className="text-right px-4 py-2">Invoiced</th>
                <th className="text-right px-4 py-2 hidden sm:table-cell">Material</th>
                <th className="text-right px-4 py-2 hidden sm:table-cell">Labor</th>
                <th className="text-right px-4 py-2">Margin</th>
                <th className="text-right px-4 py-2 hidden md:table-cell">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">No jobs yet.</td></tr>
              ) : rows.map(r => (
                <tr key={r.jobId} className="hover:bg-gray-50">
                  <td className="px-4 py-2"><Link href={`/construction/jobs/${r.jobId}?tab=cost`} className="font-medium text-blue-600 hover:text-blue-800">{r.site}</Link></td>
                  <td className="px-4 py-2 text-gray-600 hidden md:table-cell">{r.customer || '—'}</td>
                  <td className="px-4 py-2 hidden lg:table-cell text-xs text-gray-500">{stageMeta(r.stage).label}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{money(r.quoted)}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{money(r.invoiced)}</td>
                  <td className="px-4 py-2 text-right text-gray-500 hidden sm:table-cell">{money(r.materialCost)}</td>
                  <td className="px-4 py-2 text-right text-gray-500 hidden sm:table-cell">{money(r.laborCost)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${r.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>{money(r.margin)}</td>
                  <td className="px-4 py-2 text-right text-gray-500 hidden md:table-cell">{pct(r.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-6">
        <MarginTable title="Margin by Customer" rows={byCustomer} />
        <MarginTable title="Margin by Program" rows={byProgram} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-6">
        {/* Pipeline aging */}
        <Section title="Pipeline Aging" csv="pipeline">
          <table className="rp-table w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {aging.length === 0 ? <tr><td className="px-4 py-6 text-gray-400">No open jobs.</td></tr> : aging.map(s => (
                <tr key={s.stage}>
                  <td className="px-4 py-2 text-gray-800">{s.label}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{s.count} job{s.count !== 1 ? 's' : ''}</td>
                  <td className="px-4 py-2 text-right text-gray-500 text-xs">{s.avgAge != null ? `avg ${s.avgAge}d` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Invoiced revenue by year */}
        <Section title={`Invoiced — ${money(invoicedTotal)}`} csv="invoiced">
          <table className="rp-table w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {years.length === 0 ? <tr><td className="px-4 py-6 text-gray-400">Nothing invoiced yet.</td></tr> : years.map(y => (
                <tr key={y.year} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{y.year}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{y.count} {y.count === 1 ? 'invoice' : 'invoices'}</td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">{money(y.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, csv, children }: { title: string; csv: string; children: React.ReactNode }) {
  return (
    <div className="rp-card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <a href={`/api/construction/reports/csv?report=${csv}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800">
          <Download className="w-3.5 h-3.5" />CSV
        </a>
      </div>
      {children}
    </div>
  )
}

function MarginTable({ title, rows }: { title: string; rows: { name: string; quoted: number; invoiced: number; cost: number; margin: number }[] }) {
  return (
    <div className="rp-card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">{title}</h2></div>
      <div className="overflow-x-auto">
        <table className="rp-table w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500">
              <th className="text-left px-4 py-2">{title.includes('Customer') ? 'Customer' : 'Program'}</th>
              <th className="text-right px-4 py-2">Invoiced</th>
              <th className="text-right px-4 py-2">Cost</th>
              <th className="text-right px-4 py-2">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">No data.</td></tr> : rows.map(r => (
              <tr key={r.name}>
                <td className="px-4 py-2 text-gray-800">{r.name}</td>
                <td className="px-4 py-2 text-right text-gray-600">{money(r.invoiced)}</td>
                <td className="px-4 py-2 text-right text-gray-500">{money(r.cost)}</td>
                <td className={`px-4 py-2 text-right font-semibold ${r.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>{money(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rp-card p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
