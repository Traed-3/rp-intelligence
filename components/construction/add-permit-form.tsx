'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PERMIT_TYPES, PULLED_BY, REQUIREMENT_STATUSES, defaultPulledBy } from '@/lib/permits'
import type { ActionState } from '@/app/(app)/construction/permits/actions'

const inp = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

// Manually add a Building / Mechanical / other permit to a project.
export function AddPermitForm({
  action,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [permitType, setPermitType] = useState('Building')

  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{state.error}</div>}
      <div className="flex flex-wrap items-end gap-2">
        <select name="permit_type" value={permitType} onChange={e => setPermitType(e.target.value)} className={inp}>
          {PERMIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select name="pulled_by" key={permitType} defaultValue={defaultPulledBy(permitType)} className={inp}>
          {PULLED_BY.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select name="requirement_status" defaultValue="Required" className={inp}>
          {REQUIREMENT_STATUSES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <Button type="submit" size="sm" disabled={isPending}>{isPending ? 'Adding…' : 'Add permit'}</Button>
      </div>
    </form>
  )
}
