import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, CheckCircle2, Circle } from 'lucide-react'
import { ClickableRow } from '@/components/clickable-row'
import { buttonVariants } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChip } from '@/components/ui/filter-chip'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/components/ui/section-card'
import { StatTile } from '@/components/ui/stat-tile'
import { StatusPill, type Tone } from '@/components/ui/status-pill'
import { cardAuditViewer, loadCardAudit } from '@/lib/card-audit-data'
import { FLAG_LABEL, totalsByPerson, type AuditRow, type Flag } from '@/lib/card-audit'
import { setStatementMatch } from './actions'

const money = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const FLAG_TONE: Record<Flag, Tone> = {
  duplicate: 'danger',
  amount_mismatch: 'warning',
  refund: 'info',
  policy: 'danger',
  no_amount: 'warning',
  no_job: 'neutral',
}

type Show = 'all' | 'review' | 'unmatched'
const needsReview = (r: AuditRow) => r.flags.some(f => f !== 'no_job')

export default async function CardAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string; month?: string; show?: string }>
}) {
  const sp = await searchParams
  const viewer = await cardAuditViewer()
  if (!viewer) redirect('/login')
  if (!viewer.allowed) {
    return <div className="rp-page max-w-3xl"><EmptyState>The card and account audit is limited to owners, managers and office staff.</EmptyState></div>
  }

  const { range, rows, methods, code } = await loadCardAudit(viewer.company_id, sp.card ?? 'TEC', sp.month)
  const show: Show = sp.show === 'review' || sp.show === 'unmatched' ? sp.show : 'all'
  const visible = rows.filter(r => show === 'all' || (show === 'review' ? needsReview(r) : !r.matched))
  const people = totalsByPerson(rows)
  const total = rows.reduce((s, r) => s + (r.amount ?? r.receiptTotal ?? 0), 0)
  const matchedTotal = rows.filter(r => r.matched).reduce((s, r) => s + (r.amount ?? r.receiptTotal ?? 0), 0)
  const reviewCount = rows.filter(needsReview).length
  const href = (p: { card?: string; month?: string; show?: Show }) => {
    const q = new URLSearchParams({ card: p.card ?? code, month: p.month ?? range.ym })
    const s = p.show ?? show
    if (s !== 'all') q.set('show', s)
    return `/expenses/cards?${q}`
  }
  const cardName = methods.find(m => m.code.toUpperCase() === code)?.name ?? code
  const isAccount = (m: { name?: string | null }) => /\(account\)/i.test(m.name ?? '')
  const cards = methods.filter(m => !isAccount(m))
  const accounts = methods.filter(isAccount)
  const bill = accounts.some(m => m.code.toUpperCase() === code) ? 'bill' : 'statement'

  return (
    <div className="rp-page">
      <PageHeader
        crumbs={[{ label: 'Expenses', href: '/expenses' }, { label: 'Card & account audit' }]}
        title="Card & Account Audit"
        description={<><b className="text-foreground">{cardName}</b> · every receipt emailed in with <b className="font-mono text-foreground">{code}</b> in the subject, flagged for duplicates, refunds and amounts that do not match the receipt.</>}
        actions={
          <a href={`/api/expenses/card-audit-csv?card=${encodeURIComponent(code)}&month=${range.ym}`} className={buttonVariants({ variant: 'outline' })}>
            <Download />Export CSV
          </a>
        }
      />

      {/* Card + month pickers */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="w-full sm:w-auto sm:flex-1 space-y-2">
          {/* Every card and every vendor account can be audited the same way. Code on the chip, full name on hover. */}
          {([['Cards', cards], ['Accounts', accounts]] as const).filter(([, list]) => list.length > 0).map(([label, list]) => (
            <div key={label} className="flex flex-wrap items-center gap-1.5">
              <span className="rp-label w-20 shrink-0">{label}</span>
              {list.map(m => (
                <FilterChip key={m.code} href={href({ card: m.code })} active={m.code.toUpperCase() === code} className="font-mono !px-2.5 !py-1">
                  <span title={m.name ?? m.code}>{m.code}</span>
                </FilterChip>
              ))}
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1 self-start">
          <Link href={href({ month: range.prev })} className={buttonVariants({ variant: 'outline', size: 'icon' })} aria-label="Previous month"><ChevronLeft /></Link>
          <span className="px-3 text-sm font-semibold text-foreground min-w-36 text-center">{range.label}</span>
          <Link href={href({ month: range.next })} className={buttonVariants({ variant: 'outline', size: 'icon' })} aria-label="Next month"><ChevronRight /></Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={rows.length} label={`Receipts · ${people.length} ${people.length === 1 ? 'person' : 'people'}`} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={money(total)} label={`Total for ${code}, from the email subjects`} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={reviewCount} tone={reviewCount > 0 ? 'danger' : undefined} label="Need review: duplicates, mismatches, refunds, policy" href={href({ show: 'review' })} />
        <StatTile className="[&_.rp-stat-value]:text-[1.75rem] max-sm:[&_.rp-stat-value]:text-2xl" value={`${rows.filter(r => r.matched).length} / ${rows.length}`} label={`Matched to the ${bill} · ${money(matchedTotal)}`} />
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="rp-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-hairline">
            {([['all', 'All', rows.length], ['review', 'Needs review', reviewCount], ['unmatched', 'Not matched', rows.filter(r => !r.matched).length]] as const).map(([v, l, c]) => (
              <FilterChip key={v} href={href({ show: v })} active={show === v} count={c}>{l}</FilterChip>
            ))}
            {visible.some(r => !r.matched) && (
              <form action={setStatementMatch} className="ml-auto">
                <input type="hidden" name="matched" value="1" />
                {visible.filter(r => !r.matched).map(r => <input key={r.id} type="hidden" name="id" value={r.id} />)}
                <button className="text-xs font-medium text-success hover:underline">Mark all shown as matched</button>
              </form>
            )}
          </div>
          {visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">No {code} receipts here for {range.label}.</p>
          ) : (
            <DataTable>
                <thead>
                  <tr className="text-left">
                    <th className="px-3 py-2 w-10">On bill</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Who</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Vendor / what for</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(r => (
                    <ClickableRow key={r.id} href={`/inventory/receive/queue/${r.id}`} className={needsReview(r) ? 'bg-danger-soft/50' : ''}>
                      <td className="px-3 py-2">
                        <form action={setStatementMatch}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="matched" value={r.matched ? '0' : '1'} />
                          <button aria-label={r.matched ? 'Un-match' : 'Mark matched'} title={r.matched ? 'Matched — click to undo' : `Mark matched to the ${bill}`}>
                            {r.matched ? <CheckCircle2 className="w-5 h-5 text-success" /> : <Circle className="w-5 h-5 text-gray-300 hover:text-success" />}
                          </button>
                        </form>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.date.slice(5).replace('-', '/')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.who}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                        {money(r.amount)}
                        {r.flags.includes('amount_mismatch') && <div className="text-xs font-normal text-warning">receipt {money(r.receiptTotal)}</div>}
                      </td>
                      <td className="px-3 py-2 min-w-64">
                        <div className="text-gray-900">{r.vendor || <span className="text-gray-400">vendor not read yet</span>}</div>
                        <div className="text-xs text-gray-500 line-clamp-2">{r.description}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{r.job ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.flags.map(f => <StatusPill key={f} tone={FLAG_TONE[f]}>{FLAG_LABEL[f]}</StatusPill>)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">Receipt →</td>
                    </ClickableRow>
                  ))}
                </tbody>
            </DataTable>
          )}
        </div>

        <SectionCard title="By person" flush>
          <div>
            {people.map(p => (
              <div key={p.who} className="px-4 py-2.5 flex items-center justify-between border-b border-hairline">
                <div>
                  <p className="text-sm font-medium text-gray-900">{p.who}</p>
                  <p className="text-xs text-gray-400">{p.count} receipt{p.count === 1 ? '' : 's'}{p.flagged ? <span className="text-danger"> · {p.flagged} to review</span> : null}</p>
                </div>
                <p className="text-sm font-bold text-gray-900">{money(p.total)}</p>
              </div>
            ))}
            <div className="px-4 py-2.5 bg-raised flex justify-between text-sm font-bold"><span>Total</span><span>{money(total)}</span></div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
