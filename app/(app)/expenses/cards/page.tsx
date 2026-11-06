import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, CheckCircle2, Circle } from 'lucide-react'
import { ClickableRow } from '@/components/clickable-row'
import { cardAuditViewer, loadCardAudit } from '@/lib/card-audit-data'
import { FLAG_LABEL, totalsByPerson, type AuditRow, type Flag } from '@/lib/card-audit'
import { setStatementMatch } from './actions'

const money = (n: number | null) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const FLAG_STYLE: Record<Flag, string> = {
  duplicate: 'bg-red-100 text-red-800',
  amount_mismatch: 'bg-orange-100 text-orange-800',
  refund: 'bg-blue-100 text-blue-800',
  policy: 'bg-purple-100 text-purple-800',
  no_amount: 'bg-yellow-100 text-yellow-800',
  no_job: 'bg-gray-100 text-gray-600',
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
    return <div className="p-6 max-w-3xl mx-auto text-sm text-gray-600">Card audit is limited to owners, managers and the office.</div>
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs text-gray-500"><Link href="/expenses" className="hover:underline">Expenses</Link> / Card audit</p>
          <h1 className="inline-flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight before:content-[''] before:w-1.5 before:h-7 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">Card Audit</h1>
          <p className="text-sm text-gray-500 mt-0.5">Every receipt emailed in with <b>{code}</b> in the subject, ready to check against the {cardName} statement.</p>
        </div>
        <a href={`/api/expenses/card-audit-csv?card=${code}&month=${range.ym}`}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">
          <Download className="w-4 h-4" />Export CSV
        </a>
      </div>

      {/* Card + month pickers */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {methods.map(m => (
          <Link key={m.code} href={href({ card: m.code })}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border ${m.code.toUpperCase() === code ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {m.name} <span className="opacity-60">({m.code})</span>
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Link href={href({ month: range.prev })} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50" aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></Link>
          <span className="px-3 text-sm font-semibold text-gray-900 min-w-36 text-center">{range.label}</span>
          <Link href={href({ month: range.next })} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50" aria-label="Next month"><ChevronRight className="w-4 h-4" /></Link>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Receipts', value: String(rows.length), sub: `${people.length} people` },
          { label: 'Total on card', value: money(total), sub: 'from subject lines' },
          { label: 'Need review', value: String(reviewCount), sub: 'duplicates, mismatches, refunds, policy', warn: reviewCount > 0 },
          { label: 'Matched to statement', value: `${rows.filter(r => r.matched).length} / ${rows.length}`, sub: money(matchedTotal) },
        ].map(t => (
          <div key={t.label} className={`bg-white rounded-2xl border p-4 shadow-sm ${t.warn ? 'border-red-200' : 'border-gray-200'}`}>
            <p className={`text-2xl font-bold ${t.warn ? 'text-red-600' : 'text-gray-900'}`}>{t.value}</p>
            <p className="text-xs font-medium text-gray-700">{t.label}</p>
            <p className="text-xs text-gray-400">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
            {([['all', `All (${rows.length})`], ['review', `Needs review (${reviewCount})`], ['unmatched', `Not matched (${rows.filter(r => !r.matched).length})`]] as const).map(([v, l]) => (
              <Link key={v} href={href({ show: v })}
                className={`px-3 py-1 text-xs font-medium rounded-full border ${show === v ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{l}</Link>
            ))}
            {visible.some(r => !r.matched) && (
              <form action={setStatementMatch} className="ml-auto">
                <input type="hidden" name="matched" value="1" />
                {visible.filter(r => !r.matched).map(r => <input key={r.id} type="hidden" name="id" value={r.id} />)}
                <button className="text-xs font-medium text-green-700 hover:underline">Mark all shown as matched</button>
              </form>
            )}
          </div>
          {visible.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">No {code} receipts here for {range.label}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-3 py-2 w-10">On stmt</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Who</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Vendor / what for</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visible.map(r => (
                    <ClickableRow key={r.id} href={`/inventory/receive/queue/${r.id}`} className={needsReview(r) ? 'bg-red-50/40' : ''}>
                      <td className="px-3 py-2">
                        <form action={setStatementMatch}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="matched" value={r.matched ? '0' : '1'} />
                          <button aria-label={r.matched ? 'Un-match' : 'Mark matched'} title={r.matched ? 'Matched — click to undo' : 'Mark matched to statement'}>
                            {r.matched ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Circle className="w-5 h-5 text-gray-300 hover:text-green-500" />}
                          </button>
                        </form>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{r.date.slice(5).replace('-', '/')}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.who}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                        {money(r.amount)}
                        {r.flags.includes('amount_mismatch') && <div className="text-xs font-normal text-orange-700">receipt {money(r.receiptTotal)}</div>}
                      </td>
                      <td className="px-3 py-2 min-w-64">
                        <div className="text-gray-900">{r.vendor || <span className="text-gray-400">vendor not read yet</span>}</div>
                        <div className="text-xs text-gray-500 line-clamp-2">{r.description}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-700">{r.job ?? '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.flags.map(f => <span key={f} className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${FLAG_STYLE[f]}`}>{FLAG_LABEL[f]}</span>)}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">Receipt →</td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50"><h2 className="font-semibold text-sm text-gray-900">By person</h2></div>
          <div className="divide-y divide-gray-50">
            {people.map(p => (
              <div key={p.who} className="px-4 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{p.who}</p>
                  <p className="text-xs text-gray-400">{p.count} receipt{p.count === 1 ? '' : 's'}{p.flagged ? <span className="text-red-600"> · {p.flagged} to review</span> : null}</p>
                </div>
                <p className="text-sm font-bold text-gray-900">{money(p.total)}</p>
              </div>
            ))}
            <div className="px-4 py-2.5 bg-gray-50 flex justify-between text-sm font-bold"><span>Total</span><span>{money(total)}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
