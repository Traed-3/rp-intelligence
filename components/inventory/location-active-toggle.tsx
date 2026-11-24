'use client'

import { useTransition } from 'react'
import { setLocationActive } from '@/app/(app)/inventory/actions'

export function LocationActiveToggle({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      data-no-row-nav
      disabled={pending}
      onClick={() => start(() => setLocationActive(id, !active))}
      className={`text-xs px-2 py-0.5 rounded-full border ${active ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-500 border-gray-200'} disabled:opacity-50`}
      title={active ? 'Click to deactivate' : 'Click to activate'}
    >
      {pending ? '…' : active ? 'Active' : 'Inactive'}
    </button>
  )
}
