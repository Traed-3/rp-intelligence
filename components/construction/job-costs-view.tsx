import Link from 'next/link'
import { money, fmtDate } from '@/lib/construction'
import type { JobCosts, Purchase } from '@/lib/job-costs'
import { SectionCard } from '@/components/ui/section-card'
import { StatusPill } from '@/components/ui/status-pill'

const SOURCE_LABEL: Record<Purchase['source'], string> = {
  vendor_invoice: 'Vendor invoice',
  receipt: 'Receipt',
  packing_slip: 'Packing slip',
  expense: 'Receipt',
  manual: 'Typed in',
}

const qty = (n: number | null) => (n == null ? '' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

function purchaseHref(p: Purchase): string | null {
  if (p.expenseId) return `/expenses/${p.expenseId}`
  if (p.documentId) return `/inventory/receive/queue/${p.documentId}`
  return null
}

/** One order / receipt with the lines read off the paper. */
function PurchaseRow({ p, showLabel }: { p: Purchase; showLabel?: boolean }) {
  const href = purchaseHref(p)
  const head = [p.vendor, p.reference && `#${p.reference}`, p.date && fmtDate(p.date)].filter(Boolean).join(' · ')
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="font-medium text-foreground">{p.description}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{head || '—'}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showLabel && <StatusPill tone="neutral">{p.label}</StatusPill>}
          <StatusPill tone="neutral">{SOURCE_LABEL[p.source]}</StatusPill>
          {p.received && <StatusPill tone="success">Received</StatusPill>}
          <span className="w-28 text-right font-semibold tabular-nums text-foreground">{p.amount == null ? <span className="text-muted-foreground font-normal">no total yet</span> : money(p.amount)}</span>
        </div>
      </div>

      {p.lines.length > 0 && (
        <div className="rp-table-wrap mt-2.5">
          <table className="w-full text-xs">
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-3 w-12 text-right tabular-nums text-muted-foreground">{qty(l.qty)}</td>
                  <td className="py-1 pr-3 w-40 font-mono text-muted-foreground break-all">{l.partNumber ?? ''}</td>
                  <td className="py-1 pr-3 text-foreground">{l.description}{l.backordered && <span className="ml-2 text-warning">backordered</span>}</td>
                  <td className="py-1 pr-3 w-24 text-right tabular-nums text-muted-foreground">{l.unitCost == null ? '' : `${money(l.unitCost)} ea`}</td>
                  <td className="py-1 w-24 text-right tabular-nums text-foreground">{l.lineTotal == null ? '' : money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(p.notes.length > 0 || href || p.receiptUrl) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {p.notes.map((n) => <span key={n} className="text-warning">{n}</span>)}
          {href && <Link href={href} className="text-info hover:underline">Open the paperwork</Link>}
          {p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-info hover:underline">Receipt</a>}
        </div>
      )}
    </li>
  )
}

export type SiblingPurchases = { jobId: string; label: string; count: number }[]

function Siblings({ rows }: { rows: SiblingPurchases }) {
  if (!rows.length) return null
  return (
    <p className="text-xs text-muted-foreground px-1">
      This site&apos;s other projects have purchases too:{' '}
      {rows.map((r, i) => (
        <span key={r.jobId}>
          {i > 0 && ', '}
          <Link href={`/construction/jobs/${r.jobId}?tab=materials`} className="text-info hover:underline">{r.label}</Link> ({r.count})
        </span>
      ))}
      . A purchase goes to the project that was open on its date.
    </p>
  )
}

/** Materials tab: every order, invoice, packing slip and receipt for material on this job. */
export function JobMaterialOrders({ costs, siblings }: { costs: JobCosts; siblings: SiblingPurchases }) {
  const orders = costs.materials.filter((p) => p.source !== 'manual')
  return (
    <div className="space-y-2">
      <SectionCard
        flush
        title={`Orders and purchases (${orders.length})`}
        hint="From the vendor invoices, packing slips and receipts emailed in for this job."
        action={<span className="text-sm font-semibold text-foreground tabular-nums">{money(orders.reduce((a, p) => a + (p.amount ?? 0), 0))}</span>}
      >
        {orders.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No vendor invoice, packing slip or receipt has come in for this job yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">{orders.map((p) => <PurchaseRow key={p.key} p={p} />)}</ul>
        )}
      </SectionCard>
      {costs.unpricedOrders > 0 && (
        <p className="text-xs text-warning px-1">
          {costs.unpricedOrders} order{costs.unpricedOrders === 1 ? ' has' : 's have'} a packing slip but no invoice or receipt with a total yet, so {costs.unpricedOrders === 1 ? 'it is' : 'they are'} not in the cost.
        </p>
      )}
      <Siblings rows={siblings} />
    </div>
  )
}

/** The job priced the way the invoice will be: labor, trips, disposables, materials and expenses with their markup. */
export function InvoicePreviewCard({ costs }: { costs: JobCosts }) {
  const v = costs.invoice
  const days = new Set(costs.labor.filter((l) => l.date && l.crew > 0).map((l) => l.date)).size
  const rows: { label: string; how: string; amount: number }[] = [
    { label: 'Labor', how: `${costs.laborHours} man-hours${v.laborRate ? ` x ${money(v.laborRate)}` : ''}`, amount: v.labor },
    { label: 'Trips', how: `${v.tripCount} (one per tech per day, ${days} day${days === 1 ? '' : 's'})${v.tripRate ? ` x ${money(v.tripRate)}` : ''}`, amount: v.trips },
    { label: 'Disposables', how: 'One line for the job', amount: v.disposables },
    { label: 'Materials', how: `${money(v.materialsCost)} cost; parts +20%, everything else +15%`, amount: v.materials },
    { label: 'Other expenses', how: `${money(v.otherCost)} cost +15%`, amount: v.other },
  ]
  return (
    <SectionCard
      flush
      title="Invoice preview"
      hint="What this job would bill for at time and material, from what is on file today. A job with an approved bid bills the bid instead."
      action={<span className="text-sm font-semibold text-foreground tabular-nums">{money(v.total)}</span>}
    >
      <div className="rp-table-wrap">
        <table className="rp-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="px-5 py-2.5 font-medium text-foreground w-44">{r.label}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.how}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-foreground">{money(r.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="px-5 py-3 font-semibold text-foreground">Total</td>
              <td className="px-3 py-3 text-muted-foreground">Before tax. Equipment (compressor, lift) and anything not on a ticket or receipt yet is not in it.</td>
              <td className="px-5 py-3 text-right tabular-nums font-semibold text-foreground">{money(v.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {costs.unpricedOrders > 0 && (
        <p className="px-5 py-3 text-xs text-warning border-t border-hairline">
          {costs.unpricedOrders} order{costs.unpricedOrders === 1 ? ' has' : 's have'} a packing slip but no invoice with a total yet, so {costs.unpricedOrders === 1 ? 'it is' : 'they are'} not in this figure.
        </p>
      )}
    </SectionCard>
  )
}

/** Cost Summary: where the money went, line by line. */
export function JobCostBreakdown({ costs, siblings, laborAction }: {
  costs: JobCosts
  siblings: SiblingPurchases
  /** rendered under the labor table (the manual labor form) */
  laborAction?: React.ReactNode
}) {
  return (
    <div className="space-y-5">
      <SectionCard flush title={`Materials (${costs.materials.length})`} action={<span className="text-sm font-semibold text-foreground tabular-nums">{money(costs.materialCost)}</span>}>
        {costs.materials.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No material purchases on this job yet.</p>
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th className="px-5 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Vendor</th><th className="px-3 py-2 text-left">What</th><th className="px-3 py-2 text-left">Paper</th><th className="px-3 py-2 text-right">Cost</th><th className="px-5 py-2 text-right">Bills at</th></tr></thead>
              <tbody>
                {costs.materials.map((p) => {
                  const href = purchaseHref(p)
                  return (
                    <tr key={p.key}>
                      <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground">{p.date ? fmtDate(p.date) : '—'}</td>
                      <td className="px-3 py-2.5 text-foreground">{p.vendor ?? '—'}</td>
                      <td className="px-3 py-2.5 text-foreground">
                        {href ? <Link href={href} className="hover:underline">{p.description}</Link> : p.description}
                        {p.notes.map((n) => <div key={n} className="text-xs text-warning">{n}</div>)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{SOURCE_LABEL[p.source]}{p.reference ? ` #${p.reference}` : ''}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.amount == null ? '—' : money(p.amount)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-foreground whitespace-nowrap">{p.billed == null ? '—' : <>{money(p.billed)} <span className="text-xs text-muted-foreground">+{Math.round(p.markupPct * 100)}%</span></>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        flush
        title={`Other job expenses (${costs.others.length})`}
        hint={costs.otherByLabel.length ? costs.otherByLabel.map((l) => `${l.label} ${money(l.amount)}`).join(' · ') : 'Hotels, permits, electricians, pump-outs and anything else charged to this job.'}
        action={<span className="text-sm font-semibold text-foreground tabular-nums">{money(costs.otherCost)}</span>}
      >
        {costs.others.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Nothing else has been charged to this job.</p>
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th className="px-5 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Kind</th><th className="px-3 py-2 text-left">Vendor</th><th className="px-3 py-2 text-left">What</th><th className="px-3 py-2 text-right">Cost</th><th className="px-5 py-2 text-right">Bills at</th></tr></thead>
              <tbody>
                {costs.others.map((p) => {
                  const href = purchaseHref(p)
                  return (
                    <tr key={p.key}>
                      <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground">{p.date ? fmtDate(p.date) : '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{p.label}</td>
                      <td className="px-3 py-2.5 text-foreground">{p.vendor ?? '—'}</td>
                      <td className="px-3 py-2.5 text-foreground">
                        {href ? <Link href={href} className="hover:underline">{p.description}</Link> : p.description}
                        {p.notes.map((n) => <div key={n} className="text-xs text-warning">{n}</div>)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{p.amount == null ? '—' : money(p.amount)}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-foreground whitespace-nowrap">{p.billed == null ? '—' : <>{money(p.billed)} <span className="text-xs text-muted-foreground">+{Math.round(p.markupPct * 100)}%</span></>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        flush
        title={`Labor (${costs.laborHours} man-hours)`}
        hint="On-site hours from the crew's field tickets and daily updates, plus anything logged below."
        action={<span className="text-sm font-semibold text-foreground tabular-nums">{money(costs.laborCost)}</span>}
      >
        {costs.labor.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No field ticket, daily update or labor entry with hours on this job yet.</p>
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead><tr><th className="px-5 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Who</th><th className="px-3 py-2 text-left">From</th><th className="px-3 py-2 text-right">Man-hours</th><th className="px-3 py-2 text-right">Rate</th><th className="px-5 py-2 text-right">Bills at</th></tr></thead>
              <tbody>
                {costs.labor.map((l, i) => (
                  <tr key={`${l.date}-${i}`}>
                    <td className="px-5 py-2.5 whitespace-nowrap text-muted-foreground">{l.date ? fmtDate(l.date) : '—'}</td>
                    <td className="px-3 py-2.5 text-foreground">{l.who}{l.note && <div className="text-xs text-muted-foreground">{l.note}</div>}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{l.source}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{l.manHours}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{l.rate ? money(l.rate) : '—'}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">{money(l.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {laborAction}
      </SectionCard>

      <Siblings rows={siblings} />
    </div>
  )
}
