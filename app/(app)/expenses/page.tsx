import Link from 'next/link'
import { canAuditCards } from '@/lib/card-audit'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Plus, Fuel, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'

const TYPE_BADGE: Record<string, string> = {
  asset:   'bg-blue-100 text-blue-800',
  store:   'bg-purple-100 text-purple-800',
  project: 'bg-amber-100 text-amber-800',
  general: 'bg-gray-100 text-gray-700',
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string }>
}) {
  const { type = '', q = '' } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()

  let query = admin
    .from('expenses')
    .select('id, expense_date, amount, expense_type, vendor, description, payment_method_code, receipt_url, assets(unit_number), profiles!expenses_submitted_by_fkey(full_name)')
    .eq('company_id', profile!.company_id)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)

  if (type) query = query.eq('expense_type', type)
  if (q) query = query.or(`vendor.ilike.%${q}%,description.ilike.%${q}%`)

  const { data: expenses } = await query

  // Quick totals for this month
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
  const { data: monthExpenses } = await admin
    .from('expenses')
    .select('amount')
    .eq('company_id', profile!.company_id)
    .gte('expense_date', monthStart.toISOString().split('T')[0])

  const monthTotal = (monthExpenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const allTotal = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">Expenses & Receipts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            ${monthTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} spent this month
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/expenses/fuel">
            <Button variant="outline" className="gap-2"><Fuel className="w-4 h-4" />Fuel</Button>
          </Link>
          <Link href="/expenses/new">
            <Button className="gap-2"><Plus className="w-4 h-4" />Add Receipt</Button>
          </Link>
        </div>
      </div>

      {/* Quick nav */}
      <div className="flex gap-2 flex-wrap mb-5">
        {[
          { value: '', label: 'All' },
          { value: 'asset', label: '🚛 Asset' },
          { value: 'store', label: '🏪 Store' },
          { value: 'project', label: '📋 Project' },
          { value: 'general', label: '📦 General' },
        ].map(f => (
          <Link key={f.value} href={`/expenses?type=${f.value}${q ? `&q=${q}` : ''}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
              type === f.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'
            }`}>
            {f.label}
          </Link>
        ))}
        {canAuditCards(profile!.role) && (
          <Link href="/expenses/cards" className="ml-auto px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 bg-card text-gray-600 hover:border-gray-400">
            💳 Card audit →
          </Link>
        )}
        <Link href="/expenses/report" className="px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 bg-card text-gray-600 hover:border-gray-400">
          📊 Report →
        </Link>
      </div>

      {/* Search */}
      <form method="GET" className="flex gap-2 mb-5">
        <input name="q" defaultValue={q} placeholder="Search vendor or description…"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {type && <input type="hidden" name="type" value={type} />}
        <button type="submit" className="px-4 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg">Search</button>
      </form>

      {/* Table */}
      <div className="rp-card overflow-hidden">
        {!expenses?.length ? (
          <p className="px-5 py-10 text-center text-sm text-gray-400">No expenses found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left px-4 py-2.5">Vendor</th>
                  <th className="text-left px-4 py-2.5 hidden md:table-cell">Charged To</th>
                  <th className="text-left px-4 py-2.5 hidden sm:table-cell">Pay</th>
                  <th className="text-right px-4 py-2.5">Amount</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {expenses.map(e => (
                  <ClickableRow key={e.id} href={`/expenses/${e.id}`}>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {new Date(e.expense_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{e.vendor || '—'}</p>
                      {e.description && <p className="text-xs text-gray-400 truncate max-w-xs">{e.description}</p>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_BADGE[e.expense_type]}`}>
                        {e.expense_type === 'asset' ? (e as any).assets?.unit_number ?? e.expense_type : e.expense_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {e.payment_method_code && (
                        <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">{e.payment_method_code}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      ${Number(e.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/expenses/${e.id}`} className="text-xs text-blue-600 hover:text-blue-800 font-medium">View →</Link>
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={4} className="px-4 py-2.5 text-sm font-bold text-gray-700">
                    {type || q ? 'Filtered Total' : 'Recent Total'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                    ${allTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
