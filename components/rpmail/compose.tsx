'use client'

import { useEffect, useRef, useState } from 'react'
import { Paperclip, Send, X, FileText, Trash2 } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { BoxInfo } from '@/lib/rpmail/overview'
import { api } from './rpmail-app'

// New message, reply, reply all, forward, and the signature editor.
// Send always asks first ("Send this to ... from ...?"), and then waits a few seconds so it can be undone.
// Nothing goes out any other way. What is typed is kept in this browser until it is sent, saved or discarded.

export type ComposeStart =
  | { mode: 'new'; mailbox: string }
  | { mode: 'reply' | 'forward'; mailbox: string; id: string; all?: boolean }
  | { mode: 'signature'; mailbox: string }

/** Everything the server needs to send one message, plus the words for the "Sending..." bar. */
export type Outgoing = { payload: Record<string, unknown>; to: string; from: string; start: ComposeStart }

type Prep = { from: string; to: string; cc: string; subject: string; quoted: string; forward: boolean; attachments: string[]; signature: string }
type Att = { path: string; name: string; size: number }
type Tpl = { id: string; name: string; body: string }
type Saved = { to: string; cc: string; subject: string; body: string; from: string; files: Att[]; at: number }
const lab = 'rp-label block mb-1'
const OUTBOX = 'rpmail-outbox'
const MAX = 20_000_000
const UNDO_CHOICES = [0, 5, 10, 20, 30]
const mb = (n: number) => n > 1_048_576 ? (n / 1_048_576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'

const draftKey = (s: ComposeStart) => `rpmail:draft:${s.mode}:${s.mailbox}:${'id' in s ? s.id + (s.all ? ':all' : '') : 'new'}`
const readDraft = (s: ComposeStart): Saved | null => {
  try { const v = JSON.parse(localStorage.getItem(draftKey(s)) ?? 'null') as Saved | null; return v && Date.now() - v.at < 14 * 86_400_000 ? v : null } catch { return null }
}
export const clearDraft = (s: ComposeStart) => { try { localStorage.removeItem(draftKey(s)) } catch { /* private window: nothing was kept */ } }

export function Compose({ start, boxes, undoSecs, setUndoSecs, onClose, onDone, onSend }: {
  start: ComposeStart; boxes: BoxInfo[]; undoSecs: number; setUndoSecs: (n: number) => void
  onClose: () => void; onDone: (text: string) => void; onSend: (out: Outgoing) => void }) {
  const connected = boxes.filter(b => b.connected)
  const [kept] = useState(() => start.mode === 'signature' ? null : readDraft(start))
  const startSig = boxes.find(b => b.id === start.mailbox)?.signature ?? ''
  const [from, setFrom] = useState(kept?.from && connected.some(b => b.id === kept.from) ? kept.from : start.mailbox)
  const [to, setTo] = useState(kept?.to ?? ''), [cc, setCc] = useState(kept?.cc ?? ''), [subject, setSubject] = useState(kept?.subject ?? '')
  const [body, setBody] = useState(kept?.body ?? (start.mode === 'signature' ? startSig : start.mode === 'new' && startSig ? '\n\n' + startSig : ''))
  const [files, setFiles] = useState<Att[]>(kept?.files ?? [])
  const [prep, setPrep] = useState<Prep | null>(null)
  const [quote, setQuote] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [uploading, setUploading] = useState(0)
  const [over, setOver] = useState(false)
  const [restored, setRestored] = useState(!!kept)
  const [tpls, setTpls] = useState<Tpl[] | null>(null)
  const [tplName, setTplName] = useState<string | null>(null)   // null = not naming a template right now
  const [loading, setLoading] = useState(start.mode === 'reply' || start.mode === 'forward')
  const box = boxes.find(b => b.id === from)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const isMail = start.mode !== 'signature'

  useEffect(() => {
    if (start.mode === 'signature' || start.mode === 'new') return
    let live = true
    api<Prep>('draft_prep', undefined, { mailbox: start.mailbox, id: start.id, all: start.all ? '1' : '', fwd: start.mode === 'forward' ? '1' : '' })
      .then(p => {
        if (!live) return
        setPrep(p)
        if (!kept) { setTo(p.to); setCc(p.cc); setSubject(p.subject); setBody(p.signature ? '\n\n' + p.signature : '') }
        setLoading(false)
      })
      .catch(e => { if (live) { setErr((e as Error).message); setLoading(false) } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (isMail) api<{ templates: Tpl[] }>('templates').then(r => setTpls(r.templates)).catch(() => setTpls([])) }, [isMail])

  // Keep what is typed in this browser, a moment after typing stops, so a closed tab or a refresh loses nothing.
  useEffect(() => {
    if (!isMail || loading) return
    const t = setTimeout(() => {
      const empty = !to && !cc && !files.length && (!body.trim() || body.trim() === (box?.signature ?? '').trim()) && (start.mode !== 'new' || !subject)
      try { if (empty) localStorage.removeItem(draftKey(start)); else localStorage.setItem(draftKey(start), JSON.stringify({ to, cc, subject, body, from, files, at: Date.now() } satisfies Saved)) } catch { /* storage is off: carry on without it */ }
    }, 1200)
    return () => clearTimeout(t)
  }, [to, cc, subject, body, from, files, isMail, loading, start, box])

  // The signature follows the From mailbox as long as nothing else has been typed.
  const pickFrom = (id: string) => {
    const old = boxes.find(b => b.id === from)?.signature ?? '', next = boxes.find(b => b.id === id)?.signature ?? ''
    if (body.trim() === old.trim()) setBody(next ? '\n\n' + next : '')
    setFrom(id); setConfirm(false)
  }

  const addFiles = async (list: File[]) => {
    if (!list.length) return
    setErr('')
    let total = files.reduce((n, f) => n + f.size, 0)
    for (const file of list) {
      if (total + file.size > MAX) { setErr(`${file.name} would take the attachments over 20 MB, which is more than email can carry.`); continue }
      total += file.size
      setUploading(n => n + 1)
      try {
        const name = file.name || `pasted-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
        const t = await api<{ path: string; token: string }>('attach_prepare', { name, size: file.size })
        const { error } = await createClient().storage.from(OUTBOX).uploadToSignedUrl(t.path, t.token, file, { contentType: file.type || undefined })
        if (error) throw new Error(`${name} did not upload. Try again.`)
        setFiles(f => [...f, { path: t.path, name: t.path.split('/')[2] ?? name, size: file.size }])
      } catch (e) { setErr((e as Error).message) }
      setUploading(n => n - 1)
    }
  }

  const removeFile = (a: Att) => { setFiles(f => f.filter(x => x.path !== a.path)); void api('attach_remove', { path: a.path }).catch(() => null) }

  const discard = () => {
    for (const a of files) void api('attach_remove', { path: a.path }).catch(() => null)
    clearDraft(start); onClose()
  }

  const payload = (draft: boolean) => ({
    mailbox: start.mailbox, from, mode: start.mode, id: 'id' in start ? start.id : undefined, to, cc, subject, body, quote, draft, confirmed: !draft, files: files.map(f => f.path),
  })

  const go = async (draft: boolean) => {
    setErr('')
    if (uploading) { setErr('A file is still uploading. Give it a moment.'); return }
    if (start.mode === 'signature') {
      setBusy(true)
      try { await api('signature', { mailbox: start.mailbox, text: body }); onDone('Signature saved.') } catch (e) { setErr((e as Error).message) }
      setBusy(false); return
    }
    if (!draft) {
      // Written down right now (not a moment later), so Undo or a failed send can open it again exactly as it was.
      try { localStorage.setItem(draftKey(start), JSON.stringify({ to, cc, subject, body, from, files, at: Date.now() } satisfies Saved)) } catch { /* storage is off */ }
      onSend({ payload: payload(false), to: [to, cc].filter(Boolean).join(', '), from: box?.address ?? '', start }); return
    }
    setBusy(true)
    try {
      const r = await api<{ from: string }>('send', payload(true))
      clearDraft(start)
      onDone(`Saved to Drafts in ${r.from}. Nothing was sent.`)
    } catch (e) { setErr((e as Error).message); setConfirm(false) }
    setBusy(false)
  }

  const insertTpl = (t: Tpl) => {
    const el = bodyRef.current, at = el ? el.selectionStart : 0
    setBody(b => b.slice(0, at) + t.body + (b.slice(at).startsWith('\n') || !b.slice(at) ? '' : '\n') + b.slice(at))
  }
  const saveTpl = async () => {
    const sig = (box?.signature ?? '').trim()
    const text = sig && body.trim().endsWith(sig) ? body.trim().slice(0, -sig.length).trim() : body.trim()
    if (!text) { setErr('Type the wording first, then save it as a template.'); setTplName(null); return }
    const name = (tplName ?? '').trim()
    if (!name) { setErr('Give the template a name.'); return }
    try { await api('template_save', { name, body: text }); setTpls((await api<{ templates: Tpl[] }>('templates')).templates); setTplName(null); setErr('') } catch (e) { setErr((e as Error).message) }
  }
  const delTpl = async (t: Tpl) => {
    if (!window.confirm(`Delete the template "${t.name}"?`)) return
    try { await api('template_delete', { id: t.id }); setTpls(l => (l ?? []).filter(x => x.id !== t.id)) } catch (e) { setErr((e as Error).message) }
  }

  const title = start.mode === 'signature' ? 'Signature for ' + (box?.name ?? '') : start.mode === 'new' ? 'New message' : start.mode === 'forward' ? 'Forward' : 'Reply'
  const total = files.reduce((n, f) => n + f.size, 0)
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      <div className={cn('rp-card w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto', over && 'ring-2 ring-primary')}
        onDragOver={e => { if (isMail && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { if (!isMail) return; e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]) }}>
        <div className="rp-card-head"><h2 className="rp-card-title">{title}</h2><button onClick={onClose} aria-label="Close" title="Close (what you typed is kept)"><X className="size-5" /></button></div>
        <div className="p-4 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Getting the message ready...</p>}
          {restored && !loading && (
            <p className="rounded-md border border-info/30 bg-info-soft px-3 py-2 text-xs text-foreground">Picked up where you left off. <button className="underline" onClick={() => { discard() }}>Throw it away</button> <button className="underline ml-2" onClick={() => setRestored(false)}>OK</button></p>
          )}
          {!loading && start.mode === 'signature' && (
            <div><label className={lab}>Added to the end of what you write from {box?.address}</label><textarea className="rp-input min-h-[160px] font-sans" value={body} onChange={e => setBody(e.target.value)} /></div>
          )}
          {!loading && isMail && (<>
            <div>
              <label className={lab}>From</label>
              {connected.length > 1
                ? <select className="rp-input" value={from} onChange={e => pickFrom(e.target.value)}>{connected.map(b => <option key={b.id} value={b.id}>{b.name} ({b.address})</option>)}</select>
                : <p className="text-sm text-foreground">{box?.name} &lt;{box?.address}&gt;</p>}
              {from !== start.mailbox && start.mode !== 'new' && <p className="mt-1 text-xs text-muted-foreground">This goes out from a different mailbox than the one the message is in. The sent copy will be in {box?.name}.</p>}
              {box?.crew_reads && <p className="mt-1 text-xs text-warning">The crew reads this mailbox and its Sent mail. Pricing is blocked from going out from it.</p>}
            </div>
            <AddrInput label="To" value={to} onChange={setTo} autoFocus={start.mode !== 'reply'} placeholder="Start typing a name or address" />
            <AddrInput label="Cc" value={cc} onChange={setCc} />
            <div><label className={lab}>Subject</label><input className="rp-input" value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="rp-label">Message</label>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {tpls && tpls.length > 0 && (
                    <select className="rp-input !w-auto !py-1 text-xs" value="" onChange={e => { const t = tpls.find(x => x.id === e.target.value); if (t) insertTpl(t) }} aria-label="Insert a template">
                      <option value="">Insert a template...</option>{tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  {tplName === null
                    ? <button className="underline" type="button" onClick={() => setTplName('')}><FileText className="inline size-3" /> Save as template</button>
                    : <span className="inline-flex items-center gap-1.5">
                        <input className="rp-input !w-44 !py-1 text-xs" autoFocus placeholder="Name, e.g. Permit received" value={tplName} onChange={e => setTplName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveTpl() } else if (e.key === 'Escape') { e.stopPropagation(); setTplName(null) } }} />
                        <button className="underline" type="button" onClick={() => void saveTpl()}>Save</button>
                        <button className="underline" type="button" onClick={() => setTplName(null)}>Cancel</button>
                      </span>}
                </span>
              </div>
              <textarea ref={bodyRef} className="rp-input min-h-[200px] font-sans" value={body} onChange={e => setBody(e.target.value)} autoFocus={start.mode === 'reply'}
                onPaste={e => { const imgs = [...e.clipboardData.files]; if (imgs.length) { e.preventDefault(); void addFiles(imgs) } }} />
            </div>
            {tpls && tpls.length > 0 && (
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Manage templates ({tpls.length})</summary>
                <ul className="mt-1 space-y-0.5">{tpls.map(t => <li key={t.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{t.name}</span><button className="hover:text-danger" onClick={() => void delTpl(t)} aria-label={'Delete ' + t.name}><Trash2 className="size-3.5" /></button></li>)}</ul>
              </details>
            )}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <label className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'cursor-pointer')}><Paperclip />Attach files
                  <input type="file" multiple className="sr-only" onChange={e => { void addFiles([...(e.target.files ?? [])]); e.target.value = '' }} /></label>
                <span className="text-xs text-muted-foreground">{uploading ? `Uploading ${uploading}...` : files.length ? `${files.length} attached, ${mb(total)} of 20 MB` : 'Or drag files onto this box, or paste a picture.'}</span>
              </div>
              {files.length > 0 && <div className="flex flex-wrap gap-1.5">{files.map(a => (
                <span key={a.path} className="rp-pill !py-1"><Paperclip className="size-3" />{a.name} <span className="text-muted-foreground">{mb(a.size)}</span>
                  <button onClick={() => removeFile(a)} aria-label={'Remove ' + a.name} title="Remove"><X className="size-3" /></button></span>
              ))}</div>}
              {prep && prep.attachments.length > 0 && <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5"><Paperclip className="size-3.5" />Goes along from the original: {prep.attachments.join(', ')}</p>}
            </div>
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
              <p className="text-sm text-foreground">Send this to <b>{[to, cc].filter(Boolean).join(', ')}</b> from <b>{box?.address}</b>{files.length ? <> with <b>{files.length}</b> attached</> : null}?</p>
              <div className="flex flex-wrap items-center gap-2">
                <button className={buttonVariants({ variant: 'default' })} disabled={busy || uploading > 0} onClick={() => void go(false)}><Send />Yes, send</button>
                <button className={buttonVariants({ variant: 'outline' })} disabled={busy} onClick={() => setConfirm(false)}>Back</button>
                <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">Time to undo
                  <select className="rp-input !w-auto !py-1 text-xs" value={undoSecs} onChange={e => setUndoSecs(Number(e.target.value))}>
                    {UNDO_CHOICES.map(n => <option key={n} value={n}>{n ? n + ' seconds' : 'none'}</option>)}
                  </select>
                </label>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {start.mode === 'signature'
                ? <button className={buttonVariants({ variant: 'default' })} disabled={busy} onClick={() => void go(false)}>Save signature</button>
                : <>
                    <button className={buttonVariants({ variant: 'default' })} disabled={busy || !to.trim()} onClick={() => { setErr(''); setConfirm(true) }}><Send />Send</button>
                    <button className={buttonVariants({ variant: 'outline' })} disabled={busy || uploading > 0} onClick={() => void go(true)}>Save to Gmail Drafts</button>
                  </>}
              <button className={buttonVariants({ variant: 'ghost' })} disabled={busy} onClick={onClose}>{isMail ? 'Close (keeps it)' : 'Cancel'}</button>
              {isMail && <button className={cn(buttonVariants({ variant: 'ghost' }), 'text-danger')} disabled={busy} onClick={() => { if (window.confirm('Throw this message away?')) discard() }}><Trash2 />Discard</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** An address line that offers people from your own mail as you type. Several addresses are separated by commas. */
function AddrInput({ label, value, onChange, autoFocus, placeholder }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
  const [hits, setHits] = useState<{ name: string; addr: string }[]>([])
  const [at, setAt] = useState(0)
  const [open, setOpen] = useState(false)
  const last = value.split(/[,;]/).pop()?.trim() ?? ''
  useEffect(() => {
    if (!open || last.length < 2 || /^\S+@\S+\.\w{2,}$/.test(last)) return
    let live = true
    const t = setTimeout(() => { api<{ contacts: { name: string; addr: string }[] }>('contacts', undefined, { q: last }).then(r => { if (live) { setHits(r.contacts); setAt(0) } }).catch(() => null) }, 220)
    return () => { live = false; clearTimeout(t) }
  }, [last, open])
  const shown = open && last.length >= 2 ? hits : []
  const pick = (addr: string) => {
    const parts = value.split(/[,;]/); parts.pop()
    onChange([...parts.map(p => p.trim()).filter(Boolean), addr].join(', ') + ', ')
    setHits([])
  }
  return (
    <div className="relative">
      <label className={lab}>{label}</label>
      <input className="rp-input" value={value} autoFocus={autoFocus} placeholder={placeholder} autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!shown.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt(i => Math.min(shown.length - 1, i + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(i => Math.max(0, i - 1)) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(shown[at].addr) }
          else if (e.key === 'Escape') { e.stopPropagation(); setHits([]) }
        }} />
      {shown.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 rp-card py-1 text-sm shadow-lg max-h-56 overflow-y-auto" role="listbox">
          {shown.map((c, i) => (
            <li key={c.addr} role="option" aria-selected={i === at} className={cn('px-3 py-1.5 cursor-pointer', i === at ? 'bg-primary/10' : 'hover:bg-raised')} onMouseDown={e => { e.preventDefault(); pick(c.addr) }}>
              {c.name && <span className="text-foreground">{c.name} </span>}<span className="text-muted-foreground">{c.addr}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
