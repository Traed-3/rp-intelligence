'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/inventory/actions'
import { LOCATION_KINDS } from '@/lib/inventory'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export function LocationForm({
  action,
  assets,
  techs,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  assets: { id: string; unit_number: string; name: string | null }[]
  techs: { id: string; full_name: string }[]
}) {
  const [state, formAction, isPending] = useActionState(action, {} as ActionState)
  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}
      {state?.ok && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Saved.</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl} htmlFor="loc-name">Name <span className="text-red-500">*</span></label>
          <input id="loc-name" name="name" className={inp} required placeholder="Truck NN14, Service Shelf B, Job 45986…" />
        </div>
        <div>
          <label className={lbl} htmlFor="loc-kind">Kind</label>
          <select id="loc-kind" name="kind" className={inp} defaultValue="truck">
            {LOCATION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor="loc-asset">Asset (truck number)</label>
          <select id="loc-asset" name="asset_id" className={inp} defaultValue="">
            <option value="">— none —</option>
            {assets.map(a => <option key={a.id} value={a.id}>{a.unit_number}{a.name ? ` · ${a.name}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor="loc-tech">Technician who drives it</label>
          <select id="loc-tech" name="technician_id" className={inp} defaultValue="">
            <option value="">— none —</option>
            {techs.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl} htmlFor="loc-dept">Department</label>
          <select id="loc-dept" name="department" className={inp} defaultValue="shared">
            <option value="shared">Shared</option>
            <option value="service">Service</option>
            <option value="construction">Construction</option>
          </select>
        </div>
      </div>
      <Button type="submit" disabled={isPending}>{isPending ? 'Saving…' : 'Add location'}</Button>
    </form>
  )
}
