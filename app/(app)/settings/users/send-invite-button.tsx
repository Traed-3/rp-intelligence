'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendUserInvite } from './actions'

/**
 * One click: emails this person their invite with the company's Invite message. Someone who has never signed in also
 * gets a new temporary password in it; someone who has keeps theirs (the email tells them to use it).
 */
export function SendInviteButton({ userId, signedIn, invitedBefore }: {
  userId: string
  signedIn: boolean
  invitedBefore: boolean
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'sent' | { error: string }>('idle')
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    setState('idle')
    startTransition(async () => {
      const r = await sendUserInvite(userId)
      if (r.ok) { setState('sent'); router.refresh() }
      else setState({ error: r.error ?? 'Something went wrong.' })
    })
  }

  if (state === 'sent' && !isPending) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-xs font-semibold text-green-700">Invite sent ✓</span>
        <button onClick={handleClick} className="text-xs text-gray-500 hover:text-gray-800 underline">Send again</button>
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={handleClick}
        disabled={isPending}
        title={signedIn
          ? 'Emails them the sign-in link and what\'s new. They keep the password they have.'
          : 'Emails them the sign-in link, what\'s new and a new temporary password.'}
        className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-60"
      >
        {isPending ? 'Sending…' : invitedBefore ? 'Resend invite' : 'Send invite'}
      </button>
      {typeof state === 'object' && <span className="text-xs text-red-700 max-w-[16rem]">{state.error}</span>}
    </span>
  )
}
