import { Fragment } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Download, FileText } from 'lucide-react'
import { ClickableRow } from '@/components/clickable-row'
import { PrintButton } from '@/components/construction/print-button'
import { BillCompare } from '@/components/expenses/bill-compare'
import { ReceiptCheck, ReceiptCheckAll } from '@/components/expenses/receipt-check'
import {
  NO_CODE, loadReceiptReport, money, parseFilters, rangeLabel, receiptReportViewer, receiptsHref, recentMonths, shortDate,
  type ReceiptFilters, type ReceiptRow,
} from '@/lib/receipt-report'

const pill = (on: boolean) =>
  `px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-gray-400'}`
const field = 'mt-1 block w-full px-3 py-1.5 text-sm text-gray-900 bg-card border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'

function ReceiptLink({ r }: { r: ReceiptRow }) {
  if (!r.receiptUrl) return <span className="text-xs text-gray-300">none</span>
  return (
    <a href={r.receiptUrl} target="_blank" rel="noopener noreferrer" title="Open the receipt in a new tab"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800">
      {r.receiptIsImage
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={r.receiptUrl} alt="" loading="lazy" className="w-9 h-9 object-cover rounded border border-gray-200" />
        : <FileText className="w-5 h-5" />}
      Open
    </a>
  )
}

export default async function ReceiptsByPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const viewer = await receiptReportViewer()
  if (!viewer) redirect('/login')
  if (!viewer.allowed) redirect('/')

  const f: ReceiptFilters = parseFilters(await searchParams)
  const report = await loadReceiptReport(viewer.company_id, f)
  const { codes, people, rows, groups } = report
  const months = recentMonths(4)
  const payLabel = !f.pay ? 'All payment types' : f.pay === NO_CODE ? 'No payment code' : `${f.pay} · ${report.nameOf(f.pay)}`
  const person = f.who ? people.find(p => p.whoKey === f.who) : null
  const openIds = rows.filter(r => !r.checked).map(r => r.id)
  const checkedIds = rows.filter(r => r.checked).map(r => r.id)
  const canCheck = viewer.canCheck
  // With one payment type picked, the summary shrinks to that type so the receipts sit near the top.
  const shownCodes = f.pay ? codes.filter(c => (c.code || NO_CODE) === f.pay) : codes

  return (
    <div className="p-6 max-w-7xl mx-auto print:p-0 print:max-w-none">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs text-gray-500 print:hidden"><Link href="/expenses" className="hover:underline">Expenses</Link> / Receipts by payment type</p>
          <h1 className="rp-title">Receipts by Payment Type</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {payLabel}{person ? ` · ${person.who}` : ''} · {rangeLabel(f)}
            {f.show !== 'all' ? ` · ${f.show === 'open' ? 'not checked off' : 'checked off'} only` : ''}{f.q ? ` · “${f.q}”` : ''}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <a href={receiptsHref(f, {}, '/api/expenses/receipts-csv')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-600/90">
            <Download className="w-4 h-4" />Export CSV
          </a>
          <PrintButton />
        </div>
      </div>

      {/* Filters */}
      <div className="print:hidden">
        <div className="flex flex-wrap gap-2 mb-3">
          {months.map(m => (
            <Link key={m.ym} href={receiptsHref(f, { from: m.from, to: m.to })} className={pill(f.from === m.from && f.to === m.to)}>{m.label}</Link>
          ))}
          <Link href={receiptsHref(f, { from: `${months[0].from.slice(0, 4)}-01-01`, to: months[0].to })}
            className={pill(f.from === `${months[0].from.slice(0, 4)}-01-01` && f.to === months[0].to)}>This year</Link>
        </div>
        <form method="GET" className="rp-card p-4 mb-5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 items-end">
          <label className="text-xs text-gray-500">From
            <input type="date" name="from" defaultValue={f.from} className={field} />
          </label>
          <label className="text-xs text-gray-500">To
            <input type="date" name="to" defaultValue={f.to} className={field} />
          </label>
          <label className="text-xs text-gray-500">Payment type
            <select name="pay" defaultValue={f.pay} className={field}>
              <option value="">All payment types</option>
              {codes.map(c => <option key={c.code || NO_CODE} value={c.code || NO_CODE}>{c.code ? `${c.code} — ${c.name}` : 'No payment code'}</option>)}
              {f.pay && !codes.some(c => (c.code || NO_CODE) === f.pay) && <option value={f.pay}>{f.pay}</option>}
            </select>
          </label>
          <label className="text-xs text-gray-500">Person
            <select name="who" defaultValue={f.who} className={field}>
              <option value="">Everyone</option>
              {people.map(p => <option key={p.whoKey} value={p.whoKey}>{p.who}</option>)}
              {f.who && !person && <option value={f.who}>{f.who}</option>}
            </select>
          </label>
          <label className="text-xs text-gray-500">Show
            <select name="show" defaultValue={f.show} className={field}>
              <option value="all">All receipts</option>
              <option value="open">Not checked off</option>
              <option value="checked">Checked off</option>
            </select>
          </label>
          <div className="flex gap-2">
            <label className="text-xs text-gray-500 flex-1">Search
              <input name="q" defaultValue={f.q} placeholder="vendor, job, amount" className={field} />
            </label>
            <button type="submit" className="self-end px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">Show</button>
          </div>
        </form>
      </div>

      {/* Spend by payment type */}
      <div className="rp-card overflow-hidden mb-5 print:mb-4 print:break-inside-avoid">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-sm text-gray-900">Spent by payment type · {rangeLabel(f)}</h2>
          {f.pay
            ? <Link href={receiptsHref(f, { pay: '', who: '' })} className="text-xs font-medium text-blue-600 hover:underline print:hidden">Show all payment types</Link>
            : <span className="text-xs text-gray-500">{report.grandCount} receipt{report.grandCount === 1 ? '' : 's'}</span>}
        </div>
        {shownCodes.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">No {f.pay && f.pay !== NO_CODE ? `${f.pay} ` : ''}receipts between {shortDate(f.from)} and {shortDate(f.to)}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2">Payment type</th>
                  <th className="px-4 py-2 text-right">Receipts</th>
                  <th className="px-4 py-2 text-right">Checked off</th>
                  <th className="px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {shownCodes.map(c => {
                  const key = c.code || NO_CODE
                  const active = f.pay === key
                  return (
                    <Fragment key={key}>
                      <tr className={active ? 'bg-blue-50/60' : ''}>
                        <td className="px-4 py-2">
                          <Link href={receiptsHref(f, { pay: active && !f.who ? '' : key, who: '' })} className="font-medium text-gray-900 hover:underline">
                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded mr-2">{c.code || '—'}</span>{c.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">{c.count}</td>
                        <td className={`px-4 py-2 text-right ${c.checked === c.count ? 'text-green-700 font-medium' : 'text-gray-600'}`}>{c.checked} of {c.count}</td>
                        <td className="px-4 py-2 text-right font-bold text-gray-900">{money(c.total)}</td>
                      </tr>
                      {/* A code shared by several people (every tech has their own TEC card) is split by person. */}
                      {c.people.length > 1 && c.people.map(p => (
                        <tr key={`${key}|${p.whoKey}`} className={active && f.who === p.whoKey ? 'bg-blue-50/60' : 'bg-gray-50/40'}>
                          <td className="pl-12 pr-4 py-1.5">
                            <Link href={receiptsHref(f, { pay: key, who: p.whoKey })} className="text-gray-700 hover:underline">{p.who}</Link>
                            {p.email && <span className="ml-2 text-xs text-gray-400">{p.email}</span>}
                          </td>
                          <td className="px-4 py-1.5 text-right text-gray-500">{p.count}</td>
                          <td className={`px-4 py-1.5 text-right ${p.checked === p.count ? 'text-green-700' : 'text-gray-500'}`}>{p.checked} of {p.count}</td>
                          <td className="px-4 py-1.5 text-right text-gray-800">{money(p.total)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot className={f.pay ? 'hidden' : ''}>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td className="px-4 py-2.5 text-gray-700">Total</td>
                  <td className="px-4 py-2.5 text-right text-gray-700">{report.grandCount}</td>
                  <td />
                  <td className="px-4 py-2.5 text-right text-gray-900">{money(report.grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {f.pay && rows.length > 0 && (
        <div className="mb-5">
          <BillCompare receiptsTotal={report.total} checkedTotal={report.checkedTotal} label={f.pay === NO_CODE ? '' : f.pay} />
        </div>
      )}

      {/* The receipts */}
      <div className="rp-card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="font-semibold text-sm text-gray-900">
            {rows.length} receipt{rows.length === 1 ? '' : 's'} · {money(report.total)}
          </h2>
          <span className="text-xs text-gray-500">{report.checkedCount} checked off ({money(report.checkedTotal)}) · {rows.length - report.checkedCount} to go ({money(report.total - report.checkedTotal)})</span>
          {canCheck && (
            <span className="ml-auto flex gap-4 print:hidden">
              <ReceiptCheckAll ids={openIds} checked label="Check off all shown" />
              <ReceiptCheckAll ids={checkedIds} checked={false} label="Clear all shown" />
            </span>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">No receipts match. Widen the dates or clear a filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2 w-12">On bill</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Sent by</th>
                  <th className="px-3 py-2">Vendor / what it was</th>
                  <th className="px-3 py-2">Charged to</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 print:hidden">Receipt</th>
                </tr>
              </thead>
              {groups.map(g => {
                const sub = g.rows.reduce((s, r) => s + r.amount, 0)
                return (
                  <tbody key={`${g.code}|${g.person.whoKey}`} className="divide-y divide-gray-50 print:break-inside-auto">
                    <tr className="bg-gray-50 border-y border-gray-200">
                      <td colSpan={5} className="px-3 py-2 text-xs font-semibold text-gray-800">
                        <span className="font-mono bg-card border border-gray-200 px-1.5 py-0.5 rounded mr-2">{g.code || 'no code'}</span>
                        {g.person.who}
                        {g.person.email && <span className="ml-2 font-normal text-gray-500">{g.person.email}</span>}
                        <span className="ml-2 font-normal text-gray-500">· {g.rows.length} receipt{g.rows.length === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs font-bold text-gray-900 whitespace-nowrap">{money(sub)}</td>
                      <td className="print:hidden" />
                    </tr>
                    {g.rows.map(r => (
                      <ClickableRow key={r.id} href={`/expenses/${r.id}`} className={r.checked ? 'bg-green-50/40' : ''}>
                        <td className="px-3 py-2">
                          <span className="print:hidden"><ReceiptCheck id={r.id} checked={r.checked} canEdit={canCheck} /></span>
                          {/* On paper: a filled box when it is already checked off, an empty one to tick by hand. */}
                          <span className="hidden print:inline text-base leading-none">{r.checked ? '☑' : '☐'}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{shortDate(r.date)}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-800">{r.who}</td>
                        <td className="px-3 py-2 min-w-56">
                          <div className="text-gray-900">{r.vendor || <span className="text-gray-400">No vendor</span>}</div>
                          {r.description && <div className="text-xs text-gray-500">{r.description}</div>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                          {r.chargedTo}
                          {r.cardLast4 && <div className="text-xs text-gray-400">card …{r.cardLast4}</div>}
                        </td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${r.amount < 0 ? 'text-blue-700' : 'text-gray-900'}`}>{money(r.amount)}</td>
                        <td className="px-3 py-2 print:hidden"><ReceiptLink r={r} /></td>
                      </ClickableRow>
                    ))}
                  </tbody>
                )
              })}
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-bold">
                  <td colSpan={5} className="px-3 py-2.5 text-gray-700">Total</td>
                  <td className="px-3 py-2.5 text-right text-gray-900 whitespace-nowrap">{money(report.total)}</td>
                  <td className="print:hidden" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
