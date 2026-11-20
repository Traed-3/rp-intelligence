'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { sendUserInvite, sendInviteTest } from './actions'
import { generatePassword, validateNewPassword, MIN_PASSWORD_LENGTH } from '@/lib/password-rules'
import { validateInviteContent, type InviteSender } from '@/lib/invite-email'
import { InviteMessageFields, InvitePreview, useInviteDraft, inviteInp, inviteLbl } from './invite-fields'

export function SendInviteButton({ userId, fullName, email, signedIn, sender }: {
  userId: string
  fullName: string
  email: string
  /** Has signed in before. Then a new password is optional (it replaces the one they use now). */
  signedIn: boolean
  sender: InviteSender
}) {
  const router = useRouter()
  const { draft, update, reset, reload } = useInviteDraft()
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState(!signedIn)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(true)
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testNote, setTestNote] = useState<string | null>(null)
  const [done, setDone] = useState<null | { passwordChanged: boolean }>(null)
  const [failedAfterPassword, setFailedAfterPassword] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    reload()
    setNewPassword(!signedIn)
    setPassword(generatePassword())
    setShow(true); setCopied(false); setPreview(false)
    setError(null); setTestNote(null); setDone(null); setFailedAfterPassword(false)
    setOpen(true)
  }

  function handleClose() {
    setOpen(false)
    setPassword('')   // never keep a password around after the dialog is gone
    if (done) router.refresh()   // shows "Invite sent" on their row
  }

  async function handleCopy() {
    try { await navigator.clipboard.writeText(password); setCopied(true) } catch { setShow(true) }
  }

  function check(): string | null {
    const problem = validateInviteContent(draft)
    if (problem) return problem
    if (newPassword) return validateNewPassword(password)
    return null
  }

  function handleSend() {
    const problem = check()
    if (problem) { setError(problem); return }
    setError(null); setTestNote(null)
    startTransition(async () => {
      const r = await sendUserInvite(userId, { ...draft, newPassword, password: newPassword ? password : undefined })
      if (r.ok) setDone({ passwordChanged: !!r.passwordChanged })
      else { setError(r.error ?? 'Something went wrong.'); setFailedAfterPassword(!!r.passwordChanged) }
    })
  }

  function handleTest() {
    const problem = validateInviteContent(draft)
    if (problem) { setError(problem); return }
    setError(null); setTestNote(null)
    startTransition(async () => {
      const r = await sendInviteTest({ ...draft, newPassword })
      if (r.ok) setTestNote(`Test sent to ${r.to}. It shows a sample password; nobody's password was changed.`)
      else setError(r.error ?? 'Something went wrong.')
    })
  }

  return (
    <>
      <button
        onClick={handleOpen}
        title="Email them a sign-in invite with a temporary password and what's new"
        className="text-xs font-medium text-blue-700 hover:text-blue-900 hover:bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors"
      >
        Invite
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={isPending ? undefined : handleClose} />
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
            <div className="bg-card rounded-2xl shadow-xl w-full max-w-xl p-6 my-auto">
              <h2 className="text-base font-bold text-gray-900 mb-1">Send invite</h2>
              <p className="text-xs text-gray-500 mb-4">To {fullName} &middot; {email}</p>

              {done ? (
                <>
                  <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
                    Invite sent to {email}.{done.passwordChanged ? ' Their temporary password is in the email, and they will choose their own the first time they sign in.' : ' Their password was not changed.'}
                  </div>
                  <div className="flex justify-end">
                    <button onClick={handleClose} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Done</button>
                  </div>
                </>
              ) : (
                <>
                  {error && (
                    <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                      {error}
                      {failedAfterPassword && (
                        <p className="mt-1">Their password <b>was</b> changed to the one below. Give it to them by phone, or press Send again.</p>
                      )}
                    </div>
                  )}
                  {testNote && (
                    <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">{testNote}</div>
                  )}

                  <div className="space-y-4">
                    <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <label className="flex items-start gap-2 text-sm text-gray-700">
                        <input type="checkbox" className="mt-0.5" checked={newPassword} onChange={e => setNewPassword(e.target.checked)} />
                        <span>
                          Include a new temporary password
                          {signedIn
                            ? <span className="block text-xs text-amber-700">{fullName} has signed in before. A new password replaces the one they use now.</span>
                            : <span className="block text-xs text-gray-500">They have not signed in yet, so they need one.</span>}
                        </span>
                      </label>
                      {newPassword && (
                        <div>
                          <label className={inviteLbl}>Temporary password</label>
                          <input
                            className={`${inviteInp} font-mono`}
                            type={show ? 'text' : 'password'}
                            value={password}
                            onChange={e => { setPassword(e.target.value); setCopied(false) }}
                            autoComplete="new-password" spellCheck={false} autoCapitalize="none"
                            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                          />
                          <div className="mt-1.5 flex items-center gap-3 text-xs">
                            <button type="button" onClick={() => { setPassword(generatePassword()); setShow(true); setCopied(false) }} className="font-medium text-blue-600 hover:text-blue-800">New one</button>
                            <button type="button" onClick={() => setShow(s => !s)} className="text-gray-500 hover:text-gray-700">{show ? 'Hide' : 'Show'}</button>
                            {password && <button type="button" onClick={handleCopy} className="text-gray-500 hover:text-gray-700">{copied ? 'Copied' : 'Copy'}</button>}
                          </div>
                          <p className="mt-1 text-xs text-gray-500">They are made to choose their own the first time they sign in.</p>
                        </div>
                      )}
                    </div>

                    <InviteMessageFields draft={draft} onChange={update} onReset={reset} />

                    <div>
                      <button type="button" onClick={() => setPreview(p => !p)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                        {preview ? 'Hide preview' : 'Preview the email'}
                      </button>
                      {preview && (
                        <div className="mt-2">
                          <InvitePreview draft={draft} fullName={fullName} email={email} password={newPassword ? password : null} sender={sender} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                    <button onClick={handleTest} disabled={isPending} className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
                      Send me a test
                    </button>
                    <div className="flex gap-2">
                      <button onClick={handleClose} disabled={isPending} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                      <button
                        onClick={handleSend}
                        disabled={isPending || (newPassword && !password)}
                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                      >
                        {isPending ? 'Sending…' : 'Send invite'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
