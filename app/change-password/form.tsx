'use client'

import { useActionState } from 'react'
import { changeOwnPassword, type ChangeState } from './actions'
import { MIN_PASSWORD_LENGTH } from '@/lib/password-rules'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangeState, FormData>(changeOwnPassword, null)
  return (
    <form action={action} className="space-y-3">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{state.error}</div>}
      <input name="password" type="password" className={inp} placeholder={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`} required autoComplete="new-password" />
      <input name="confirm" type="password" className={inp} placeholder="Type it again" required autoComplete="new-password" />
      <button type="submit" disabled={pending} className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
        {pending ? 'Saving…' : 'Save my password'}
      </button>
    </form>
  )
}
