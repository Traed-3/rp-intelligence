'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/construction/permits/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export type JurisdictionRecord = {
  id: string; name: string; state: string | null; is_independent_city: boolean
  department: string | null; contact_name: string | null; phone: string | null; email: string | null
  portal_url: string | null; submittal_method: string | null; typical_turnaround_days: string | null
  fee_notes: string | null; contractor_requirements: string | null; cheat_sheet: string | null
  requires_building_with_electrical: string; requires_mechanical_with_electrical: string
}

export function JurisdictionForm({
  action,
  jurisdiction: j,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  jurisdiction: JurisdictionRecord
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Department</label>
          <input name="department" className={inp} defaultValue={j.department ?? ''} />
        </div>
        <div>
          <label className={lbl}>Contact Name</label>
          <input name="contact_name" className={inp} defaultValue={j.contact_name ?? ''} />
        </div>
        <div>
          <label className={lbl}>Direct Phone</label>
          <input name="phone" className={inp} defaultValue={j.phone ?? ''} />
        </div>
        <div>
          <label className={lbl}>Email</label>
          <input name="email" className={inp} defaultValue={j.email ?? ''} />
        </div>
        <div>
          <label className={lbl}>Portal URL</label>
          <input name="portal_url" className={inp} defaultValue={j.portal_url ?? ''} />
        </div>
        <div>
          <label className={lbl}>Submittal Method</label>
          <input name="submittal_method" className={inp} placeholder="portal / email / in person" defaultValue={j.submittal_method ?? ''} />
        </div>
        <div>
          <label className={lbl}>Typical Turnaround</label>
          <input name="typical_turnaround_days" className={inp} defaultValue={j.typical_turnaround_days ?? ''} />
        </div>
        <div>
          <label className={lbl}>Fee Notes</label>
          <input name="fee_notes" className={inp} placeholder="who the check is payable to" defaultValue={j.fee_notes ?? ''} />
        </div>
      </div>

      {/* The two inheritance flags — the payoff of the jurisdiction cheat sheet */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
        <div>
          <label className={lbl}>Building permit required with electrical?</label>
          <select name="requires_building_with_electrical" className={inp} defaultValue={j.requires_building_with_electrical}>
            <option value="unknown">Unknown</option>
            <option value="yes">Yes — always require it</option>
            <option value="no">No — never needed</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Mechanical permit required with electrical?</label>
          <select name="requires_mechanical_with_electrical" className={inp} defaultValue={j.requires_mechanical_with_electrical}>
            <option value="unknown">Unknown</option>
            <option value="yes">Yes — always require it</option>
            <option value="no">No — never needed</option>
          </select>
        </div>
        <p className="text-xs text-blue-800 sm:col-span-2">
          Set these once you learn the rule for this office. New Dispenser Replacement projects here will pre-fill their Building/Mechanical requirements from these.
        </p>
      </div>

      <div>
        <label className={lbl}>Contractor Requirements</label>
        <textarea name="contractor_requirements" rows={2} className={inp} placeholder="e.g. city business license on top of the state Class A" defaultValue={j.contractor_requirements ?? ''} />
      </div>

      <div>
        <label className={lbl}>Cheat Sheet</label>
        <textarea name="cheat_sheet" rows={5} className={inp} placeholder="Everything we learn about filing here." defaultValue={j.cheat_sheet ?? ''} />
      </div>

      <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Save Jurisdiction'}</Button>
    </form>
  )
}
