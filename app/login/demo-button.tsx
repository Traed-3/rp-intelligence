'use client'

import { useState, useTransition } from 'react'
import { signInToDemo } from './demo-actions'

export function DemoSignInButton() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  return (
    <div className="space-y-2">
      {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
      <button
        type="button"
        disabled={isPending}
        onClick={() => startTransition(async () => {
          setError(null)
          const res = await signInToDemo()
          if (res?.error) setError(res.error)
        })}
        className="w-full py-3 rounded-lg bg-primary text-primary-foreground text-base font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {isPending ? 'Opening the demo…' : 'Try the demo →'}
      </button>
    </div>
  )
}
