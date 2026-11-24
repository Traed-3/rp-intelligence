'use client'

import { useTransition } from 'react'
import { toggleChecklistItem } from '@/app/(app)/construction/actions'

export function ChecklistCheck({ id, done, disabled }: { id: string; done: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition()
  return (
    <input
      type="checkbox"
      defaultChecked={done}
      disabled={disabled || pending}
      onChange={e => { const v = e.target.checked; start(() => { toggleChecklistItem(id, v) }) }}
      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
    />
  )
}
