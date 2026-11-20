'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendUserInvite, sendInviteTest } from './actions'
import { validateInviteContent, type InviteSender } from '@/lib/invite-email'
import { InviteMessageFields, InvitePreview, useInviteDraft } from './invite-fields'

export type InvitePerson = {
  id: string
  fullName: string
  email: string
  signedIn: boolean
  /** ISO time of the last invite, if any. */
  invitedAt: string | null
}

type RowState = 'waiting' | 'sending' | 'sent' | { error: string; passwordChanged: boolean }

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })

/**
 * Invites many people at once. Each person gets their own email and (unless they have signed in before) their own
 * freshly made temporary password, made on the server. The emails go out one at a time so the list shows progress
 * and a failure for one person does not stop the rest.
 */
export function BulkInviteButton({ people, sender }: { people: InvitePerson[]; sender: InviteSender }) {
  const router = useRouter()
  const { draft, update, reset, reload } = useInviteDraft()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resetSignedIn, setResetSignedIn] = useState(false)
  const [preview, setPreview] = useState(false)
  const [step, setStep] = useState<'compose' | 'confirm' | 'sending' | 'done'>('compose')
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [error, setError] = useState<string | null>(null)
  const [testNote, setTestNote] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const stopRef = useRef(false)

  const notSignedIn = useMemo(() => people.filter(p => !p.signedIn), [people])
  const chosen = people.filter(p => selected.has(p.id))
  const passwordCount = chosen.filter(p => !p.signedIn || resetSignedIn).length
  const sentCount = Object.values(rows).filter(r => r === 'sent').length
  const failed = chosen.filter(p => typeof rows[p.id] === 'object')

  function handleOpen() {
    reload()
    setSelected(new Set(notSignedIn.filter(p => !p.invitedAt).map(p => p.id)))
    setResetSignedIn(false); setPreview(false); setStep('compose'); setRows({}); setError(null); setTestNote(null)
    setOpen(true)
  }

  function handleClose() {
    if (step === 'sending') return
    setOpen(false)
    if (sentCount > 0) router.refresh()
  }

  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  function handleReview() {
    const problem = validateInviteContent(draft)
    if (problem) { setError(problem); return }
    if (!chosen.length) { setError('Tick at least one person.'); return }
    setError(null)
    setStep('confirm')
  }

  async function handleTest() {
    const problem = validateInviteContent(draft)
    if (problem) { setError(problem); return }
    setError(null); setTestNote(null); setTesting(true)
    const r = await sendInviteTest({ ...draft, newPassword: true })
    setTesting(false)
    if (r.ok) setTestNote(`Test sent to ${r.to}. It shows a sample password; nobody's password was changed.`)
    else setError(r.error ?? 'Something went wrong.')
  }

  async function sendTo(list: InvitePerson[]) {
    stopRef.current = false
    setStep('sending')
    setRows(r => { const n = { ...r }; for (const p of list) n[p.id] = 'waiting'; return n })
    for (const p of list) {
      if (stopRef.current) break
      setRows(r => ({ ...r, [p.id]: 'sending' }))
      let state: RowState
      try {
        const res = await sendUserInvite(p.id, { ...draft, newPassword: !p.signedIn || resetSignedIn })
        state = res.ok ? 'sent' : { error: res.error ?? 'Something went wrong.', passwordChanged: !!res.passwordChanged }
      } catch (e) {
        state = { error: e instanceof Error ? e.message : 'Lost connection to the server.', passwordChanged: false }
      }
      setRows(r => ({ ...r, [p.id]: state }))
      await new Promise(r => setTimeout(r, 400))   // stay well under the email service's rate limit
    }
    // Anyone not reached because Stop was pressed goes back to unsent.
    setRows(r => { const n = { ...r }; for (const p of list) if (n[p.id] === 'waiting') delete n[p.id]; return n })
    setStep('done')
  }

  const badge = (p: InvitePerson) => {
    const r = rows[p.id]
    if (r === 'sending') return <span className="text-xs text-blue-700">Sending…</span>
    if (r === 'waiting') return <span className="text-xs text-gray-400">Waiting</span>
    if (r === 'sent') return <span className="text-xs font-medium text-green-700">Sent ✓</span>
    if (typeof r === 'object') return <span className="text-xs text-red-700">{r.error}{r.passwordChanged ? ' (password was changed)' : ''}</span>
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="px-4 py-2 rounded-lg border border-blue-300 bg-white text-blue-700 text-sm font-medium hover:bg-blue-50 transition-colors"
        title="Email sign-in invites (with temporary passwords and what's new) to several people at once"
      >
        ✉ Send invites{notSignedIn.length ? ` (${notSignedIn.length} not signed in)` : ''}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={handleClose} />
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
            <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl p-6 my-auto">
              <h2 className="text-base font-bold text-gray-900 mb-1">Send invites</h2>
              <p className="text-xs text-gray-500 mb-4">
                Each person gets their own email with the sign-in link and what&apos;s new. People who have not signed in yet also get
                their own temporary password and choose their own the first time they sign in.
              </p>

              {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
              {testNote && <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">{testNote}</div>}

              {/* ── Who ── */}
              <div className="mb-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <p className="text-xs font-medium text-gray-600">Send to ({chosen.length} of {people.length} ticked)</p>
                  {step === 'compose' && (
                    <div className="flex gap-3 text-xs">
                      <button type="button" onClick={() => setSelected(new Set(notSignedIn.map(p => p.id)))} className="font-medium text-blue-600 hover:text-blue-800">Not signed in yet</button>
                      <button type="button" onClick={() => setSelected(new Set(people.map(p => p.id)))} className="font-medium text-blue-600 hover:text-blue-800">Everyone</button>
                      <button type="button" onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-700">None</button>
                    </div>
                  )}
                </div>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                  {(step === 'compose' ? people : chosen).map(p => (
                    <label key={p.id} className={`flex items-start gap-2 px-3 py-2 text-sm ${step === 'compose' ? 'cursor-pointer hover:bg-gray-50' : ''}`}>
                      {step === 'compose' && (
                        <input type="checkbox" className="mt-0.5" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900">{p.fullName}</span>{' '}
                        <span className="text-xs text-gray-500 break-all">{p.email}</span>
                        <span className="block text-xs text-gray-400">
                          {p.signedIn ? 'Has signed in' : 'Has not signed in'}
                          {p.invitedAt ? ` · invite sent ${shortDate(p.invitedAt)}` : ''}
                          {step !== 'compose' && (!p.signedIn || resetSignedIn) ? ' · gets a new temporary password' : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right max-w-[45%]">{badge(p)}</span>
                    </label>
                  ))}
                  {!people.length && <p className="px-3 py-4 text-sm text-gray-500">Nobody to invite. Disabled people have to be activated first.</p>}
                </div>
                {step === 'compose' && (
                  <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
                    <input type="checkbox" className="mt-0.5" checked={resetSignedIn} onChange={e => setResetSignedIn(e.target.checked)} />
                    <span>Also give a new temporary password to people who have already signed in <span className="block text-xs text-gray-500">Off: they keep their password and the email tells them to use it.</span></span>
                  </label>
                )}
              </div>

              {/* ── What it says ── */}
              {step === 'compose' && (
                <div className="space-y-3">
                  <InviteMessageFields draft={draft} onChange={update} onReset={reset} />
                  <div>
                    <button type="button" onClick={() => setPreview(p => !p)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                      {preview ? 'Hide preview' : 'Preview the email'}
                    </button>
                    {preview && (
                      <div className="mt-2">
                        <InvitePreview
                          draft={draft}
                          fullName={chosen[0]?.fullName ?? 'Sample Person'}
                          email={chosen[0]?.email ?? 'name@example.com'}
                          password={chosen[0] && (chosen[0].signedIn && !resetSignedIn) ? null : 'Sample-Pass7'}
                          sender={sender}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Buttons ── */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                {step === 'compose' ? (
                  <>
                    <button onClick={handleTest} disabled={testing} className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50">
                      {testing ? 'Sending test…' : 'Send me a test'}
                    </button>
                    <div className="flex gap-2">
                      <button onClick={handleClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                      <button onClick={handleReview} disabled={!chosen.length} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                        Next: review {chosen.length}
                      </button>
                    </div>
                  </>
                ) : step === 'confirm' ? (
                  <>
                    <p className="text-sm text-gray-800">
                      Email <b>{chosen.length}</b> {chosen.length === 1 ? 'person' : 'people'}
                      {passwordCount ? <> and give <b>{passwordCount}</b> of them a new temporary password</> : ''}?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setStep('compose')} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Back</button>
                      <button onClick={() => sendTo(chosen)} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
                        Yes, send {chosen.length}
                      </button>
                    </div>
                  </>
                ) : step === 'sending' ? (
                  <>
                    <p className="text-sm text-gray-700">Sending… {sentCount} of {chosen.length} sent. Keep this window open.</p>
                    <button onClick={() => { stopRef.current = true }} className="px-4 py-2 rounded-lg border border-red-200 text-sm text-red-700 hover:bg-red-50">Stop after this one</button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-700">
                      {sentCount} sent{failed.length ? `, ${failed.length} did not go` : ''}.
                    </p>
                    <div className="flex gap-2">
                      {failed.length > 0 && (
                        <button onClick={() => sendTo(failed)} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Retry {failed.length}</button>
                      )}
                      <button onClick={handleClose} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Done</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
