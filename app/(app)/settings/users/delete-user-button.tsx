'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteUser } from './actions'

export function DeleteUserButton({
  userId,
  fullName,
}: {
  userId: string
  fullName: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  function handleDelete() {
    if (!confirm(`Permanently remove ${fullName}? This removes their login access and cannot be undone.`)) return
    setError(null)
    startTransition(async () => {
      const result = await deleteUser(userId)
      if (result.error) {
        setError(result.error)
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div>
      <button
        onClick={handleDelete}
        disabled={isPending}
        className="text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
      >
        {isPending ? 'Removing…' : 'Remove'}
      </button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  )
}
