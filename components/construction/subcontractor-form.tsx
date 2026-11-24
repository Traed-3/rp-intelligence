'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export type SubcontractorRecord = {
  id: string
  name: string
  trade: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  is_active: boolean
}

export function SubcontractorForm({
  action,
  sub,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  sub?: SubcontractorRecord
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const s = sub

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Company / Name <span className="text-red-500">*</span></label>
          <input name="name" className={inp} defaultValue={s?.name ?? ''} required />
        </div>
        <div>
          <label className={lbl}>Trade / Specialty</label>
          <input name="trade" className={inp} placeholder="Electrical, paving, plumbing…" defaultValue={s?.trade ?? ''} />
        </div>
        <div>
          <label className={lbl}>Contact Name</label>
          <input name="contact_name" className={inp} defaultValue={s?.contact_name ?? ''} />
        </div>
        <div>
          <label className={lbl}>Phone</label>
          <input name="phone" className={inp} defaultValue={s?.phone ?? ''} />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Email</label>
          <input name="email" type="email" className={inp} defaultValue={s?.email ?? ''} />
        </div>
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} defaultValue={s?.notes ?? ''} />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="is_active" defaultChecked={s ? s.is_active : true} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        Active
      </label>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : s ? 'Save' : 'Add Subcontractor'}</Button>
      </div>
    </form>
  )
}
