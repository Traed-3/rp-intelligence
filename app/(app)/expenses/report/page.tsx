import Link from 'next/link'
import { submitterLabel } from '@/lib/receipt-submitter'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Download } from 'lucide-react'

type GroupRow = { label: string; total: number; count: number }

function groupBy<T>(items: T[], key: (item: T) => string): GroupRow[] {
  const map: Record<string, GroupRow> = {}
  for (const item of items) {
    const k = key(item) || 'Unknown'
    if (!map[k]) map[k] = { label: k, total: 0, count: 0 }
    map[k].total += Number((item as any).amount)
    map[k].count++
  }
  return Object.values(map).sort((a, b) => b.total - a.total)
}

function SummaryTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div className="rp-card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        <h2 className="font-semibold text-sm text-gray-900">{title}</h2>
      </div>
      <div className="divide-y divide-gray-50">
        {rows.slice(0, 10).map(r => (
          <div key={r.label} className="px-5 py-2.5 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{r.label}</p>
              <p className="text-xs text-gray-400">{r.count} receipt{r.count !== 1 ? 's' : ''}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-gray-900">${r.total.toFixed(2)}</p>
              <p className="text-xs text-gray-400">{((r.total / grandTotal) * 100).toFixed(0)}%</p>
            </div>
          </div>
        ))}
        <div className="px-5 py-2.5 bg-gray-50 flex justify-between">
          <span className="text-sm font-bold text-gray-700">Total</span>
          <span className="text-sm font-bold text-gray-900">${grandTotal.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}

export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period = 'this_month' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id').eq('id', user!.id).single()

  // Date range
  const today = new Date()
  let startDate: Date
  let label: string
  if (period === 'last_month') {
    startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end = new Date(today.getFullYear(), today.getMonth(), 0)
    label = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    today.setTime(end.getTime())
  } else if (period === 'this_year') {
    startDate = new Date(today.getFullYear(), 0, 1)
    label = `${today.getFullYear()}`
  } else if (period === 'last_30') {
    startDate = new Date(today.getTime() - 30 * 86400000)
    label = 'Last 30 Days'
  } else {
    startDate = new Date(today.getFullYear(), today.getMonth(), 1)
    label = startDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const { data: expenses } = await admin
    .from('expenses')
    .select('id, amount, expense_type, payment_method_code, expense_date, assets(unit_number), submitter_name, submitter_email, profiles!expenses_submitted_by_fkey(full_name), expense_categories(name)')
    .eq('company_id', profile!.company_id)
    .gte('expense_date', startDate.toISOString().split('T')[0])
    .order('expense_date', { ascending: false })

  const { data: fuelEntries } = await admin
    .from('fuel_entries')
    .select('total_cost, gallons, assets(unit_number)')
    .eq('company_id', profile!.company_id)
    .gte('entry_date', startDate.toISOString().split('T')[0])

  const total = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const fuelTotal = (fuelEntries ?? []).reduce((s, f) => s + Number(f.total_cost ?? 0), 0)
  const fuelGallons = (fuelEntries ?? []).reduce((s, f) => s + Number(f.gallons), 0)

  const byPerson = groupBy(expenses ?? [], e => submitterLabel(e as any) ?? 'Unknown')
  const byPayment = groupBy(expenses ?? [], e => e.payment_method_code ?? 'Unknown')
  const byAsset = groupBy(
    (expenses ?? []).filter(e => e.expense_type === 'asset'),
    e => (e as any).assets?.unit_number ?? 'Unknown'
  )
  const byType = groupBy(expenses ?? [], e => e.expense_type)

  const PERIODS = [
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'last_30',    label: 'Last 30 Days' },
    { value: 'this_year',  label: 'This Year' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/expenses" className="hover:text-gray-700">Expenses</Link>
            <span>/</span><span>Report</span>
          </div>
          <h1 className="rp-title">Spending Report</h1>
          <p className="text-sm text-gray-500 mt-0.5">{label}</p>
        </div>
        <a
          href={`/api/reports/expenses-csv?start=${startDate.toISOString().split('T')[0]}&end=${today.toISOString().split('T')[0]}`}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-600/90 shrink-0"
        >
          <Download className="w-4 h-4" /> Export CSV
        </a>
      </div>

      {/* Period picker */}
      <div className="flex gap-2 mb-6">
        {PERIODS.map(p => (
          <Link key={p.value} href={`/expenses/report?period=${p.value}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              period === p.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'
            }`}>
            {p.label}
          </Link>
        ))}
      </div>

      {/* Top summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Expenses', value: `$${total.toFixed(2)}`, sub: `${(expenses ?? []).length} receipts` },
          { label: 'Fuel Cost', value: `$${fuelTotal.toFixed(2)}`, sub: `${fuelGallons.toFixed(1)} gal` },
          { label: 'Combined Total', value: `$${(total + fuelTotal).toFixed(2)}`, sub: 'expenses + fuel' },
          { label: 'Avg per Receipt', value: (expenses ?? []).length ? `$${(total / expenses!.length).toFixed(2)}` : '—', sub: 'per transaction' },
        ].map(s => (
          <div key={s.label} className="rp-card p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            <p className="text-xs text-gray-400">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Breakdown tables */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SummaryTable title="By Employee" rows={byPerson} />
        <SummaryTable title="By Payment Method" rows={byPayment} />
        <SummaryTable title="By Asset (asset expenses only)" rows={byAsset} />
        <SummaryTable title="By Expense Type" rows={byType} />
      </div>
    </div>
  )
}
