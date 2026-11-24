'use client'

import { Trash2 } from 'lucide-react'

export function DeleteToolButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Delete "${label}"? This also removes its Expenses entry.`)) e.preventDefault()
      }}
    >
      <button type="submit" className="text-gray-400 hover:text-red-600" title="Delete">
        <Trash2 className="w-4 h-4" />
      </button>
    </form>
  )
}
