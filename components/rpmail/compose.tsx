'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, Send, X, FileText, Trash2, Clock } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { BoxInfo } from '@/lib/rpmail/overview'
import { api } from './rpmail-app'
import { RichEditor, type RichHandle } from './rich-editor'
import { useAsk } from './ask'
import { cleanRich, sameWords, textToHtml, withoutEnding } from '@/lib/rpmail/rich'

// New message, reply, reply all, forward, and the signature editor.
// Send always asks first ("Send this to ... from ...?"), and then waits a few seconds so it can be undone.
// Schedule asks for a time and then the same question with the time in it; the message waits in Drafts and goes out then.
// Nothing goes out any other way. What is typed is kept in this browser until it is sent, saved or discarded.
// The message is written in a box with formatting (rich-editor.tsx): `html` is what is in the box, `body` the same words as plain text.

export type ComposeStart =
  | { mode: 'new'; mailbox: string }
  | { mode: 'reply' | 'forward'; mailbox: string; id: string; all?: boolean }
  | { mode: 'signature'; mailbox: string }
  /** A draft saved in Gmail Drafts, opened again to finish. It is updated or sent in place. */
  | { mode: 'draft'; mailbox: string; draft: string }

/** Everything the server needs to send one message, plus the words for the "Sending..." bar. */
export type Outgoing = { payload: Record<string, unknown>; to: string; from: string; start: ComposeStart }

type Prep = { from: string; to: string; cc: string; subject: string; quoted: string; forward: boolean; attachments: string[]; signature: string; signature_html?: string | null }
type Att = { path: string; name: string; size: number }
type Tpl = { id: string; name: string; body: string; html?: string | null }
type Saved = { to: string; cc: string; subject: string; body: string; html?: string; from: string; files: Att[]; pics?: Att[]; keep?: number[]; at: number }
type DraftFile = { i: number; name: string; size: number }
type Opened = { draft: string; to: string; cc: string; subject: string; html: string; reply: boolean; attachments: DraftFile[]; scheduled_at?: number | null }
const lab = 'rp-label block mb-1'
const OUTBOX = 'rpmail-outbox'
const MAX = 20_000_000
const UNDO_CHOICES = [0, 5, 10, 20, 30]
/** A signature as it goes into the message box: with its formatting when it has any, under two empty lines to type on. */
const sigHtml = (b?: { signature: string; signature_html?: string | null } | null) => b ? (b.signature_html || textToHtml(b.signature)) : ''
const underGap = (sig: string) => sig ? '<div><br></div><div><br></div>' + sig : ''

const PICTURE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/**
 * Gets a picture ready to sit in the text of a message: one of the four kinds mail programs show, and no bigger than it
 * needs to be (a phone photo is scaled down to 1600 across, which is plenty on a screen and a fraction of the size).
 */
async function fitPicture(file: File): Promise<File> {
  const ext = PICTURE_EXT[file.type]
  if (!ext) throw new Error('Only PNG, JPEG, GIF and WebP pictures can go in the text. Attach this one as a file instead.')
  const base = (file.name || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[^\w .()-]/g, '_').trim().slice(0, 80) || `picture-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
  const named = (blob: Blob, type: string) => new File([blob], `${base}.${PICTURE_EXT[type]}`, { type })
  if (file.type === 'image/gif') return named(file, file.type)          // may be animated: left as it is
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) return named(file, file.type)
  const long = Math.max(bmp.width, bmp.height)
  if (long <= 1600 && file.size <= 1_500_000) { bmp.close(); return named(file, file.type) }
  const k = Math.min(1, 1600 / long), c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
  const g = c.getContext('2d')
  if (!g) { bmp.close(); return named(file, file.type) }
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)              // a see-through background would turn black as a JPEG
  g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close()
  const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.85))
  return blob && blob.size < file.size ? named(blob, 'image/jpeg') : named(file, file.type)
}

/** When a scheduled message goes out, the way people say it: "Wed, Nov 25, 8:00 AM". */
export const whenText = (t: number) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** The quick choices for Schedule, from now: this afternoon (in the morning only), tomorrow morning and afternoon, Monday morning. */
export function laterChoices(now = new Date()): { label: string; at: number }[] {
  const at = (days: number, hour: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.getTime() }
  const out: { label: string; at: number }[] = []
  if (now.getHours() < 11) out.push({ label: 'This afternoon', at: at(0, 13) })
  out.push({ label: 'Tomorrow morning', at: at(1, 8) }, { label: 'Tomorrow afternoon', at: at(1, 13) })
  const toMonday = (8 - now.getDay()) % 7 || 7
  if (toMonday > 1) out.push({ label: 'Monday morning', at: at(toMonday, 8) })
  return out
}
/** The value a date-and-time box takes for a moment, in this computer's time. */
const localInput = (t: number) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000); return d.toISOString().slice(0, 16) }
const isProton = (addr?: string) => /@(proton\.me|pm\.me|protonmail\.com)$/i.test(addr ?? '')

const mb = (n: number) => n > 1_048_576 ? (n / 1_048_576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'

const draftKey = (s: ComposeStart) => `rpmail:draft:${s.mode}:${s.mailbox}:${'id' in s ? s.id + (s.all ? ':all' : '') : 'draft' in s ? s.draft : 'new'}`
const readDraft = (s: ComposeStart): Saved | null => {
  try { const v = JSON.parse(localStorage.getItem(draftKey(s)) ?? 'null') as Saved | null; return v && Date.now() - v.at < 14 * 86_400_000 ? v : null } catch { return null }
}
export const clearDraft = (s: ComposeStart) => { try { localStorage.removeItem(draftKey(s)) } catch { /* private window: nothing was kept */ } }

export function Compose({ start, boxes, groups, undoSecs, setUndoSecs, onClose, onDone, onSend }: {
  start: ComposeStart; boxes: BoxInfo[]; groups: { name: string; addrs: string[] }[]; undoSecs: number; setUndoSecs: (n: number) => void
  onClose: () => void; onDone: (text: string) => void; onSend: (out: Outgoing) => void }) {
  // Mail can only go out from a mailbox this person is allowed to send from (an owner can make a shared mailbox read only for someone).
  // A reopened draft lives in one mailbox, so it can only go out from that one.
  const connected = boxes.filter(b => b.connected && (start.mode === 'signature' || b.can_send !== false) && (start.mode !== 'draft' || b.id === start.mailbox))
  const [kept] = useState(() => start.mode === 'signature' ? null : readDraft(start))
  const startBox = boxes.find(b => b.id === start.mailbox)
  const startSig = startBox?.signature ?? ''
  const [from, setFrom] = useState(kept?.from && connected.some(b => b.id === kept.from) ? kept.from : connected.some(b => b.id === start.mailbox) ? start.mailbox : connected[0]?.id ?? start.mailbox)
  const [to, setTo] = useState(kept?.to ?? ''), [cc, setCc] = useState(kept?.cc ?? ''), [subject, setSubject] = useState(kept?.subject ?? '')
  const [body, setBody] = useState(kept?.body ?? (start.mode === 'signature' ? startSig : start.mode === 'new' && startSig ? '\n\n' + startSig : ''))
  // What the message box starts with: the kept draft with its formatting, else the plain starting text (the signature).
  const [html, setHtml] = useState(() => kept?.html ? cleanRich(kept.html).html : kept ? textToHtml(kept.body)
    : start.mode === 'signature' ? sigHtml(startBox) : start.mode === 'new' ? underGap(sigHtml(startBox)) : '')
  const editor = useRef<RichHandle>(null)
  const [files, setFiles] = useState<Att[]>(kept?.files ?? [])
  // Pictures placed in the text: every one uploaded for this message, and which of them are still in the text right now.
  const [pics, setPics] = useState<Att[]>(kept?.pics ?? [])
  const [inText, setInText] = useState<string[]>(() => start.mode === 'signature' ? [] : cleanRich(html).pictures)
  const [prep, setPrep] = useState<Prep | null>(null)
  const [quote, setQuote] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false), [err, setErr] = useState('')
  const [uploading, setUploading] = useState(0)
  const [over, setOver] = useState(false)
  const [restored, setRestored] = useState(!!kept)
  const [tpls, setTpls] = useState<Tpl[] | null>(null)
  const [tplName, setTplName] = useState<string | null>(null)   // null = not naming a template right now
  const [loading, setLoading] = useState(start.mode === 'reply' || start.mode === 'forward' || start.mode === 'draft')
  // The files a reopened draft already carries, and which of them stay on it.
  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([])
  const [keep, setKeep] = useState<number[] | null>(kept?.keep ?? null)
  const [isReply, setIsReply] = useState(false)
  // Schedule: null = not scheduling; { at: null } = picking a time; { at } = asking "send this ... at ...?". `from` = when Schedule was pressed.
  const [sched, setSched] = useState<{ at: number | null; from: number } | null>(null)
  const [pick, setPick] = useState('')
  const [scheduledAt, setScheduledAt] = useState<number | null>(null)
  const box = boxes.find(b => b.id === from)
  const isMail = start.mode !== 'signature'
  const [ask, asking] = useAsk()

  useEffect(() => {
    if (start.mode === 'signature' || start.mode === 'new') return
    let live = true
    if (start.mode === 'draft') {
      api<Opened>('draft_open', undefined, { mailbox: start.mailbox, draft: start.draft })
        .then(d => {
          if (!live) return
          setDraftFiles(d.attachments); setIsReply(d.reply); setScheduledAt(d.scheduled_at ?? null)
          setKeep(k => k ?? d.attachments.map(a => a.i))
          if (!kept) { const c = cleanRich(d.html); setTo(d.to); setCc(d.cc); setSubject(d.subject); setHtml(c.html); setBody(c.text) }
          setLoading(false)
        })
        .catch(e => { if (live) { setErr((e as Error).message); setLoading(false) } })
      return () => { live = false }
    }
    api<Prep>('draft_prep', undefined, { mailbox: start.mailbox, id: start.id, all: start.all ? '1' : '', fwd: start.mode === 'forward' ? '1' : '' })
      .then(p => {
        if (!live) return
        setPrep(p)
        if (!kept) { setTo(p.to); setCc(p.cc); setSubject(p.subject); setBody(p.signature ? '\n\n' + p.signature : ''); setHtml(underGap(sigHtml(p))) }
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
      const empty = !to && !cc && !files.length && (!body.trim() || sameWords(body, box?.signature ?? '')) && (start.mode !== 'new' || !subject)
      try { if (empty) localStorage.removeItem(draftKey(start)); else localStorage.setItem(draftKey(start), JSON.stringify({ to, cc, subject, body, html, from, files, pics, keep: keep ?? undefined, at: Date.now() } satisfies Saved)) } catch { /* storage is off: carry on without it */ }
    }, 1200)
    return () => clearTimeout(t)
  }, [to, cc, subject, body, html, from, files, pics, keep, isMail, loading, start, box])

  // Every change in the message box comes through here. The plain-text copy is made the same way the server makes it.
  const onEdit = useCallback((raw: string) => { const c = cleanRich(raw); setHtml(c.html); setBody(c.text); setInText(c.pictures) }, [])

  // The signature follows the From mailbox as long as nothing else has been typed.
  const pickFrom = (id: string) => {
    const old = boxes.find(b => b.id === from)?.signature ?? ''
    if (!body.trim() || sameWords(body, old)) editor.current?.set(underGap(sigHtml(boxes.find(b => b.id === id))))
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

  // A picture for the text: made ready, uploaded to the same private waiting place as attachments, and handed back to the box.
  const addPicture = async (file: File): Promise<string | null> => {
    setErr('')
    setUploading(n => n + 1)
    try {
      const pic = await fitPicture(file)
      const used = files.reduce((n, f) => n + f.size, 0) + pics.filter(p => inText.includes(p.path)).reduce((n, p) => n + p.size, 0)
      if (used + pic.size > MAX) throw new Error(`${pic.name} would take the message over 20 MB, which is more than email can carry.`)
      const t = await api<{ path: string; token: string }>('attach_prepare', { name: pic.name, size: pic.size })
      const { error } = await createClient().storage.from(OUTBOX).uploadToSignedUrl(t.path, t.token, pic, { contentType: pic.type })
      if (error) throw new Error(`${pic.name} did not upload. Try again.`)
      setPics(p => [...p, { path: t.path, name: pic.name, size: pic.size }])
      return t.path
    } catch (e) { setErr((e as Error).message); return null } finally { setUploading(n => n - 1) }
  }

  const removeFile = (a: Att) => { setFiles(f => f.filter(x => x.path !== a.path)); void api('attach_remove', { path: a.path }).catch(() => null) }

  const discard = () => {
    for (const a of [...files, ...pics]) void api('attach_remove', { path: a.path }).catch(() => null)
    clearDraft(start); onClose()
  }

  const payload = (draft: boolean) => ({
    mailbox: start.mailbox, from, mode: start.mode === 'draft' ? 'new' : start.mode, id: 'id' in start ? start.id : undefined,
    ...(start.mode === 'draft' ? { draft_id: start.draft, keep: keep ?? [] } : {}), to, cc, subject, body, html, quote, draft, confirmed: !draft, files: files.map(f => f.path),
  })

  const go = async (draft: boolean) => {
    setErr('')
    if (uploading) { setErr('A file is still uploading. Give it a moment.'); return }
    if (start.mode === 'signature') {
      setBusy(true)
      try { await api('signature', { mailbox: start.mailbox, text: body, html }); onDone('Signature saved.') } catch (e) { setErr((e as Error).message) }
      setBusy(false); return
    }
    if (!draft) {
      // Written down right now (not a moment later), so Undo or a failed send can open it again exactly as it was.
      try { localStorage.setItem(draftKey(start), JSON.stringify({ to, cc, subject, body, html, from, files, pics, keep: keep ?? undefined, at: Date.now() } satisfies Saved)) } catch { /* storage is off */ }
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

  // Schedule: every check a send gets happens now; the message then waits in Drafts in the From mailbox until the time.
  const schedule = async (at: number) => {
    setErr('')
    if (uploading) { setErr('A file is still uploading. Give it a moment.'); return }
    setBusy(true)
    try {
      const r = await api<{ send_at: number; from: string }>('schedule', { ...payload(false), send_at: at })
      clearDraft(start)
      onDone(`Scheduled for ${whenText(r.send_at)} from ${r.from}. It waits in Drafts until then: open Scheduled in that mailbox to send it sooner or cancel it.`)
    } catch (e) { setErr((e as Error).message); setSched(null) }
    setBusy(false)
  }

  const insertTpl = (t: Tpl) => editor.current?.insert(t.html || textToHtml(t.body))
  const saveTpl = async () => {
    // A template keeps the wording and its formatting, without the signature that sits under it. Pictures are not kept.
    const tidy = (x: string) => x.replace(/[ \t]+\n/g, '\n').trim()
    const sig = tidy(box?.signature ?? ''), all = tidy(body)
    const text = sig && all.endsWith(sig) ? all.slice(0, -sig.length).trim() : all
    if (!text) { setErr('Type the wording first, then save it as a template.'); setTplName(null); return }
    const name = (tplName ?? '').trim()
    if (!name) { setErr('Give the template a name.'); return }
    try { await api('template_save', { name, body: text, html: withoutEnding(html, box?.signature ?? '') }); setTpls((await api<{ templates: Tpl[] }>('templates')).templates); setTplName(null); setErr('') } catch (e) { setErr((e as Error).message) }
  }
  const delTpl = async (t: Tpl) => {
    if (!await ask({ text: `Delete the template "${t.name}"?`, yes: 'Delete', danger: true })) return
    try { await api('template_delete', { id: t.id }); setTpls(l => (l ?? []).filter(x => x.id !== t.id)) } catch (e) { setErr((e as Error).message) }
  }

  const title = start.mode === 'signature' ? 'Signature for ' + (box?.name ?? '') : start.mode === 'new' ? 'New message' : start.mode === 'draft' ? (isReply ? 'Draft reply' : 'Draft') : start.mode === 'forward' ? 'Forward' : 'Reply'
  const shown = pics.filter(p => inText.includes(p.path))
  const fromDraft = draftFiles.filter(f => (keep ?? []).includes(f.i))
  const total = files.reduce((n, f) => n + f.size, 0) + shown.reduce((n, p) => n + p.size, 0) + fromDraft.reduce((n, f) => n + f.size, 0)
  const carrying = [files.length + fromDraft.length ? `${files.length + fromDraft.length} attached` : '', shown.length ? `${shown.length} picture${shown.length === 1 ? '' : 's'} in the text` : ''].filter(Boolean).join(', ')
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
      {asking}
      <div className={cn('rp-card w-full sm:max-w-2xl max-h-[94vh] overflow-y-auto', over && 'ring-2 ring-primary')}
        onDragOver={e => { if (isMail && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { if (!isMail) return; e.preventDefault(); setOver(false); void addFiles([...e.dataTransfer.files]) }}>
        <div className="rp-card-head"><h2 className="rp-card-title">{title}</h2><button onClick={onClose} aria-label="Close" title="Close (what you typed is kept)"><X className="size-5" /></button></div>
        <div className="p-4 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Getting the message ready...</p>}
          {scheduledAt && !loading && (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground"><Clock className="inline size-3.5" /> This draft is scheduled to go out {whenText(scheduledAt)}. Sending it, saving it or scheduling it again here replaces that.</p>
          )}
          {restored && !loading && (
            <p className="rounded-md border border-info/30 bg-info-soft px-3 py-2 text-xs text-foreground">Picked up where you left off. <button className="underline" onClick={() => { discard() }}>Throw it away</button> <button className="underline ml-2" onClick={() => setRestored(false)}>OK</button></p>
          )}
          {!loading && start.mode === 'signature' && (
            <div><label className={lab}>Added to the end of what you write from {box?.address}</label><RichEditor ref={editor} initial={html} onChange={onEdit} label="Signature" short autoFocus /></div>
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
            <AddrInput label="To" value={to} onChange={setTo} groups={groups} autoFocus={start.mode !== 'reply'} placeholder={groups.length ? 'Start typing a name, an address or a group' : 'Start typing a name or address'} />
            <AddrInput label="Cc" value={cc} onChange={setCc} groups={groups} />
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
                    ? <button className="underline" type="button" title="Keeps the wording and its formatting so you can drop it into any message. Pictures are not kept." onClick={() => setTplName('')}><FileText className="inline size-3" /> Save as template</button>
                    : <span className="inline-flex items-center gap-1.5">
                        <input className="rp-input !w-44 !py-1 text-xs" autoFocus placeholder="Name, e.g. Permit received" value={tplName} onChange={e => setTplName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveTpl() } else if (e.key === 'Escape') { e.stopPropagation(); setTplName(null) } }} />
                        <button className="underline" type="button" onClick={() => void saveTpl()}>Save</button>
                        <button className="underline" type="button" onClick={() => setTplName(null)}>Cancel</button>
                      </span>}
                </span>
              </div>
              <RichEditor ref={editor} initial={html} onChange={onEdit} onFiles={f => void addFiles(f)} onPicture={addPicture} autoFocus={start.mode === 'reply'} />
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
                <span className="text-xs text-muted-foreground">{uploading ? `Uploading ${uploading}...` : carrying ? `${carrying}, ${mb(total)} of 20 MB` : 'Or drag files onto this box. Paste a picture to put it in the text.'}</span>
              </div>
              {files.length > 0 && <div className="flex flex-wrap gap-1.5">{files.map(a => (
                <span key={a.path} className="rp-pill !py-1"><Paperclip className="size-3" />{a.name} <span className="text-muted-foreground">{mb(a.size)}</span>
                  <button onClick={() => removeFile(a)} aria-label={'Remove ' + a.name} title="Remove"><X className="size-3" /></button></span>
              ))}</div>}
              {fromDraft.length > 0 && <div className="flex flex-wrap gap-1.5">{fromDraft.map(a => (
                <span key={'d' + a.i} className="rp-pill !py-1" title="Already on the draft"><Paperclip className="size-3" />{a.name} <span className="text-muted-foreground">{mb(a.size)}</span>
                  <button onClick={() => setKeep(k => (k ?? []).filter(i => i !== a.i))} aria-label={'Take ' + a.name + ' off'} title="Take off"><X className="size-3" /></button></span>
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
          {!loading && isMail && sched && (sched.at === null ? (
            <div className="rounded-md border border-border bg-raised p-3 space-y-2.5">
              <p className="text-sm font-medium text-foreground">When should it go out?</p>
              <div className="flex flex-wrap gap-2">
                {laterChoices(new Date(sched.from)).map(c => <button key={c.label} className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => setSched({ ...sched, at: c.at })}>{c.label}<span className="text-muted-foreground">{whenText(c.at)}</span></button>)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                <label htmlFor="rp-when">Or pick a day and time</label>
                <input id="rp-when" type="datetime-local" className="rp-input !w-auto" min={localInput(sched.from + 120_000)} value={pick} onChange={e => setPick(e.target.value)} />
                <button className={buttonVariants({ variant: 'outline', size: 'sm' })} disabled={!pick} onClick={() => { const t = new Date(pick).getTime(); if (Number.isFinite(t)) setSched({ ...sched, at: t }) }}>Use this time</button>
              </div>
              <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} onClick={() => setSched(null)}>Back</button>
            </div>
          ) : (
            <div className="rounded-md border border-border bg-raised p-3 space-y-2">
              <p className="text-sm text-foreground">Send this to <b>{[to, cc].filter(Boolean).join(', ')}</b> from <b>{box?.address}</b>{carrying ? <> with <b>{carrying}</b></> : null} on <b>{whenText(sched.at)}</b>?</p>
              <p className="text-xs text-muted-foreground">It waits in Drafts and goes out within about a minute of that time, even with this page closed.{isProton(box?.address) ? ' For a Proton mailbox the Mac Studio has to be on then.' : ''} To send it sooner or stop it, open Scheduled in the mailbox.</p>
              <div className="flex flex-wrap items-center gap-2">
                <button className={buttonVariants({ variant: 'default' })} disabled={busy || uploading > 0} onClick={() => void schedule(sched.at!)}><Clock />Yes, schedule it</button>
                <button className={buttonVariants({ variant: 'outline' })} disabled={busy} onClick={() => setSched({ at: null, from: Date.now() })}>Change the time</button>
                <button className={buttonVariants({ variant: 'ghost' })} disabled={busy} onClick={() => setSched(null)}>Back</button>
              </div>
            </div>
          ))}
          {!loading && !sched && (confirm ? (
            <div className="rounded-md border border-border bg-raised p-3 space-y-2">
              <p className="text-sm text-foreground">Send this to <b>{[to, cc].filter(Boolean).join(', ')}</b> from <b>{box?.address}</b>{carrying ? <> with <b>{carrying}</b></> : null}?</p>
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
                    <button className={buttonVariants({ variant: 'outline' })} disabled={busy || !to.trim()} title="Pick a time for it to go out" onClick={() => { setErr(''); setPick(''); setSched({ at: null, from: Date.now() }) }}><Clock />Schedule</button>
                    <button className={buttonVariants({ variant: 'outline' })} disabled={busy || uploading > 0} onClick={() => void go(true)}>Save to Gmail Drafts</button>
                  </>}
              <button className={buttonVariants({ variant: 'ghost' })} disabled={busy} onClick={onClose}>{isMail ? 'Close (keeps it)' : 'Cancel'}</button>
              {isMail && <button className={cn(buttonVariants({ variant: 'ghost' }), 'text-danger')} disabled={busy} onClick={() => void ask(start.mode === 'draft' ? { text: 'Throw away the changes you made here? The draft in Gmail stays as it was last saved.', yes: 'Throw away changes', danger: true } : { text: 'Throw this message away? What you typed and attached is deleted.', yes: 'Throw it away', danger: true }).then(ok => { if (ok) discard() })}><Trash2 />Discard</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** An address line that offers people from your own mail as you type. Several addresses are separated by commas. */
function AddrInput({ label, value, onChange, autoFocus, placeholder, groups = [] }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string; groups?: { name: string; addrs: string[] }[] }) {
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
  // The person's own address groups come first: picking one puts everyone in it on the line.
  const groupHits = last.length >= 2 ? groups.filter(g => g.name.toLowerCase().includes(last.toLowerCase())).map(g => ({ name: `Group: ${g.name} (${g.addrs.length})`, addr: g.addrs.join(', ') })) : []
  const shown = open && last.length >= 2 ? [...groupHits, ...hits] : []
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
