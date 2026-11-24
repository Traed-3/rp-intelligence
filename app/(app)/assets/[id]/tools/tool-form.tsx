'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ImageUpload } from '@/components/ui/image-upload'
import type { ToolType } from '@/lib/asset-tools'

type State = { error: string } | { ok: string } | null
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export function ToolForm({
  action,
  types,
  today,
}: {
  action: (state: State, formData: FormData) => Promise<State>
  types: ToolType[]
  today: string
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  // Selections are tied to the action-state object they were made under, so they
  // clear on their own after a successful save (React resets the uncontrolled inputs).
  const [receipt, setReceipt] = useState<{ url: string | null; at: State }>({ url: null, at: null })
  const [typePick, setTypePick] = useState<{ id: string; at: State }>({ id: '', at: null })
  const [kindPick, setKindPick] = useState<{ kind: string; at: State }>({ kind: 'tool', at: null })
  const receiptUrl = receipt.at === state ? receipt.url : null
  const typeId = typePick.at === state ? typePick.id : ''
  const picked = types.find((t) => t.id === typeId)
  const kindNow = picked?.kind ?? (kindPick.at === state ? kindPick.kind : 'tool')

  return (
    <form action={formAction} className="space-y-4">
      {state && 'error' in state && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}
      {state && 'ok' in state && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">{state.ok}</div>
      )}
      <input type="hidden" name="receipt_url" value={receiptUrl ?? ''} />

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 sm:col-span-1">
          <label className={lbl}>Item type</label>
          <select name="type_id" className={inp} defaultValue="" onChange={(e) => setTypePick({ id: e.target.value, at: state })}>
            <option value="">— Other (type it below) —</option>
            <optgroup label="Tools">
              {types.filter((t) => t.kind === 'tool').map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
            <optgroup label="Supplies">
              {types.filter((t) => t.kind === 'supply').map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
            <optgroup label="Fluids">
              {types.filter((t) => t.kind === 'fluid').map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
          </select>
          {picked && (
            <p className="text-xs text-gray-400 mt-1">
              Re-buying this for the same truck within {picked.repeat_window_months} months alerts management.
            </p>
          )}
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={lbl}>{picked ? 'Details (optional)' : 'What is it?'}</label>
          <input
            name="item_name"
            className={inp}
            placeholder={picked ? `e.g. 50 ft, 12 gauge` : 'e.g. impact driver'}
            required={!picked}
          />
        </div>
      </div>

      {!picked && (
        <div>
          <label className={lbl}>Is it a tool, a supply or a fluid?</label>
          <select name="kind" className={inp} defaultValue="tool" onChange={(e) => setKindPick({ kind: e.target.value, at: state })}>
            <option value="tool">Tool (lasts)</option>
            <option value="supply">Supply (gets used up)</option>
            <option value="fluid">Fluid (DEF, oil, coolant…)</option>
          </select>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={lbl}>Quantity</label>
          <input name="quantity" type="number" step="0.01" min="0.01" defaultValue={1} className={inp} />
        </div>
        <div>
          <label className={lbl}>Total cost ($) <span className="text-red-500">*</span></label>
          <input name="total_cost" type="number" step="0.01" min="0" className={inp} placeholder="0.00" required />
        </div>
        <div>
          <label className={lbl}>Purchased <span className="text-red-500">*</span></label>
          <input name="purchased_on" type="date" className={inp} defaultValue={today} required />
        </div>
      </div>

      {kindNow === 'fluid' && (
        <div>
          <label className={lbl}>Odometer at fill-up (miles)</label>
          <input name="mileage" type="number" min="0" className={inp} placeholder="Lets us work out fluid cost per mile" />
          <p className="text-xs text-gray-400 mt-1">Quantity above = gallons (or quarts — just be consistent per truck).</p>
        </div>
      )}

      <div>
        <label className={lbl}>Vendor</label>
        <input name="vendor" className={inp} placeholder="Home Depot, Lowe's, Amazon…" />
      </div>

      <div>
        <label className={lbl}>Receipt</label>
        <ImageUpload
          bucket="receipts"
          value={receiptUrl}
          onChange={(url) => setReceipt({ url, at: state })}
          label="Add receipt photo / PDF"
          accept="image/*,application/pdf"
        />
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <input name="notes" className={inp} placeholder="Why it was needed, who has it…" />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="record_expense" defaultChecked className="rounded border-gray-300" />
        Also add to Expenses (keeps company expense totals in sync)
      </label>

      <Button type="submit" disabled={isPending}>
        {isPending ? 'Saving…' : 'Add to this truck'}
      </Button>
    </form>
  )
}
