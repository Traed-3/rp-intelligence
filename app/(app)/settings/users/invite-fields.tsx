'use client'

import { useMemo } from 'react'
import { buildInviteEmail, INVITE_LIMITS, type InviteContent, type InviteSender } from '@/lib/invite-email'

export const inviteInp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
export const inviteLbl = 'block text-xs font-medium text-gray-600 mb-1'

export function InviteMessageFields({ draft, onChange, onReset }: {
  draft: InviteContent
  onChange: (patch: Partial<InviteContent>) => void
  onReset: () => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className={inviteLbl}>Subject</label>
        <input className={inviteInp} value={draft.subject} maxLength={INVITE_LIMITS.subject}
          onChange={e => onChange({ subject: e.target.value })} />
      </div>
      <div>
        <label className={inviteLbl}>Message <span className="font-normal text-gray-400">(goes under &ldquo;Hi first name,&rdquo;)</span></label>
        <textarea className={`${inviteInp} min-h-[84px]`} value={draft.intro} maxLength={INVITE_LIMITS.intro}
          onChange={e => onChange({ intro: e.target.value })} />
      </div>
      <div>
        <label className={inviteLbl}>What&apos;s new <span className="font-normal text-gray-400">(one per line, shown as a list; leave empty to skip)</span></label>
        <textarea className={`${inviteInp} min-h-[130px]`} value={draft.whatsNew} maxLength={INVITE_LIMITS.whatsNew}
          onChange={e => onChange({ whatsNew: e.target.value })} />
      </div>
      <p className="text-xs text-gray-500">
        Every invite also has the sign-in link, their email, their temporary password, a tip for putting the app on their phone, and the sender&apos;s name.{' '}
        <button type="button" onClick={onReset} className="font-medium text-blue-600 hover:text-blue-800">Put back the standard text</button>
      </p>
    </div>
  )
}

// Same address the server action puts in the real email.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rpintelligence.app'

/**
 * Renders the real email (same builder the server uses) in a frame. Scripts stay off (no allow-scripts); same-origin
 * is allowed only so the logo image loads, and everything typed is escaped by the builder anyway.
 */
export function InvitePreview({ draft, fullName, email, password, sender }: {
  draft: InviteContent
  fullName: string
  email: string
  password: string | null
  sender: InviteSender
}) {
  const html = useMemo(() => buildInviteEmail({
    content: draft,
    recipient: { fullName, email, password },
    sender,
    loginUrl: `${APP_URL}/login`,
    logoUrl: `${APP_URL}/logo-full-v4.png`,
  }).html, [draft, fullName, email, password, sender])

  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-3 py-1.5 text-xs text-gray-500 bg-gray-50 border-b border-gray-200 truncate">
        To: {fullName} &lt;{email}&gt; &middot; Subject: {draft.subject}
      </div>
      <iframe title="Invite preview" srcDoc={html} sandbox="allow-same-origin" className="w-full h-[460px] bg-white" />
    </div>
  )
}
