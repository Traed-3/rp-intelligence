'use client'

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Send, X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  saveWorkOrderDocumentReview, dismissWorkOrderDocument, reopenWorkOrderDocument,
  relinkWorkOrderDocument, runDocumentExtraction, createTicketFromDocument,
  type ActionState,
} from '@/app/(app)/service/tickets/inbox/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'

export type ExistingTicket = { id: string; ticket_number: string }

export function WorkOrderDocReviewForm({
  docId,
  status,
  transcript,
  managerSignatureVerified,
  verifiedByName,
  verifiedAt,
  extractStatus,
  extractError,
  aiDraft,
  hasWorkOrder,
  existingTickets,
}: {
  docId: string
  status: string
  transcript: string | null
  managerSignatureVerified: boolean
  verifiedByName: string | null
  verifiedAt: string | null
  extractStatus: string
  extractError: string | null
  aiDraft: { transcript: string; manager_signature_visible: boolean; notes: string | null } | null
  hasWorkOrder: boolean
  existingTickets: ExistingTicket[]
}) {
  const router = useRouter()
  const closed = status === 'linked' || status === 'dismissed'
  const [saveState, saveAction, savePending] = useActionState<ActionState, FormData>(
    (s, fd) => saveWorkOrderDocumentReview(docId, s, fd), null,
  )
  const [linkState, linkAction, linkPending] = useActionState<ActionState, FormData>(
    (s, fd) => relinkWorkOrderDocument(docId, s, fd), null,
  )
  const [sendState, sendAction, sendPending] = useActionState<ActionState, FormData>(
    (s, fd) => createTicketFromDocument(docId, s, fd), null,
  )
  const [text, setText] = useState(transcript ?? '')
  const [verified, setVerified] = useState(managerSignatureVerified)
  const [isPending, startTransition] = useTransition()

  return (
    <div className="space-y-4">
      {aiDraft && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-semibold flex items-center gap-1.5 mb-1"><Sparkles className="w-3.5 h-3.5" />AI draft — check this, don't trust it</p>
          <p className={aiDraft.manager_signature_visible ? 'text-green-700' : 'text-amber-700'}>
            {aiDraft.manager_signature_visible ? 'Looks like it can see a separate manager/supervisor signature — verify for yourself below.' : "Doesn't look like it can see a separate manager signature — check carefully."}
          </p>
          {aiDraft.notes && <p className="mt-1 text-blue-800">{aiDraft.notes}</p>}
          {text !== aiDraft.transcript && (
            <button type="button" onClick={() => setText(aiDraft.transcript)} className="mt-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 underline">
              Reset transcript to the AI draft
            </button>
          )}
        </div>
      )}

      {extractStatus === 'pending' && <p className="text-xs text-gray-400">Drafting with AI…</p>}
      {extractStatus === 'failed' && <p className="text-xs text-red-600">AI draft failed{extractError ? `: ${extractError}` : ''} — type it up by hand, or try again.</p>}
      {extractStatus === 'skipped' && <p className="text-xs text-gray-400">{extractError ?? 'Not readable automatically — type it up by hand.'}</p>}

      {!closed && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(async () => { await runDocumentExtraction(docId); router.refresh() })}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />{isPending ? 'Drafting…' : extractStatus === 'done' ? 'Draft again with AI' : 'Draft with AI'}
        </button>
      )}

      <form action={saveAction} className="space-y-3">
        {saveState?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{saveState.error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">What the ticket says</label>
          <textarea
            name="transcript" rows={10} className={inp} value={text} onChange={e => setText(e.target.value)}
            disabled={closed}
            placeholder="Type up everything on the ticket: site, date, work performed, parts used, hours…"
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input type="checkbox" name="manager_signature_verified" checked={verified} onChange={e => setVerified(e.target.checked)} disabled={closed} className="mt-0.5" />
          <span>
            I've looked at the attachment and confirmed a manager's signature is on it.
            {managerSignatureVerified && verifiedByName && (
              <span className="block text-xs text-gray-400 mt-0.5">Verified by {verifiedByName}{verifiedAt ? ` on ${new Date(verifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
            )}
          </span>
        </label>
        {!closed && <Button type="submit" disabled={savePending} variant="outline">{savePending ? 'Saving…' : 'Save'}</Button>}
      </form>

      {!closed && (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          {!hasWorkOrder && (
            <form action={linkAction} className="flex items-end gap-2">
              {linkState?.error && <p className="text-xs text-red-600">{linkState.error}</p>}
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">No work order matched — link one</label>
                <input name="site_or_wo" className={inp} placeholder="Site # or WO#" />
              </div>
              <Button type="submit" disabled={linkPending} variant="outline" size="sm">{linkPending ? 'Linking…' : 'Link'}</Button>
            </form>
          )}

          <form action={sendAction} className="space-y-2">
            {sendState?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{sendState.error}</div>}
            {existingTickets.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Attach to an existing ticket instead of creating a new one</label>
                <select name="existing_ticket_id" className={inp} defaultValue="">
                  <option value="">— Create a new ticket —</option>
                  {existingTickets.map(t => <option key={t.id} value={t.id}>{t.ticket_number}</option>)}
                </select>
              </div>
            )}
            <Button
              type="submit"
              disabled={sendPending || !verified || !text.trim() || !hasWorkOrder}
              className="gap-2"
              title={!hasWorkOrder ? 'Link a work order first' : !verified ? "Confirm the manager's signature first" : !text.trim() ? 'Type up the ticket first' : undefined}
            >
              <Send className="w-4 h-4" />{sendPending ? 'Sending…' : 'Send to Ticket / Invoicing'}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => { if (window.confirm('Dismiss this? It was not a real completed ticket.')) startTransition(async () => { await dismissWorkOrderDocument(docId) }) }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-red-600"
          >
            <X className="w-3.5 h-3.5" />Dismiss — not a real ticket
          </button>
        </div>
      )}

      {status === 'dismissed' && (
        <button
          type="button"
          onClick={() => startTransition(async () => { await reopenWorkOrderDocument(docId); router.refresh() })}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          <RotateCcw className="w-3.5 h-3.5" />Reopen for review
        </button>
      )}
    </div>
  )
}
