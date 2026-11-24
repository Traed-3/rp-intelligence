'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PROJECT_TYPES, REQUEST_TYPES } from '@/lib/permits'
import type { ActionState } from '@/app/(app)/construction/permits/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

type Jur = { id: string; name: string }

export function PermitProjectForm({
  action,
  jurisdictions,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  jurisdictions: Jur[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [projectType, setProjectType] = useState<string>('Dispenser Replacement')

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Site # <span className="text-red-500">*</span></label>
          <input name="site_number" className={inp} required placeholder="e.g. 34022" />
        </div>
        <div>
          <label className={lbl}>Site Name</label>
          <input name="site_name" className={inp} placeholder="7-Eleven #34022" />
        </div>
        <div>
          <label className={lbl}>Brand</label>
          <input name="brand" className={inp} placeholder="7-Eleven / Speedway…" />
        </div>
        <div>
          <label className={lbl}>Jurisdiction</label>
          <select name="jurisdiction_id" className={inp} defaultValue="">
            <option value="">—</option>
            {jurisdictions.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Address</label>
          <input name="address" className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={lbl}>City</label><input name="city" className={inp} /></div>
          <div><label className={lbl}>State</label><input name="state" className={inp} placeholder="VA" /></div>
        </div>
        <div>
          <label className={lbl}>Project Type</label>
          <select name="project_type" className={inp} value={projectType} onChange={e => setProjectType(e.target.value)}>
            {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Request Type</label>
          <select name="request_type" className={inp} defaultValue="Non-PE Stamped">
            {REQUEST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Scheduled Work Date</label>
          <input name="scheduled_work_date" type="date" className={inp} />
          <p className="text-[11px] text-gray-400 mt-1">Permit due date is auto-set to 28 days before this.</p>
        </div>
      </div>
      <div>
        <label className={lbl}>Scope</label>
        <textarea name="scope" rows={2} className={inp} />
      </div>

      <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
        Creating this opens the Electrical permit (Hash Construction). Add a Building or Mechanical permit by hand from the site page if a jurisdiction asks for one.
      </p>

      <Button type="submit" disabled={isPending}>{isPending ? 'Creating…' : 'Create Project'}</Button>
    </form>
  )
}
