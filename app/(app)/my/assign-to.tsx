'use client'

import { useRef } from 'react'

export type Assignee = { id: string; name: string }

/** "Assign to:" at the bottom of a My Plate card. Picking a name moves the card to that person's plate. */
export function AssignTo({ action, people }: { action: (formData: FormData) => void | Promise<void>; people: Assignee[] }) {
  const form = useRef<HTMLFormElement>(null)
  return (
    <form ref={form} action={action} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        <span>Assign to:</span>
        <select
          name="to"
          defaultValue=""
          onChange={e => { if (e.currentTarget.value) form.current?.requestSubmit() }}
          className="rounded-md border border-gray-300 bg-card px-1.5 py-0.5 text-xs text-foreground"
        >
          <option value="">Choose…</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
    </form>
  )
}
