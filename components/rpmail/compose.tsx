'use client'

import { useEffect, useState } from 'react'
import { Paperclip, Send, X } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import type { BoxInfo } from '@/lib/rpmail/overview'
import { api } from './rpmail-app'

// New message, reply, reply all, forward, and the signature editor.
// Send always asks first ("Send this to ... from ...?"). Nothing goes out any other way.

export type ComposeStart =
  | { mode: 'new'; mailbox: string }
  | { mode: 'reply' | 'forward'; mailbox: string; id: string; all?: boolean }
  | { mode: 'signature'; mailbox: string }

type Prep = { from: string; to: string; cc: string; subject: string; quoted: string; forward: boolean; attachments: string[]; signature: string }
const lab = 'rp-label block mb-1'

export function Compose({ start, boxes, onClose, onDone }: { start: ComposeStart; boxes: BoxInfo[]; onClose: () => void; onDone: (text: string) => void }) {
  const connected = boxes.filter(b => b.connected)
  const [mailbox, setMailbox] = useState(start.mailbox)
  const startSig = boxes.find(b => b.id === start.mailbox)?.signature ?? ''
  const [to, setTo] = useState(''), [cc, setCc] = useState(''), [subject, setSubject] = useState('')
  const [body, setBody] = useState(start.mode === 'signature' ? startSig : start.mode === 'new' && startSig ? '\n\n' + startSig : '')
  const [prep, setPrep] = useState<Prep | null>(null)
  const [quote, setQuote] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [loading, setLoading] = useState(start.mode === 'reply' || start.mode === 'forward')
  const box = boxes.find(b => b.id === mailbox)

  useEffect(() => {
    if (start.mode === 'signature' || start.mode === 'new') return
    let live = true
    api<Prep>('draft_prep', undefined, { mailbox: start.mailbox, id: start.id, all: start.all ? '1' : '', fwd: start.mode === 'forward' ? '1' : '' })
      .then(p => { if (!live) return; setPrep(p); setTo(p.to); setCc(p.cc); setSubject(p.subject); setBody(p.signature ? '\n\n' + p.signature : ''); setLoading(false) })
      .catch(e => { if (live) { setErr((e as Error).message); setLoading(false) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new message takes the signature of whichever mailbox it is written from, as long as nothing has been typed yet.
  const pickBox = (id: string) => {
    const old = boxes.find(b => b.id === mailbox)?.signature ?? '', next = boxes.find(b => b.id === id)?.signature ?? ''
    if (body.trim() === old.trim()) setBody(next ? '\n\n' + next : '')
    setMailbox(id)
  }

  const go = async (draft: boolean) => {
    setBusy(true); setErr('')
    try {
      if (start.mode === 'signature') { await api('signature', { mailbox, text: body }); onDone('Signature saved.'); return }
      const r = await api<{ sent?: boolean; to?: string; from: string }>('send', {
        mailbox, mode: start.mode, id: 'id' in start ? start.id : undefined, to, cc, subject, body, quote, draft, confirmed: !draft })
      onDone(r.sent ? `Sent to ${r.to} from ${r.from}.` : `Saved to Drafts in ${r.from}. Nothing was sent.`)
    } catch (e) { setErr((e as Error).message); setConfirm(false) }
    setBusy(false)
  }

  const title = start.mode === 'signature' ? 'Signature for ' + (box?.name ?? '') : start.mode === 'new' ? 'New message' : start.mode === 'forward' ? 'Forward' : 'Reply'
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className="rp-card w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto">
        <div className="rp-card-head"><h2 className="rp-card-title">{title}</h2><button onClick={onClose} aria-label="Close"><X className="size-5" /></button></div>
        <div className="p-4 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Getting the message ready...</p>}
          {!loading && start.mode === 'signature' && (
            <div><label className={lab}>Added to the end of what you write from {box?.address}</label><textarea className="rp-input min-h-[160px] font-sans" value={body} onChange={e => setBody(e.target.value)} /></div>
          )}
          {!loading && start.mode !== 'signature' && (<>
            <div>
              <label className={lab}>From</label>
              {start.mode === 'new' && connected.length > 1
                ? <select className="rp-input" value={mailbox} onChange={e => pickBox(e.target.value)}>{connected.map(b => <option key={b.id} value={b.id}>{b.name} ({b.address})</option>)}</select>
                : <p className="text-sm text-foreground">{box?.name} &lt;{box?.address}&gt;</p>}
              {box?.crew_reads && <p className="mt-1 text-xs text-warning">The crew reads this mailbox and its Sent mail. Pricing is blocked from going out from it.</p>}
            </div>
            <div><label className={lab}>To</label><input className="rp-input" value={to} onChange={e => setTo(e.target.value)} placeholder="name@example.com, another@example.com" autoFocus={start.mode !== 'reply'} /></div>
            <div><label className={lab}>Cc</label><input className="rp-input" value={cc} onChange={e => setCc(e.target.value)} /></div>
            <div><label className={lab}>Subject</label><input className="rp-input" value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div><label className={lab}>Message</label><textarea className="rp-input min-h-[200px] font-sans" value={body} onChange={e => setBody(e.target.value)} autoFocus={start.mode === 'reply'} /></div>
            {prep && prep.attachments.length > 0 && <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5"><Paperclip className="size-3.5" />Goes along: {prep.attachments.join(', ')}</p>}
            {prep && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {prep.forward ? 'The forwarded message (always included)' : <label className="inline-flex items-center gap-1.5" onClick={e => e.stopPropagation()}><input type="checkbox" checked={quote} onChange={e => setQuote(e.target.checked)} />Include the message you are replying to</label>}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words max-h-48 overflow-y-auto rounded-md bg-raised p-2">{prep.quoted.slice(0, 6000)}</pre>
              </details>
            )}
          </>)}
          {err && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
          {!loading && (confirm ? (
            <div className="rounded-md border border-border bg-raised p-3 space-y-2">
              <p className="text-sm text-foreground">Send this to <b>{[to, cc].filter(Boolean).join(', ')}</b> from <b>{box?.address}</b>?</p>
              <div className="flex gap-2">
                <button className={buttonVariants({ variant: 'default' })} disabled={busy} onClick={() => go(false)}><Send />{busy ? 'Sending...' : 'Yes, send'}</button>
                <button className={buttonVariants({ variant: 'outline' })} disabled={busy} onClick={() => setConfirm(false)}>Back</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {start.mode === 'signature'
                ? <button className={buttonVariants({ variant: 'default' })} disabled={busy} onClick={() => go(false)}>Save signature</button>
                : <>
                    <button className={buttonVariants({ variant: 'default' })} disabled={busy || !to.trim()} onClick={() => { setErr(''); setConfirm(true) }}><Send />Send</button>
                    <button className={buttonVariants({ variant: 'outline' })} disabled={busy} onClick={() => go(true)}>Save draft</button>
                  </>}
              <button className={buttonVariants({ variant: 'ghost' })} disabled={busy} onClick={onClose}>Cancel</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
