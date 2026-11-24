'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sendUserInvite } from './actions'

export type InvitePerson = {
  id: string
  fullName: string
  email: string
  signedIn: boolean
  /** ISO time of the last invite, if any. */
  invitedAt: string | null
}

type RowState = 'waiting' | 'sending' | 'sent' | { error: string }

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })

/**
 * Invites many people at once with the company's Invite message. Each person gets their own email and (unless they
 * have signed in before) their own temporary password, made on the server. The emails go out one at a time so the
 * list shows progress and one failure does not stop the rest.
 */
export function BulkInviteButton({ people }: { people: InvitePerson[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resetSignedIn, setResetSignedIn] = useState(false)
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const stopRef = useRef(false)

  const fresh = useMemo(() => people.filter(p => !p.signedIn && !p.invitedAt), [people])
  const notSignedIn = useMemo(() => people.filter(p => !p.signedIn), [people])
  const chosen = people.filter(p => selected.has(p.id))
  const passwordCount = chosen.filter(p => !p.signedIn || resetSignedIn).length
  const sentCount = Object.values(rows).filter(r => r === 'sent').length
  const failed = people.filter(p => typeof rows[p.id] === 'object')
  const finished = !running && Object.keys(rows).length > 0

  function handleOpen() {
    setSelected(new Set(fresh.map(p => p.id)))
    setResetSignedIn(false); setRows({})
    setOpen(true)
  }

  function handleClose() {
    if (running) return
    setOpen(false)
    if (sentCount > 0) router.refresh()
  }

  function toggle(id: string) {
    setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function sendTo(list: InvitePerson[]) {
    stopRef.current = false
    setRunning(true)
    setRows(r => { const n = { ...r }; for (const p of list) n[p.id] = 'waiting'; return n })
    for (const p of list) {
      if (stopRef.current) break
      setRows(r => ({ ...r, [p.id]: 'sending' }))
      let state: RowState
      try {
        const res = await sendUserInvite(p.id, resetSignedIn ? { newPassword: true } : {})
        state = res.ok ? 'sent' : { error: res.error ?? 'Something went wrong.' }
      } catch (e) {
        state = { error: e instanceof Error ? e.message : 'Lost connection to the server.' }
      }
      setRows(r => ({ ...r, [p.id]: state }))
      await new Promise(r => setTimeout(r, 400))   // stay well under the email service's rate limit
    }
    // Anyone not reached because Stop was pressed goes back to unsent.
    setRows(r => { const n = { ...r }; for (const p of list) if (n[p.id] === 'waiting') delete n[p.id]; return n })
    setRunning(false)
  }

  const badge = (p: InvitePerson) => {
    const r = rows[p.id]
    if (r === 'sending') return <span className="text-xs text-blue-700">Sending…</span>
    if (r === 'waiting') return <span className="text-xs text-gray-400">Waiting</span>
    if (r === 'sent') return <span className="text-xs font-medium text-green-700">Sent ✓</span>
    if (typeof r === 'object') return <span className="text-xs text-red-700">{r.error}</span>
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        title="Email sign-in invites to several people at once"
      >
        ✉ Send invites{fresh.length ? ` (${fresh.length} not invited yet)` : ''}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={handleClose} />
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
            <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl p-6 my-auto">
              <h2 className="text-base font-bold text-gray-900 mb-1">Send invites</h2>
              <p className="text-xs text-gray-500 mb-4">
                Each person gets the Invite message with their own login. People who have not signed in yet get their own
                temporary password and choose their own the first time they sign in.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <p className="text-xs font-medium text-gray-600">{chosen.length} of {people.length} ticked</p>
                {!running && !finished && (
                  <div className="flex gap-3 text-xs">
                    <button type="button" onClick={() => setSelected(new Set(fresh.map(p => p.id)))} className="font-medium text-blue-600 hover:text-blue-800">Not invited yet</button>
                    <button type="button" onClick={() => setSelected(new Set(notSignedIn.map(p => p.id)))} className="font-medium text-blue-600 hover:text-blue-800">Not signed in</button>
                    <button type="button" onClick={() => setSelected(new Set(people.map(p => p.id)))} className="font-medium text-blue-600 hover:text-blue-800">Everyone</button>
                    <button type="button" onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-700">None</button>
                  </div>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                {people.map(p => (
                  <label key={p.id} className="flex items-start gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" className="mt-0.5" checked={selected.has(p.id)} disabled={running} onChange={() => toggle(p.id)} />
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900">{p.fullName}</span>{' '}
                      <span className="text-xs text-gray-500 break-all">{p.email}</span>
                      <span className="block text-xs text-gray-400">
                        {p.signedIn ? 'Has signed in' : 'Has not signed in'}
                        {p.invitedAt ? ` · invite sent ${shortDate(p.invitedAt)}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right max-w-[45%]">{badge(p)}</span>
                  </label>
                ))}
                {!people.length && <p className="px-3 py-4 text-sm text-gray-500">Nobody to invite. Disabled people have to be activated first.</p>}
              </div>
              {!running && !finished && (
                <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="mt-0.5" checked={resetSignedIn} onChange={e => setResetSignedIn(e.target.checked)} />
                  <span>Also give a new temporary password to people who have already signed in <span className="block text-xs text-gray-500">Off: they keep their password and the email tells them to use it.</span></span>
                </label>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                {running ? (
                  <>
                    <p className="text-sm text-gray-700">Sending… {sentCount} sent. Keep this window open.</p>
                    <button onClick={() => { stopRef.current = true }} className="px-4 py-2 rounded-lg border border-red-200 text-sm text-red-700 hover:bg-red-50">Stop after this one</button>
                  </>
                ) : finished ? (
                  <>
                    <p className="text-sm text-gray-700">{sentCount} sent{failed.length ? `, ${failed.length} did not go` : ''}.</p>
                    <div className="flex gap-2">
                      {failed.length > 0 && (
                        <button onClick={() => sendTo(failed)} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Retry {failed.length}</button>
                      )}
                      <button onClick={handleClose} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Done</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gray-500">
                      {passwordCount ? `${passwordCount} of them get a new temporary password.` : 'Nobody\'s password changes.'}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={handleClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                      <button onClick={() => sendTo(chosen)} disabled={!chosen.length} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        Send {chosen.length} invite{chosen.length === 1 ? '' : 's'}
                      </button>
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
