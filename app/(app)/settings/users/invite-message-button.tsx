'use client'

import { useState, useTransition } from 'react'
import { saveInviteMessage, sendInviteTest } from './actions'
import {
  validateInviteContent, DEFAULT_INVITE_INTRO, DEFAULT_INVITE_SUBJECT, DEFAULT_WHATS_NEW,
  type InviteContent, type InviteSender,
} from '@/lib/invite-email'
import { InviteMessageFields, InvitePreview } from './invite-fields'

const STANDARD: InviteContent = { subject: DEFAULT_INVITE_SUBJECT, intro: DEFAULT_INVITE_INTRO, whatsNew: DEFAULT_WHATS_NEW }

/** Edits the wording every invite uses (saved for the whole company), with a live preview and a test send to yourself. */
export function InviteMessageButton({ saved, sender, senderEmail }: {
  saved: InviteContent
  sender: InviteSender
  senderEmail: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<InviteContent>(saved)
  const [preview, setPreview] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    setDraft(saved); setError(null); setNote(null); setPreview(true)
    setOpen(true)
  }

  function handleSave() {
    const problem = validateInviteContent(draft)
    if (problem) { setError(problem); return }
    setError(null); setNote(null)
    const isStandard = draft.subject === STANDARD.subject && draft.intro === STANDARD.intro && draft.whatsNew === STANDARD.whatsNew
    startTransition(async () => {
      const r = await saveInviteMessage(isStandard ? null : draft)
      if (r.ok) setOpen(false)
      else setError(r.error ?? 'Something went wrong.')
    })
  }

  function handleTest() {
    const problem = validateInviteContent(draft)
    if (problem) { setError(problem); return }
    setError(null); setNote(null)
    startTransition(async () => {
      const r = await sendInviteTest(draft)
      if (r.ok) setNote(`Test sent to ${r.to}. It shows a sample password; nobody's password was changed.`)
      else setError(r.error ?? 'Something went wrong.')
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
        title="Change what the invite email says"
      >
        Invite message
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={isPending ? undefined : () => setOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
            <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl p-6 my-auto">
              <h2 className="text-base font-bold text-gray-900 mb-1">Invite message</h2>
              <p className="text-xs text-gray-500 mb-4">
                What every <b>Send invite</b>{' '}email says. Save it once; each click on a person&apos;s row sends it to them with their own login.
              </p>

              {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
              {note && <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">{note}</div>}

              <InviteMessageFields draft={draft} onChange={patch => setDraft(d => ({ ...d, ...patch }))} onReset={() => setDraft(STANDARD)} />

              <div className="mt-3">
                <button type="button" onClick={() => setPreview(p => !p)} className="text-xs font-medium text-blue-600 hover:text-blue-800">
                  {preview ? 'Hide preview' : 'Preview the email'}
                </button>
                {preview && (
                  <div className="mt-2">
                    <InvitePreview draft={draft} fullName="Sample Person" email="name@example.com" password="Sample-Pass7" sender={sender} />
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                <button onClick={handleTest} disabled={isPending} className="text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50" title={`Sends this wording to ${senderEmail}`}>
                  Send me a test
                </button>
                <div className="flex gap-2">
                  <button onClick={() => setOpen(false)} disabled={isPending} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
                  <button onClick={handleSave} disabled={isPending} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                    {isPending ? 'Saving…' : 'Save message'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
