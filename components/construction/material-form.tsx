'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { MATERIAL_STATUSES } from '@/lib/construction'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export type MaterialRecord = {
  id: string
  job_id: string
  item_number: string | null
  part_number: string | null
  description: string | null
  quantity: number | null
  unit_cost: number | null
  status: string
  vendor: string | null
  ordered_date: string | null
  received_date: string | null
  notes: string | null
}

export function MaterialForm({
  action,
  jobId,
  jobs,
  material,
  vendors,
  compact = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  jobId?: string
  jobs?: { id: string; site_number: string | null; work_order_number: string | null }[]
  material?: MaterialRecord
  vendors?: string[]
  compact?: boolean
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const m = material

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{state.error}</div>
      )}
      {jobId ? (
        <input type="hidden" name="job_id" value={jobId} />
      ) : (
        <div>
          <label className={lbl}>Job <span className="text-red-500">*</span></label>
          <select name="job_id" className={inp} defaultValue={m?.job_id ?? ''} required>
            <option value="">— Select a job —</option>
            {(jobs ?? []).map(j => <option key={j.id} value={j.id}>{j.site_number ?? '—'}{j.work_order_number ? ` (${j.work_order_number})` : ''}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={lbl}>Description <span className="text-red-500">*</span></label>
          <input name="description" className={inp} defaultValue={m?.description ?? ''} required />
        </div>
        <div>
          <label className={lbl}>Item #</label>
          <input name="item_number" className={inp} defaultValue={m?.item_number ?? ''} />
        </div>
        <div>
          <label className={lbl}>Part #</label>
          <input name="part_number" className={inp} defaultValue={m?.part_number ?? ''} />
        </div>
        <div>
          <label className={lbl}>Quantity</label>
          <input name="quantity" type="number" step="any" className={inp} defaultValue={m?.quantity ?? ''} />
        </div>
        <div>
          <label className={lbl}>Unit Cost</label>
          <input name="unit_cost" type="number" step="any" className={inp} defaultValue={m?.unit_cost ?? ''} />
        </div>
        <div>
          <label className={lbl}>Status</label>
          <select name="status" className={inp} defaultValue={m?.status ?? 'needed'}>
            {MATERIAL_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Vendor</label>
          <input name="vendor" className={inp} list="material-vendors" autoComplete="off" defaultValue={m?.vendor ?? ''} placeholder={vendors?.length ? 'Select or type a vendor' : ''} />
          <datalist id="material-vendors">
            {(vendors ?? []).map(v => <option key={v} value={v} />)}
          </datalist>
        </div>
        {!compact && (
          <>
            <div>
              <label className={lbl}>Ordered Date</label>
              <input name="ordered_date" type="date" className={inp} defaultValue={m?.ordered_date ?? ''} />
            </div>
            <div>
              <label className={lbl}>Received Date</label>
              <input name="received_date" type="date" className={inp} defaultValue={m?.received_date ?? ''} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl}>Notes</label>
              <input name="notes" className={inp} defaultValue={m?.notes ?? ''} />
            </div>
          </>
        )}
      </div>

      <Button type="submit" size="sm" disabled={isPending}>{isPending ? 'Saving…' : m ? 'Save' : 'Add Material'}</Button>
    </form>
  )
}
