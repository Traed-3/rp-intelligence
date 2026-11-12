'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { CON_DISPOSABLE_ITEMS, CON_DISPOSABLE_FORMS } from '@/lib/construction'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const num = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

type WriteIn = { label: string; amount: string; ordered: string }
const blankWriteIn: WriteIn = { label: '', amount: '', ordered: '' }

export function DisposablesForm({
  action,
  jobId,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  jobId: string
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [writeIns, setWriteIns] = useState<WriteIn[]>([{ ...blankWriteIn }])
  const [open, setOpen] = useState(false)

  const setRow = (i: number, patch: Partial<WriteIn>) =>
    setWriteIns((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  // Same reset problem as the daily update: React clears the uncontrolled
  // fields on success but leaves our own state holding the last crew's entries.
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !isPending && !state?.error) {
      setWriteIns([{ ...blankWriteIn }])
      setOpen(false)
    }
    wasPending.current = isPending
  }, [isPending, state])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-blue-700 hover:text-blue-900"
      >
        + Add a Disposables form
      </button>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="job_id" value={jobId} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={lbl}>Tech</label>
          <input name="tech_name" className={inp} placeholder="Who filled this out" />
        </div>
        <div>
          <label className={lbl}>Truck</label>
          <input name="truck" className={inp} placeholder="Truck #" />
        </div>
        <div>
          <label className={lbl}>Date</label>
          <input name="form_date" type="date" className={inp} />
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-12 gap-2 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600">
          <span className="col-span-6">Item</span>
          <span className="col-span-3 text-right">Amount on shelf</span>
          <span className="col-span-3 text-right">Ordered #</span>
        </div>
        <div className="divide-y divide-gray-50">
          {CON_DISPOSABLE_ITEMS.map((item) => (
            <div key={item.code} className="grid grid-cols-12 gap-2 items-center px-3 py-1.5">
              <span className="col-span-6 text-sm text-gray-800">{item.label}</span>
              <input type="hidden" name="item_code" value={item.code} />
              <input type="hidden" name="item_label" value={item.label} />
              <input name="item_amount"  type="number" step="any" min="0" className={num + ' col-span-3'} placeholder="—" />
              <input name="item_ordered" type="number" step="any" min="0" className={num + ' col-span-3'} placeholder="—" />
            </div>
          ))}

          {/* Write-ins for anything the shop started carrying since the sheet was printed. */}
          {writeIns.map((w, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center px-3 py-1.5 bg-gray-50/60">
              <input
                className={inp + ' col-span-6 py-1.5'} placeholder="Other item…"
                value={w.label} onChange={(e) => setRow(i, { label: e.target.value })}
                name={w.label.trim() ? 'extra_label' : undefined}
              />
              <input
                type="number" step="any" min="0" className={num + ' col-span-3'} placeholder="—"
                value={w.amount} onChange={(e) => setRow(i, { amount: e.target.value })}
                name={w.label.trim() ? 'extra_amount' : undefined}
              />
              <input
                type="number" step="any" min="0" className={num + ' col-span-3'} placeholder="—"
                value={w.ordered} onChange={(e) => setRow(i, { ordered: e.target.value })}
                name={w.label.trim() ? 'extra_ordered' : undefined}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setWriteIns((r) => [...r, { ...blankWriteIn }])}
          className="w-full px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 text-left"
        >
          + Another item
        </button>
      </div>

      <div>
        <p className={lbl}>Forms — copies left</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CON_DISPOSABLE_FORMS.map((f) => (
            <div key={f} className="flex items-center gap-2">
              <input type="hidden" name="form_name" value={f} />
              <span className="flex-1 text-sm text-gray-800">{f}</span>
              <input name="form_copies" type="number" step="1" min="0" className={num + ' w-16'} placeholder="—" />
            </div>
          ))}
        </div>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={isPending} className="px-4 py-2 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-60">
          {isPending ? 'Saving…' : 'Save disposables'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500 hover:text-gray-800">
          Cancel
        </button>
      </div>
    </form>
  )
}
