'use client'

import { useActionState } from 'react'
import { DEPARTMENTS, type Employee } from '@/lib/compliance'
import type { ActionState } from '@/app/(app)/compliance/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export function EmployeeForm({
  action,
  employee,
  submitLabel = 'Save',
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>
  employee?: Employee
  submitLabel?: string
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState)
  const e = employee
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className={lbl}>Full name *</label><input name="full_name" defaultValue={e?.full_name ?? ''} required className={inp} /></div>
        <div><label className={lbl}>Work email (notices go here)</label><input name="email" type="email" defaultValue={e?.email ?? ''} placeholder="first-initial+lastname.rp@gmail.com" className={inp} /></div>
        <div><label className={lbl}>Phone</label><input name="phone" defaultValue={e?.phone ?? ''} className={inp} /></div>
        <div>
          <label className={lbl}>Department</label>
          <select name="department" defaultValue={e?.department ?? 'construction'} className={inp}>
            {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div><label className={lbl}>Job title</label><input name="job_title" defaultValue={e?.job_title ?? ''} className={inp} /></div>
        <div><label className={lbl}>Hire / start date</label><input name="hire_date" type="date" defaultValue={e?.hire_date ?? ''} className={inp} /></div>
        <div><label className={lbl}>Personal email (optional)</label><input name="personal_email" type="email" defaultValue={e?.personal_email ?? ''} className={inp} /></div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800"><input type="checkbox" name="is_dot_driver" defaultChecked={e?.is_dot_driver ?? false} className="w-4 h-4" />DOT driver (needs a full Driver Qualification File)</label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="is_cdl" defaultChecked={e?.is_cdl ?? false} className="w-4 h-4" />CDL holder (adds Clearinghouse + drug test)</label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={lbl}>License #</label><input name="license_number" defaultValue={e?.license_number ?? ''} className={inp} /></div>
          <div><label className={lbl}>State</label><input name="license_state" maxLength={2} defaultValue={e?.license_state ?? ''} className={inp} /></div>
          <div><label className={lbl}>Class</label><input name="license_class" defaultValue={e?.license_class ?? ''} placeholder="A / B / C / D" className={inp} /></div>
        </div>
      </div>

      <div><label className={lbl}>Notes</label><textarea name="notes" rows={2} defaultValue={e?.notes ?? ''} className={inp} /></div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="notify_employee" defaultChecked={e?.notify_employee ?? true} className="w-4 h-4" />Email this person their own expiry reminders</label>
        {e && <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="inactive" defaultChecked={!e.is_active} className="w-4 h-4" />Former employee (stop tracking &amp; notices)</label>}
      </div>

      <div className="flex items-center gap-3">
        <button disabled={pending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">{pending ? 'Saving…' : submitLabel}</button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {state.message && <p className="text-sm text-green-700">{state.message}</p>}
      </div>
    </form>
  )
}
