'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

type Job = { id: string; site_number: string | null; work_order_number: string | null }

export type ScheduleRecord = {
  id: string
  schedule_date: string
  entry_type: string | null
  job_id: string | null
  site_number: string | null
  task_description: string | null
  crew: string[] | null
  equipment: string | null
  notes: string | null
}

export function ScheduleEntryForm({
  action,
  jobs,
  entry,
  fixedJobId,
  defaultDate,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  jobs: Job[]
  entry?: ScheduleRecord
  fixedJobId?: string
  defaultDate?: string
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const e = entry

  return (
    <form action={formAction} className="space-y-3">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{state.error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Date <span className="text-red-500">*</span></label>
          <input name="schedule_date" type="date" className={inp} defaultValue={e?.schedule_date ?? defaultDate ?? ''} required />
        </div>
        <div>
          <label className={lbl}>Type</label>
          <select name="entry_type" className={inp} defaultValue={e?.entry_type ?? 'job'}>
            <option value="job">Job</option>
            <option value="time_off">Time off</option>
            <option value="note">Note</option>
          </select>
        </div>
        {fixedJobId ? (
          <input type="hidden" name="job_id" value={fixedJobId} />
        ) : (
          <div>
            <label className={lbl}>Job (optional)</label>
            <select name="job_id" className={inp} defaultValue={e?.job_id ?? ''}>
              <option value="">— Non-job task —</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.site_number ?? '—'}{j.work_order_number ? ` (${j.work_order_number})` : ''}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className={lbl}>Site # / Label</label>
          <input name="site_number" className={inp} defaultValue={e?.site_number ?? ''} placeholder="e.g. 32346" />
        </div>
        <div>
          <label className={lbl}>Equipment</label>
          <input name="equipment" className={inp} defaultValue={e?.equipment ?? ''} placeholder="vac truck, roll off…" />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Task</label>
          <input name="task_description" className={inp} defaultValue={e?.task_description ?? ''} placeholder="Dispenser inspection, tank entry…" />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Crew <span className="font-normal text-gray-400">(initials, comma or space separated)</span></label>
          <input name="crew" className={inp} defaultValue={e?.crew?.join(', ') ?? ''} placeholder="EL, JF, TW" />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Notes</label>
          <input name="notes" className={inp} defaultValue={e?.notes ?? ''} />
        </div>
      </div>

      <Button type="submit" size="sm" disabled={isPending}>{isPending ? 'Saving…' : e ? 'Save' : 'Add to Schedule'}</Button>
    </form>
  )
}
