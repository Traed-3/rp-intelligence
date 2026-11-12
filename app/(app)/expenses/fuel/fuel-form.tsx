'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'

type State = { error: string } | null
const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

type Asset = { id: string; unit_number: string; name: string | null; make: string | null; model: string | null; current_mileage: number | null }
type PM    = { id: string; code: string; name: string }

const OIL_LEVELS = [
  { value: 1, label: '1', color: 'bg-red-600',    title: '1 — Empty (CRITICAL)' },
  { value: 3, label: '3', color: 'bg-red-400',    title: '3 — Low' },
  { value: 5, label: '5', color: 'bg-amber-400',  title: '5 — Half' },
  { value: 7, label: '7', color: 'bg-green-400',  title: '7 — Good' },
  { value: 9, label: '9', color: 'bg-green-600',  title: '9 — Full' },
]

export function FuelForm({
  action,
  assets,
  paymentMethods,
  today,
}: {
  action: (state: State, formData: FormData) => Promise<State>
  assets: Asset[]
  paymentMethods: PM[]
  today: string
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [gallons, setGallons] = useState('')
  const [cost, setCost] = useState('')
  const [oilLevel, setOilLevel] = useState<number | null>(null)
  const [pmCode, setPmCode] = useState('')

  const ppg = gallons && cost
    ? (parseFloat(cost) / parseFloat(gallons)).toFixed(3)
    : null

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}
      <input type="hidden" name="oil_level" value={oilLevel ?? ''} />
      <input type="hidden" name="payment_method_code" value={pmCode} />

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className={lbl}>Asset <span className="text-red-500">*</span></label>
          <select name="asset_id" className={inp} required>
            <option value="">— Select vehicle —</option>
            {assets.map(a => (
              <option key={a.id} value={a.id}>
                {a.unit_number}{[a.make, a.model].filter(Boolean).length ? ` — ${[a.make, a.model].filter(Boolean).join(' ')}` : ''}
                {a.current_mileage != null ? ` (${a.current_mileage.toLocaleString()} mi)` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={lbl}>Date <span className="text-red-500">*</span></label>
          <input name="entry_date" type="date" className={inp} defaultValue={today} required />
        </div>
        <div>
          <label className={lbl}>Mileage at Fill-Up <span className="text-red-500">*</span></label>
          <input name="mileage" type="number" className={inp} placeholder="Current odometer" required />
        </div>
        <div>
          <label className={lbl}>Total Gallons <span className="text-red-500">*</span></label>
          <input
            name="gallons"
            type="number"
            step="0.001"
            className={inp}
            placeholder="0.000"
            value={gallons}
            onChange={e => setGallons(e.target.value)}
            required
          />
        </div>
        <div>
          <label className={lbl}>Total Cost ($)</label>
          <input
            name="total_cost"
            type="number"
            step="0.01"
            className={inp}
            placeholder="0.00"
            value={cost}
            onChange={e => setCost(e.target.value)}
          />
          {ppg && <p className="text-xs text-gray-500 mt-1">${ppg}/gal</p>}
        </div>
        <div>
          <label className={lbl}>Station / Vendor</label>
          <input name="station_name" className={inp} placeholder="Shell, Pilot, etc." />
        </div>
      </div>

      {/* Oil level picker */}
      <div>
        <label className={lbl}>
          Oil Level Check{' '}
          <span className="text-xs font-normal text-gray-400">(9 = Full, 1 = Empty)</span>
        </label>
        <div className="flex gap-2 mt-1">
          {OIL_LEVELS.map(o => (
            <button
              key={o.value}
              type="button"
              title={o.title}
              onClick={() => setOilLevel(oilLevel === o.value ? null : o.value)}
              className={`flex-1 py-3 rounded-xl text-white font-bold text-sm transition-all ${o.color} ${
                oilLevel === o.value ? 'ring-4 ring-offset-2 ring-blue-500 scale-105' : 'opacity-70 hover:opacity-100'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {oilLevel !== null && oilLevel <= 3 && (
          <p className="text-xs text-red-600 font-semibold mt-1.5">
            ⚠️ Low oil — a notification will be sent to the manager automatically.
          </p>
        )}
      </div>

      {/* Payment method */}
      <div>
        <label className={lbl}>Payment Method</label>
        <div className="flex gap-2 flex-wrap">
          {paymentMethods.map(pm => (
            <button
              key={pm.code}
              type="button"
              onClick={() => setPmCode(pmCode === pm.code ? '' : pm.code)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                pmCode === pm.code ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-700 border-gray-200 hover:border-gray-400'
              }`}
              title={pm.name}
            >
              {pm.code}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <input name="notes" className={inp} placeholder="Optional notes..." />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={isPending}>
        {isPending ? 'Saving…' : '⛽ Submit Fuel Entry'}
      </Button>
    </form>
  )
}
