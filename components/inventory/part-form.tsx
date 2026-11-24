'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/inventory/actions'
import { PART_CATEGORIES, type Part } from '@/lib/inventory'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

const ITEM_TYPES = ['material', 'labor', 'trip', 'equipment', 'disposables', 'sub', 'permit', 'service', 'lodging']
const COST_SOURCES = [
  { value: 'receipt',      label: 'Receipt (green)' },
  { value: 'vendor_quote', label: 'Vendor quote (green)' },
  { value: 'book',         label: 'Price book' },
  { value: 'web',          label: 'Web price (blue)' },
  { value: 'estimate',     label: 'Estimate (pink)' },
]
const PRICE_STATUSES = [
  { value: 'ok',           label: 'Priced' },
  { value: 'price_needed', label: 'Price needed' },
  { value: 'verify',       label: 'Verify (older than 6 months)' },
  { value: 'held_high',    label: 'Held high (two receipts disagree)' },
]

export function PartForm({
  action,
  part,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  part?: Part
}) {
  const [state, formAction, isPending] = useActionState(action, {} as ActionState)
  const p = part

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}
      {state?.ok && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Saved.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className={lbl} htmlFor="part-description">Description <span className="text-red-500">*</span></label>
          <input id="part-description" name="description" className={inp} defaultValue={p?.description ?? ''} required placeholder="OPW 71SO-410C drop tube, cut to length" />
        </div>
        <div>
          <label className={lbl} htmlFor="part-number">Part number</label>
          <input id="part-number" name="part_number" className={inp} defaultValue={p?.part_number ?? ''} placeholder="71SO-410C" />
        </div>
        <div>
          <label className={lbl} htmlFor="part-manufacturer">Manufacturer</label>
          <input id="part-manufacturer" name="manufacturer" className={inp} defaultValue={p?.manufacturer ?? ''} placeholder="OPW, Veeder-Root, Icon…" />
        </div>
        <div>
          <label className={lbl} htmlFor="part-category">REV19 category</label>
          <select id="part-category" name="category" className={inp} defaultValue={p?.category ?? ''}>
            <option value="">Service ticket item (no category)</option>
            {PART_CATEGORIES.map(c => <option key={c.n} value={c.n}>{c.n} · {c.label}{c.taxable ? ' (taxable)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor="part-subcategory">Subcategory</label>
          <input id="part-subcategory" name="subcategory" className={inp} defaultValue={p?.subcategory ?? ''} placeholder="VEEDER-ROOT ATG" />
        </div>
        <div>
          <label className={lbl} htmlFor="part-item-type">Item type</label>
          <select id="part-item-type" name="item_type" className={inp} defaultValue={p?.item_type ?? 'material'}>
            {ITEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor="part-uom">Unit of measure</label>
          <input id="part-uom" name="uom" className={inp} defaultValue={p?.uom ?? 'EA'} placeholder="EA, FT, BOX, PAIL, CY, DAY, HR" />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="is_stocked" defaultChecked={p?.is_stocked ?? false} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            Tracked in inventory
          </label>
        </div>
      </div>

      <fieldset className="rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-800">Cost (what RPS pays)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-1">
          <div>
            <label className={lbl} htmlFor="part-unit-cost">Unit cost</label>
            <input id="part-unit-cost" name="unit_cost" inputMode="decimal" className={inp} defaultValue={p?.unit_cost ?? ''} placeholder="0.00" />
          </div>
          <div>
            <label className={lbl} htmlFor="part-freight">Freight per unit</label>
            <input id="part-freight" name="freight_per_unit" inputMode="decimal" className={inp} defaultValue={p?.freight_per_unit ?? ''} placeholder="0.00" />
          </div>
          <div>
            <label className={lbl} htmlFor="part-cost-source">Where the price came from</label>
            <select id="part-cost-source" name="cost_source" className={inp} defaultValue={p?.cost_source ?? 'receipt'}>
              {COST_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="part-cost-vendor">Vendor</label>
            <input id="part-cost-vendor" name="cost_vendor" className={inp} defaultValue={p?.cost_vendor ?? ''} placeholder="Source North America" />
          </div>
          <div>
            <label className={lbl} htmlFor="part-cost-ref">Invoice / quote #</label>
            <input id="part-cost-ref" name="cost_invoice_ref" className={inp} defaultValue={p?.cost_invoice_ref ?? ''} placeholder="2628199" />
          </div>
          <div>
            <label className={lbl} htmlFor="part-cost-date">Price date</label>
            <input id="part-cost-date" name="cost_date" type="date" className={inp} defaultValue={p?.cost_date?.slice(0, 10) ?? ''} />
          </div>
          <div>
            <label className={lbl} htmlFor="part-price-status">Price status</label>
            <select id="part-price-status" name="price_status" className={inp} defaultValue={p?.price_status ?? 'ok'}>
              {PRICE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl} htmlFor="part-primary-vendor">Primary vendor (for reorders)</label>
            <input id="part-primary-vendor" name="primary_vendor" className={inp} defaultValue={p?.primary_vendor ?? ''} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-800">Sell (what the customer pays)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-1">
          <div>
            <label className={lbl} htmlFor="part-markup">Markup % override</label>
            <input id="part-markup" name="markup_pct" inputMode="decimal" className={inp} defaultValue={p?.markup_pct != null ? p.markup_pct * 100 : ''} placeholder="blank = flat 20%" />
          </div>
          <div>
            <label className={lbl} htmlFor="part-sell">Sell price (explicit)</label>
            <input id="part-sell" name="sell_price" inputMode="decimal" className={inp} defaultValue={p?.sell_price ?? ''} placeholder="leave blank to compute from cost" />
          </div>
        </div>
      </fieldset>

      <div>
        <label className={lbl} htmlFor="part-notes">Notes</label>
        <textarea id="part-notes" name="notes" rows={2} className={inp} defaultValue={p?.notes ?? ''} placeholder="RECEIPT|QUOTE|PRICE NEEDED + vendor + invoice # + M/D/YY" />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : p ? 'Save part' : 'Add part'}</Button>
      </div>
    </form>
  )
}
