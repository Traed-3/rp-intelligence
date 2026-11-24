'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

type Sub = { id: string; name: string; trade: string | null }

export function AssignSubcontractor({
  action,
  subs,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  subs: Sub[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-2">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{state.error}</div>}
      <div className="flex flex-wrap items-end gap-2">
        <select name="subcontractor_id" className={`${inp} flex-1 min-w-48`} defaultValue="" required>
          <option value="" disabled>Select a subcontractor…</option>
          {subs.map(s => <option key={s.id} value={s.id}>{s.name}{s.trade ? ` — ${s.trade}` : ''}</option>)}
        </select>
        <input name="role" className={inp} placeholder="Role on this job (optional)" />
        <Button type="submit" size="sm" disabled={isPending}>{isPending ? 'Assigning…' : 'Assign'}</Button>
      </div>
    </form>
  )
}
