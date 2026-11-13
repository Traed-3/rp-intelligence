import Link from 'next/link'
import { BarChart3, CreditCard, FileText, Fuel, Plus, ReceiptText, Search } from 'lucide-react'
import { ClickableRow } from '@/components/clickable-row'
import { buttonVariants } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChip } from '@/components/ui/filter-chip'
import { PageHeader } from '@/components/ui/page-header'
import { SiteTag } from '@/components/ui/site-tag'
import { StatTile } from '@/components/ui/stat-tile'
import { StatusPill } from '@/components/ui/status-pill'
import { canAuditCards } from '@/lib/card-audit'
import { chargedTo, EXPENSE_TYPE_LABEL } from '@/lib/expense-display'
import { dollars, money, monthBounds, recentMonths, shortDate } from '@/lib/receipt-report'
import { safeReceiptUrl } from '@/lib/receipt-url'
import { submitterLabel } from '@/lib/receipt-submitter'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

const PAGE = 100
const TYPES = ['asset', 'project', 'store', 'general'] as const

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; q?: string }>
}) {
  const sp = await searchParams
  const type = TYPES.includes(sp.type as (typeof TYPES)[number]) ? sp.type! : ''
  // The search box feeds a PostgREST filter, so keep it to plain words and numbers.
  const q = (sp.q ?? '').replace(/[^\w\s.&'#-]/g, ' ').trim().slice(0, 60)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()
  const companyId = profile!.company_id

  let query = admin
    .from('expenses')
    .select('id, expense_date, amount, expense_type, vendor, description, payment_method_code, receipt_url, store_number, project_number, category_custom, submitter_name, submitter_email, statement_checked_at, assets(unit_number), con_jobs(site_number), expense_categories(name), profiles!expenses_submitted_by_fkey(full_name)', { count: 'exact' })
    .eq('company_id', companyId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(PAGE)
  if (type) query = query.eq('expense_type', type)
  if (q) query = query.or(`vendor.ilike.%${q}%,description.ilike.%${q}%,store_number.ilike.%${q}%,project_number.ilike.%${q}%,submitter_name.ilike.%${q}%`)
  const { data: expenses, count } = await query

  // This month and last month, for the tiles.
  const [thisMonth, lastMonth] = recentMonths(2)
  const { data: recent } = await admin
    .from('expenses')
    .select('amount, expense_date, statement_checked_at')
    .eq('company_id', companyId)
    .gte('expense_date', lastMonth.from)
    .limit(5000)
  const inMonth = (m: { from: string; to: string }) => (recent ?? []).filter(e => e.expense_date >= m.from && e.expense_date <= m.to)
  const sum = (rows: { amount: number | string }[]) => rows.reduce((s, e) => s + Number(e.amount), 0)
  const nowRows = inMonth(thisMonth), lastRows = inMonth(lastMonth)
  const lastOpen = lastRows.filter(e => !e.statement_checked_at).length
  const lastLabel = monthBounds(lastMonth.ym).label.split(' ')[0]

  const shownTotal = sum(expenses ?? [])
  const href = (t: string) => `/expenses${t || q ? '?' : ''}${new URLSearchParams({ ...(t ? { type: t } : {}), ...(q ? { q } : {}) })}`
  const filtered = !!(type || q)

  return (
    <div className="rp-page">
      <PageHeader
        title="Expenses & Receipts"
        description="Every receipt turned in by email or through the app: who sent it, what it was for and how it was paid."
        actions={<>
          <Link href="/expenses/fuel" className={buttonVariants({ variant: 'outline' })}><Fuel />Fuel</Link>
          <Link href="/expenses/new" className={buttonVariants()}><Plus />Add Receipt</Link>
        </>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={dollars(sum(nowRows))} label={`Spent in ${thisMonth.label.split(' ')[0]} · ${nowRows.length} receipts`} href={`/expenses/receipts?month=${thisMonth.ym}`} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={dollars(sum(lastRows))} label={`Spent in ${lastLabel} · ${lastRows.length} receipts`} href={`/expenses/receipts?month=${lastMonth.ym}`} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={lastOpen} tone={lastOpen ? 'warning' : 'success'} label={`${lastLabel} receipts not checked off against a bill`} href={`/expenses/receipts?month=${lastMonth.ym}&show=open`} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={count ?? 0} label={filtered ? 'Receipts match this filter' : 'Receipts on file'} />
      </div>

      {/* Where to go from here */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {[
          { href: '/expenses/receipts', icon: ReceiptText, title: 'Receipts by payment type', body: 'TEC, Home Depot and vendor accounts by month. Check each receipt off against the bill.', show: true },
          { href: '/expenses/report', icon: BarChart3, title: 'Spending report', body: 'Totals by person, payment method, truck and type.', show: true },
          { href: '/expenses/cards', icon: CreditCard, title: 'Card & account audit', body: 'Any card or vendor account: duplicates, refunds and receipts that do not match the amount in the email.', show: canAuditCards(profile!.role) },
        ].filter(t => t.show).map(t => (
          <Link key={t.href} href={t.href} className="rp-card rp-card-link p-4 flex items-start gap-3">
            <span className="rounded-lg p-2 bg-primary/10 text-primary shrink-0"><t.icon className="size-5" /></span>
            <span>
              <span className="block font-semibold text-foreground">{t.title}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">{t.body}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FilterChip href={href('')} active={!type}>All</FilterChip>
        {TYPES.map(t => <FilterChip key={t} href={href(t)} active={type === t}>{EXPENSE_TYPE_LABEL[t]}</FilterChip>)}
        <form method="GET" className="ml-auto flex w-full sm:w-auto gap-2">
          {type && <input type="hidden" name="type" value={type} />}
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input name="q" defaultValue={q} placeholder="Vendor, job, person, what it was" className="rp-input !pl-8" />
          </div>
          <button type="submit" className={buttonVariants({ variant: 'outline' })}>Search</button>
        </form>
      </div>

      {!expenses?.length ? (
        <EmptyState icon={<ReceiptText />} action={filtered ? <Link href="/expenses" className="text-sm font-medium text-primary hover:underline">Clear the filter</Link> : undefined}>
          {filtered ? 'No receipts match that filter.' : 'No receipts yet. They show up here as crews email them in or add them in the app.'}
        </EmptyState>
      ) : (
        <div className="rp-card overflow-hidden">
          <DataTable>
            <thead>
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Vendor / what it was</th>
                <th className="text-left px-4 py-2.5 hidden lg:table-cell">Sent by</th>
                <th className="text-left px-4 py-2.5">Charged to</th>
                <th className="text-left px-4 py-2.5 hidden sm:table-cell">Paid with</th>
                <th className="px-4 py-2.5 num">Amount</th>
                <th className="px-4 py-2.5 hidden md:table-cell">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => {
                const to = chargedTo(e as never)
                const receipt = safeReceiptUrl(e.receipt_url)
                const amount = Number(e.amount)
                return (
                  <ClickableRow key={e.id} href={`/expenses/${e.id}`}>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{shortDate(e.expense_date)}</td>
                    <td className="px-4 py-3 min-w-48">
                      {/* Emailed receipts often have no vendor read yet: lead with what it was instead of a dash. */}
                      <p className="font-medium text-foreground">{e.vendor || e.description || 'No description'}</p>
                      {e.vendor && e.description && <p className="text-xs text-muted-foreground line-clamp-1">{e.description}</p>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell whitespace-nowrap text-gray-700">{submitterLabel(e as never) ?? '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {to.kind === 'site' ? <SiteTag site={to.label} />
                        : to.kind === 'asset' ? <StatusPill tone="info">{to.label}</StatusPill>
                        : <StatusPill>{to.label}</StatusPill>}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {e.payment_method_code
                        ? <span className="font-mono text-xs font-semibold text-foreground">{e.payment_method_code}</span>
                        : <span className="text-xs text-muted-foreground">none</span>}
                      {e.statement_checked_at && <StatusPill tone="success" className="ml-2">On bill</StatusPill>}
                    </td>
                    <td className={`px-4 py-3 num font-semibold whitespace-nowrap ${amount < 0 ? 'text-info' : 'text-foreground'}`}>{money(amount)}</td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {receipt
                        ? <a href={receipt} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><FileText className="size-4" />Open</a>
                        : <span className="text-xs text-muted-foreground">none</span>}
                    </td>
                  </ClickableRow>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-raised">
                <td colSpan={5} className="px-4 py-2.5 text-sm font-semibold text-gray-700 border-t border-border">
                  {(count ?? 0) > expenses.length
                    ? <>Newest {expenses.length} of {count}. <Link href="/expenses/receipts" className="text-primary hover:underline">Pick a month to see them all</Link></>
                    : `${expenses.length} receipt${expenses.length === 1 ? '' : 's'}`}
                </td>
                <td className="px-4 py-2.5 num font-bold text-foreground border-t border-border whitespace-nowrap">{money(shownTotal)}</td>
                <td className="hidden md:table-cell border-t border-border" />
              </tr>
            </tfoot>
          </DataTable>
        </div>
      )}
    </div>
  )
}
