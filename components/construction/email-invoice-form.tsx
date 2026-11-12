'use client'

import { useActionState } from 'react'
import { Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { emailInvoice, type EmailState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export type SentEmail = { id: string; to_emails: string[]; sent_at: string; status: string; error: string | null }

/** "Email this invoice" — PDF attached, logged, and the invoice flips to Invoiced on success. */
export function EmailInvoiceForm({ invoiceId, defaultTo, defaultSubject, defaultMessage, history, configured }: {
  invoiceId: string; defaultTo: string; defaultSubject: string; defaultMessage: string; history: SentEmail[]; configured: boolean
}) {
  const [state, action, pending] = useActionState(emailInvoice.bind(null, invoiceId), null as EmailState)
  return (
    <details className="rp-card mt-4" open={history.length === 0 && configured}>
      <summary className="px-5 py-3 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Mail className="w-4 h-4 text-blue-600" />Email this invoice{history.length > 0 && <span className="text-xs font-normal text-gray-400">· sent {history.length}×, last {new Date(history[0].sent_at).toLocaleDateString()}</span>}</summary>
      <div className="px-5 pb-5">
        {!configured && <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 mb-3">Email sending isn&apos;t switched on yet. Add <code>RESEND_API_KEY</code> (and <code>RESEND_FROM_EMAIL</code>, a verified sender) in Vercel → Settings → Environment Variables, then redeploy. Until then, use the PDF button and attach it yourself.</div>}
        <form action={action} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className={lbl} htmlFor="em-to">To <span className="font-normal text-gray-400">(comma-separate several)</span></label><input id="em-to" name="to" defaultValue={defaultTo} className={inp} required placeholder="ap@customer.com" /></div>
            <div><label className={lbl} htmlFor="em-cc">Cc</label><input id="em-cc" name="cc" className={inp} placeholder="rpinvoicing@gmail.com" /></div>
          </div>
          <div><label className={lbl} htmlFor="em-subject">Subject</label><input id="em-subject" name="subject" defaultValue={defaultSubject} className={inp} required /></div>
          <div><label className={lbl} htmlFor="em-message">Message</label><textarea id="em-message" name="message" defaultValue={defaultMessage} rows={5} className={inp} /></div>
          {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}
          {state?.ok && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Sent to {state.sentTo}. The invoice is now marked Invoiced.</div>}
          <Button type="submit" disabled={pending || !configured} className="gap-2"><Mail className="w-3.5 h-3.5" />{pending ? 'Sending…' : 'Send with PDF attached'}</Button>
        </form>
        {history.length > 0 && (
          <ul className="mt-4 text-xs text-gray-500 space-y-1">
            {history.map(h => <li key={h.id}>{new Date(h.sent_at).toLocaleString()} → {h.to_emails.join(', ')} {h.status === 'failed' ? <span className="text-red-600">failed: {h.error}</span> : <span className="text-green-700">sent</span>}</li>)}
          </ul>
        )}
      </div>
    </details>
  )
}
