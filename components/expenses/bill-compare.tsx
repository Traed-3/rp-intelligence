'use client'

import { useState } from 'react'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/**
 * Type the total off the bill and see how far the receipts are from it.
 * Nothing is saved: it is a scratch pad for the month's reconciliation.
 */
export function BillCompare({ receiptsTotal, checkedTotal, label }: { receiptsTotal: number; checkedTotal: number; label: string }) {
  const [bill, setBill] = useState('')
  const n = Number(bill.replace(/[$,\s]/g, ''))
  const has = bill.trim() !== '' && Number.isFinite(n)
  const diff = has ? n - receiptsTotal : 0
  const even = Math.abs(diff) < 0.005
  return (
    <div className="rp-card p-4 print:hidden">
      <p className="rp-label mb-2">Compare to the bill</p>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="text-xs text-gray-500">
          Total on the {label} bill
          <input
            inputMode="decimal" value={bill} onChange={e => setBill(e.target.value)} placeholder="0.00"
            className="rp-input mt-1 !w-36"
          />
        </label>
        <div>
          <p className="text-xs text-gray-500">Receipts shown</p>
          <p className="text-sm font-bold text-foreground tabular-nums">{money(receiptsTotal)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Checked off so far</p>
          <p className="text-sm font-bold text-foreground tabular-nums">{money(checkedTotal)}</p>
        </div>
        {has && (
          <div>
            <p className="text-xs text-gray-500">Difference</p>
            <p className={`text-sm font-bold ${even ? 'text-success' : 'text-danger'}`}>
              {even ? 'Matches the bill' : diff > 0
                ? `${money(diff)} on the bill with no receipt`
                : `${money(-diff)} more in receipts than on the bill`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
