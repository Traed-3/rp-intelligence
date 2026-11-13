import Link from 'next/link'
import { submitterLabel } from '@/lib/receipt-submitter'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Download } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { FilterChip } from '@/components/ui/filter-chip'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/components/ui/section-card'
import { StatTile } from '@/components/ui/stat-tile'
import { expenseTypeLabel } from '@/lib/expense-display'
import { dollars, money } from '@/lib/receipt-report'

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

function SummaryTable({ title, rows, footer }: { title: string; rows: GroupRow[]; footer?: React.ReactNode }) {
  const grandTotal = rows.reduce((s, r) => s + r.total, 0)
  return (
    <SectionCard title={title} flush>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">Nothing in this period.</p>
      ) : (
        <div>
          {rows.slice(0, 10).map(r => (
            <div key={r.label} className="px-5 py-2.5 flex items-center justify-between border-b border-hairline">
              <div>
                <p className="text-sm font-medium text-foreground">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.count} receipt{r.count !== 1 ? 's' : ''}</p>
              </div>
              <div className="text-right tabular-nums">
                <p className="text-sm font-bold text-foreground">{money(r.total)}</p>
                <p className="text-xs text-muted-foreground">{grandTotal ? ((r.total / grandTotal) * 100).toFixed(0) : 0}%</p>
              </div>
            </div>
          ))}
          <div className="px-5 py-2.5 bg-raised flex justify-between text-sm font-bold tabular-nums">
            <span className="text-gray-700">Total</span>
            <span className="text-foreground">{money(grandTotal)}</span>
          </div>
        </div>
      )}
      {footer && <div className="px-5 py-2.5 border-t border-hairline text-xs">{footer}</div>}
    </SectionCard>
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
    .lte('expense_date', today.toISOString().split('T')[0])   // "Last month" stops at that month's last day
    .order('expense_date', { ascending: false })

  const { data: fuelEntries } = await admin
    .from('fuel_entries')
    .select('total_cost, gallons, assets(unit_number)')
    .eq('company_id', profile!.company_id)
    .gte('entry_date', startDate.toISOString().split('T')[0])
    .lte('entry_date', today.toISOString().split('T')[0])

  const total = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const fuelTotal = (fuelEntries ?? []).reduce((s, f) => s + Number(f.total_cost ?? 0), 0)
  const fuelGallons = (fuelEntries ?? []).reduce((s, f) => s + Number(f.gallons), 0)

  const byPerson = groupBy(expenses ?? [], e => submitterLabel(e as any) ?? 'Unknown')
  const byPayment = groupBy(expenses ?? [], e => e.payment_method_code ?? 'No payment code')
  const byAsset = groupBy(
    (expenses ?? []).filter(e => e.expense_type === 'asset'),
    e => (e as any).assets?.unit_number ?? 'Unknown'
  )
  const byType = groupBy(expenses ?? [], e => expenseTypeLabel(e.expense_type))

  const PERIODS = [
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'last_30',    label: 'Last 30 Days' },
    { value: 'this_year',  label: 'This Year' },
  ]

  const startIso = startDate.toISOString().split('T')[0]
  const n = (expenses ?? []).length

  return (
    <div className="rp-page max-w-6xl">
      <PageHeader
        crumbs={[{ label: 'Expenses', href: '/expenses' }, { label: 'Spending report' }]}
        title="Spending Report"
        description={label}
        actions={
          <a href={`/api/reports/expenses-csv?start=${startIso}&end=${today.toISOString().split('T')[0]}`} className={buttonVariants({ variant: 'outline' })}>
            <Download /> Export CSV
          </a>
        }
      />

      <div className="flex flex-wrap gap-2 mb-5">
        {PERIODS.map(p => <FilterChip key={p.value} href={`/expenses/report?period=${p.value}`} active={period === p.value}>{p.label}</FilterChip>)}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={dollars(total)} label={`Receipts · ${n} turned in`} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={dollars(fuelTotal)} label={`Fuel · ${fuelGallons.toFixed(1)} gal`} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={dollars(total + fuelTotal)} label="Receipts and fuel together" />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={n ? money(total / n) : '—'} label="Average receipt" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <SummaryTable title="By person" rows={byPerson} />
        <SummaryTable
          title="By payment method"
          rows={byPayment}
          footer={<Link href="/expenses/receipts" className="font-medium text-primary hover:underline">See every receipt by payment type, with the receipt and a check-off →</Link>}
        />
        <SummaryTable title="By truck or asset" rows={byAsset} />
        <SummaryTable title="By what it was charged to" rows={byType} />
      </div>
    </div>
  )
}
