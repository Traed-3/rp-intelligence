'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export type VendorRecord = {
  id: string
  name: string
  category: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  account_number: string | null
  notes: string | null
  is_active: boolean
}

export function VendorForm({
  action,
  vendor,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  vendor?: VendorRecord
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const v = vendor

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Vendor Name <span className="text-red-500">*</span></label>
          <input name="name" className={inp} defaultValue={v?.name ?? ''} required />
        </div>
        <div>
          <label className={lbl}>Supplies / Category</label>
          <input name="category" className={inp} placeholder="Dispensers, concrete, fittings…" defaultValue={v?.category ?? ''} />
        </div>
        <div>
          <label className={lbl}>Contact Name</label>
          <input name="contact_name" className={inp} defaultValue={v?.contact_name ?? ''} />
        </div>
        <div>
          <label className={lbl}>Phone</label>
          <input name="phone" className={inp} defaultValue={v?.phone ?? ''} />
        </div>
        <div>
          <label className={lbl}>Email</label>
          <input name="email" type="email" className={inp} defaultValue={v?.email ?? ''} />
        </div>
        <div>
          <label className={lbl}>Account #</label>
          <input name="account_number" className={inp} defaultValue={v?.account_number ?? ''} />
        </div>
      </div>

      <div>
        <label className={lbl}>Notes</label>
        <textarea name="notes" rows={2} className={inp} defaultValue={v?.notes ?? ''} />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="is_active" defaultChecked={v ? v.is_active : true} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        Active
      </label>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : v ? 'Save' : 'Add Vendor'}</Button>
      </div>
    </form>
  )
}
