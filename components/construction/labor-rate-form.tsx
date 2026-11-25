'use client'

import { useActionState } from 'react'
import type { ActionState } from '@/app/(app)/construction/actions'

/** Owner / manager: the company's own cost for an hour of crew labor (wages plus burden). Used on every job. */
export function LaborRateForm({ action, current }: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  current: number | null
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  return (
    <form action={formAction} className="rp-card p-4 flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="labor_cost_rate" className="rp-label block mb-1">Labor cost per man-hour</label>
        <input id="labor_cost_rate" name="labor_cost_rate" type="number" step="0.01" min="0" defaultValue={current ?? ''} placeholder="e.g. 45.00" className="rp-input w-36" />
      </div>
      <button type="submit" disabled={isPending} className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">
        {isPending ? 'Saving…' : 'Save'}
      </button>
      <p className="text-xs text-muted-foreground basis-full">
        What an hour of crew time costs the company (wages plus taxes and insurance). One figure for every job; only owners and managers see this box. Leave it blank to use the billing rate.
      </p>
      {state?.error && <p className="text-xs text-danger basis-full">{state.error}</p>}
    </form>
  )
}
