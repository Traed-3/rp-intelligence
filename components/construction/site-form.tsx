'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export type SiteRecord = {
  id: string
  customer_id: string | null
  site_number: string
  store_brand: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  dispenser_count: number | null
  dispenser_type: string | null
  tank_count: number | null
  tank_type: string | null
  stp_count: number | null
  stp_type: string | null
  fill_spill_bucket_count: number | null
  fill_spill_bucket_type: string | null
  vapor_bucket_count: number | null
  vapor_bucket_type: string | null
  notes: string | null
}

type Customer = { id: string; name: string }

export function SiteForm({
  action,
  site,
  customers,
  fixedCustomerId,
  redirectTo,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  site?: SiteRecord
  customers: Customer[]
  fixedCustomerId?: string
  redirectTo?: string
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const s = site

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}
      {redirectTo && <input type="hidden" name="redirect_to" value={redirectTo} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Site Number / Name <span className="text-red-500">*</span></label>
          <input name="site_number" className={inp} placeholder="e.g. 28960 or SU-7415" defaultValue={s?.site_number ?? ''} required />
        </div>
        <div>
          <label className={lbl}>Store Brand</label>
          <input name="store_brand" className={inp} placeholder="7-Eleven, Sunoco…" defaultValue={s?.store_brand ?? ''} />
        </div>
      </div>

      {fixedCustomerId ? (
        <input type="hidden" name="customer_id" value={fixedCustomerId} />
      ) : (
        <div>
          <label className={lbl}>Customer</label>
          <select name="customer_id" className={inp} defaultValue={s?.customer_id ?? ''}>
            <option value="">— No customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className={lbl}>Address</label>
        <input name="address" className={inp} defaultValue={s?.address ?? ''} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="col-span-2 sm:col-span-2">
          <label className={lbl}>City</label>
          <input name="city" className={inp} defaultValue={s?.city ?? ''} />
        </div>
        <div>
          <label className={lbl}>State</label>
          <input name="state" className={inp} maxLength={2} placeholder="MD" defaultValue={s?.state ?? ''} />
        </div>
        <div>
          <label className={lbl}>ZIP</label>
          <input name="zip" className={inp} defaultValue={s?.zip ?? ''} />
        </div>
      </div>

      {/* Equipment */}
      <div className="rounded-xl border border-gray-200 p-4 space-y-4">
        <p className="text-sm font-semibold text-gray-800">Equipment</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Dispensers</label>
            <input name="dispenser_count" type="number" min="0" className={inp} placeholder="Qty" defaultValue={s?.dispenser_count ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Dispenser Type / Brand</label>
            <input name="dispenser_type" className={inp} placeholder="Gilbarco Encore, Wayne Ovation…" defaultValue={s?.dispenser_type ?? ''} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Tanks</label>
            <input name="tank_count" type="number" min="0" className={inp} placeholder="Qty" defaultValue={s?.tank_count ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Tank Type / Brand</label>
            <input name="tank_type" className={inp} placeholder="FRP, steel, Containment Solutions…" defaultValue={s?.tank_type ?? ''} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>STPs</label>
            <input name="stp_count" type="number" min="0" className={inp} placeholder="Qty" defaultValue={s?.stp_count ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>STP Type / Brand</label>
            <input name="stp_type" className={inp} placeholder="Red Jacket, FE Petro…" defaultValue={s?.stp_type ?? ''} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Fill Spill Buckets</label>
            <input name="fill_spill_bucket_count" type="number" min="0" className={inp} placeholder="Qty" defaultValue={s?.fill_spill_bucket_count ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Fill Spill Bucket Type / Brand</label>
            <input name="fill_spill_bucket_type" className={inp} placeholder="OPW, EMCO…" defaultValue={s?.fill_spill_bucket_type ?? ''} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lbl}>Vapor Buckets</label>
            <input name="vapor_bucket_count" type="number" min="0" className={inp} placeholder="Qty" defaultValue={s?.vapor_bucket_count ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Vapor Bucket Type / Brand</label>
            <input name="vapor_bucket_type" className={inp} placeholder="OPW, EMCO…" defaultValue={s?.vapor_bucket_type ?? ''} />
          </div>
        </div>
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} defaultValue={s?.notes ?? ''} />
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : s ? 'Save Site' : 'Add Site'}</Button>
      </div>
    </form>
  )
}
