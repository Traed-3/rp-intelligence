'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Mail, LayoutDashboard, PenSquare, RefreshCw, Paperclip, Check, Archive, Trash2, ShieldAlert, Reply, ReplyAll, Forward, Inbox,
  MailOpen, ListPlus, ArrowLeft, Search, ExternalLink, Signature, Unplug, Image as ImageIcon, Download, Star, Printer, Keyboard, MoreVertical, X, Bell, Tag, Tags, Ban, FileArchive, SlidersHorizontal, AlarmClock, BellRing, Wand2, Settings,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Item } from '@/lib/rpmail/mail-ops'
import type { BoxInfo } from '@/lib/rpmail/overview'
import type { Label } from '@/lib/rpmail/organize'
import type { Rule } from '@/lib/rpmail/arrival'
import { makeZip } from '@/lib/rpmail/zip'
import { PushToggle } from '@/app/(app)/settings/alerts/push-toggle'
import { Compose, clearDraft, type ComposeStart, type Outgoing } from './compose'

// The built-in RPMail page: Dashboard (a tile per mailbox, My Plate, Your jobs, Needs you, Daily summary) and one
// inbox per mailbox. Unread mail is bold everywhere. Opening a message never marks it read.

export type Notify = { on: boolean; what: 'needs' | 'people' | 'all'; quiet_from: string; quiet_to: string; off: string[] }
export type Group = { name: string; addrs: string[] }
export type Prefs = { hidden: string[]; order: string[]; undo_secs?: number; notify?: Notify; sender_name?: string; default_from?: string; start?: string; density?: 'comfortable' | 'compact'; tz?: string; groups?: Group[] }
/** Lists drawn tighter (one line less per message) when the person chose Compact in Settings. */
const Compact = createContext(false)
export type State = { prefs?: Prefs; enabled: boolean; name: string; role: string; googleReady: boolean; personalAddress: string | null; loginEmail: string; boxes: BoxInfo[]; note: string | null }
type PlateItem = { id: string; title: string; detail: string; kind: string; site_number: string | null; priority: number; due_date: string | null; status: string; waiting_on: string | null; mail: Item | null; mail_n: number }
type SumItem = { mailbox_id: string; id: string; date: number; from_name: string; subject: string; site: string | null; po: string | null; snippet: string; why?: string; unread?: boolean }
type Summary = { day: string; created: number; data: { since: number; boxes: { id: string; name: string; received: number; items: SumItem[]; more: number }[]; needs: SumItem[]; stale: SumItem[]; permits: SumItem[]; pos: SumItem[]; deadlines: SumItem[] } }
type Move = { id: number; mailbox_id: string; subject: string; from_place: string; to_place: string; undone: boolean; created_at: number }
type Overview = { prefs?: Prefs; boxes: BoxInfo[]; needs: Item[]; foryou: Item[]; plate: { items: PlateItem[]; error: string | null }; summary: Summary | null; moves: Move[]; now: number }
type Full = Item & { cc_addrs: string; to_full: string; cc_full: string; text: string; html: string | null; done: boolean; hidden: boolean
  attachments: { i: number; name: string; type: string; size: number; inline: boolean }[]
  thread: { id: string; date: number; from_name: string; snippet: string; unread: boolean; sent: boolean }[] }
type Toast = { text: string; undo?: () => void } | null
type Filter = { view: 'inbox' | 'needs' | 'sent' | 'filed' | 'all' | 'snoozed'; q: string; unread: boolean; att: boolean; starred?: boolean; label?: string; from?: string; after?: string; before?: string }
type LabelSet = { box: string; labels: Label[]; can_edit: boolean }
type BulkAction = 'Archive' | 'Trash' | 'read' | 'unread' | 'done' | 'label'
type View = { kind: 'dash' } | { kind: 'box'; id: string }
/** The time zones a person can pick in Settings (the same list the server accepts). */
export const ZONE_NAMES: Record<string, string> = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' }
/** Which list a set of rows belongs to, so a list for another mailbox or filter is never shown under the wrong heading. */
const keyOf = (v: View, f: Filter) => v.kind === 'box' ? [v.id, f.view, f.unread, f.att, !!f.starred, f.label ?? '', f.after ?? '', f.before ?? ''].join('|') : ''

export async function api<T>(op: string, body?: Record<string, unknown>, query?: Record<string, string>): Promise<T> {
  const url = '/api/rpmail/' + op + (query ? '?' + new URLSearchParams(query) : '')
  const res = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
  const data = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.')
  return data
}

const when = (ms: number | null | undefined) => {
  if (!ms) return ''
  const d = new Date(ms), n = new Date()
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (n.getTime() - ms < 6 * 86_400_000) return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: d.getFullYear() === n.getFullYear() ? undefined : '2-digit' })
}
const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const s = (Date.now() - Date.parse(iso)) / 1000
  return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86_400 ? Math.round(s / 3600) + ' hr ago' : Math.round(s / 86_400) + ' days ago'
}
const size = (n: number) => n > 1_048_576 ? (n / 1_048_576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'
const btn = (variant: 'default' | 'outline' | 'ghost' | 'destructive' = 'outline', sz: 'sm' | 'default' | 'xs' = 'sm') => buttonVariants({ variant, size: sz })

export function RpmailApp({ localUrl, connected, connectError }: { localUrl: string | null; connected?: string; connectError?: string }) {
  const [st, setSt] = useState<State | null>(null)
  const [ov, setOv] = useState<Overview | null>(null)
  const [view, setView] = useState<View>(connected ? { kind: 'box', id: connected } : { kind: 'dash' })
  const [filter, setFilter] = useState<Filter>({ view: 'inbox', q: '', unread: false, att: false })
  const [listState, setList] = useState<{ key: string; items: Item[] } | null>(null)
  const [sel, setSel] = useState<{ mailbox: string; id: string } | null>(null)
  const [msg, setMsg] = useState<Full | null>(null)
  const [msgErr, setMsgErr] = useState('')
  const [toast, setToast] = useState<Toast>(connected ? { text: 'Connected. Your mail is loading.' } : null)
  const [busy, setBusy] = useState(false)
  const [compose, setCompose] = useState<ComposeStart | null>(null)
  const [err, setErr] = useState(connectError ?? '')
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item } | null>(null)
  const [boxMenu, setBoxMenu] = useState<{ x: number; y: number; box: BoxInfo } | null>(null)
  const [help, setHelp] = useState(false)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [labelSet, setLabelSet] = useState<LabelSet | null>(null)
  const [organize, setOrganize] = useState<{ from?: string } | null>(null)
  const [pending, setPending] = useState<{ out: Outgoing; until: number } | null>(null)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewRef = useRef(view)
  const filterRef = useRef(filter)
  useEffect(() => { viewRef.current = view; filterRef.current = filter })
  const list = listState && listState.key === keyOf(view, filter) ? listState.items : null   // a list for another box or filter shows as loading

  const say = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), undo ? 9000 : 5000)
  }, [])

  const loadList = useCallback((): Promise<void> => {
    const v = viewRef.current, f = filterRef.current
    if (v.kind !== 'box') return Promise.resolve()
    return api<{ messages: Item[] }>('messages', undefined, { mailbox: v.id, view: f.view, q: f.q, unread: f.unread ? '1' : '', att: f.att ? '1' : '', starred: f.starred ? '1' : '',
      label: f.label ?? '', from: f.from ?? '', after: f.after ?? '', before: f.before ?? '' })
      .then(r => setList({ key: keyOf(v, f), items: r.messages }))
      .catch(e => setErr((e as Error).message))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const o = await api<Overview>('overview')
      setOv(o); setSt(s => s ? { ...s, boxes: o.boxes, prefs: o.prefs ?? s.prefs } : s); setErr('')
    } catch (e) { setErr((e as Error).message) }
    await loadList()
  }, [loadList])

  // Bring every connected mailbox up to date, then redraw. A first load comes in chunks, so keep asking until done.
  const syncing = useRef(false)
  const syncAll = useCallback(async (boxes: BoxInfo[]) => {
    if (syncing.current) return
    syncing.current = true; setBusy(true)
    try {
      for (const b of boxes.filter(b => b.connected)) {
        let misses = 0
        for (let i = 0; i < 200; i++) {
          let r: { done: boolean; busy?: boolean }
          // One failed check is not the end of it: wait and try again a few times before giving up on this mailbox.
          try { r = await api('sync', { mailbox: b.id }); misses = 0 } catch { if (++misses > 3) break; await new Promise(res => setTimeout(res, 5000 * misses)); continue }
          if (r.done) break
          await refresh()
          if (r.busy) await new Promise(res => setTimeout(res, 4000))
        }
      }
      await refresh()
    } finally { syncing.current = false; setBusy(false) }
  }, [refresh])

  const opened = useRef(!!connected)   // the start page is applied once, and never over a mailbox the person was sent to
  const boot = useCallback((): Promise<void> => api<State>('state')
    .then(async s => {
      setSt(s)
      const start = s.prefs?.start
      if (!opened.current && start && s.boxes.some(b => b.id === start)) setView({ kind: 'box', id: start })
      opened.current = true
      if (s.enabled) { await refresh(); void syncAll(s.boxes) }
    })
    .catch(e => setErr((e as Error).message)), [refresh, syncAll])

  useEffect(() => {
    void boot()
    if (connected || connectError) window.history.replaceState(null, '', '/rpmail')
    const t = setInterval(() => { if (document.visibilityState === 'visible') void api<State>('state').then(s => { if (s.enabled) void syncAll(s.boxes) }).catch(() => null) }, 90_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void loadList() }, [view, filter.view, filter.unread, filter.att, filter.starred, filter.label, filter.after, filter.before, loadList])   // typing in the search box waits for Enter

  // The labels of the mailbox on screen (Gmail's own labels, read fresh each time the mailbox is opened).
  const loadLabels = useCallback((box: string): Promise<Label[]> => api<{ labels: Label[]; can_edit: boolean }>('labels', undefined, { mailbox: box })
    .then(r => { setLabelSet({ box, labels: r.labels, can_edit: r.can_edit }); return r.labels })
    .catch(() => [] as Label[]), [])
  const boxOnScreen = view.kind === 'box' ? view.id : ''
  const boxReady = !!st?.boxes.find(b => b.id === boxOnScreen)?.connected
  useEffect(() => { if (boxOnScreen && boxReady) void loadLabels(boxOnScreen) }, [boxOnScreen, boxReady, loadLabels])

  const openMsg = useCallback(async (mailbox: string, id: string) => {
    setSel({ mailbox, id }); setMsg(null); setMsgErr('')
    try { setMsg(await api<Full>('message', undefined, { mailbox, id })) } catch (e) { setMsgErr((e as Error).message) }
  }, [])

  const act = useCallback(async (fn: () => Promise<void>) => { try { await fn() } catch (e) { say((e as Error).message) } }, [say])

  const markDone = useCallback((it: { mailbox_id: string; id: string }, on = true) => act(async () => {
    await api('done', { mailbox: it.mailbox_id, id: it.id, on })
    await refresh()
    if (sel?.id === it.id) setMsg(m => m ? { ...m, done: on } : m)
    if (on) say('Done. Off your lists.', () => void act(async () => { await api('done', { mailbox: it.mailbox_id, id: it.id, on: false }); await refresh(); say('Back on your lists.') }))
    else say('Back on your lists.')
  }), [act, refresh, say, sel])

  const fileTo = useCallback((it: { mailbox_id: string; id: string }, dest: 'Archive' | 'Inbox' | 'Spam' | 'Trash') => act(async () => {
    say('Moving...')
    const r = await api<{ move_id: number | null }>('file', { mailbox: it.mailbox_id, id: it.id, dest })
    if (sel?.id === it.id) { setSel(null); setMsg(null) }
    await refresh()
    const undo = r.move_id ? () => void act(async () => { const u = await api<{ back_to: string }>('undo', { move: r.move_id }); await refresh(); say('Back in ' + u.back_to + '.') }) : undefined
    say(dest === 'Trash' ? 'Moved to Trash (Gmail keeps it 30 days).' : dest === 'Inbox' ? 'Moved to the inbox.' : 'Moved to ' + dest + '.', undo)
  }), [act, refresh, say, sel])

  const markRead = useCallback((it: { mailbox_id: string; id: string }, unread: boolean) => act(async () => {
    await api('mark', { mailbox: it.mailbox_id, id: it.id, unread })
    setMsg(m => m && m.id === it.id ? { ...m, unread } : m)
    await refresh()
  }), [act, refresh])

  const plateAdd = useCallback((it: { mailbox_id: string; id: string }) => act(async () => {
    const r = await api<{ added: boolean; title: string }>('plate_add', { mailbox: it.mailbox_id, id: it.id })
    await refresh()
    say(r.added ? 'Added to My Plate: ' + r.title : 'That email is already on My Plate.')
  }), [act, refresh, say])

  const plateDone = useCallback((t: PlateItem) => act(async () => {
    await api('plate_done', { id: t.id })
    await refresh()
    say('Done: ' + t.title, () => void act(async () => { await api('plate_done', { id: t.id, undo: true, prev: t.status }); await refresh(); say('Back on My Plate.') }))
  }), [act, refresh, say])

  const toggleStar = useCallback((it: { mailbox_id: string; id: string }, on: boolean) => act(async () => {
    await api('star', { mailbox: it.mailbox_id, id: it.id, on })
    setMsg(m => m && m.id === it.id ? { ...m, starred: on } : m)
    setList(l => l ? { ...l, items: l.items.map(x => x.id === it.id ? { ...x, starred: on } : x) } : l)
    if (filterRef.current.starred) await loadList()
  }), [act, loadList])

  const undoMoveNow = useCallback((move: number) => void act(async () => { const u = await api<{ back_to: string }>('undo', { move }); await refresh(); say('Back in ' + u.back_to + '.') }), [act, refresh, say])

  // Put a label on a conversation or take it off. With `move` it also leaves the inbox.
  const applyLabel = useCallback((it: { mailbox_id: string; id: string }, label: string, on: boolean, move = false) => act(async () => {
    const r = await api<{ move_id: number | null; name: string }>('label_apply', { mailbox: it.mailbox_id, id: it.id, label, on, move })
    if (move && sel?.id === it.id) { setSel(null); setMsg(null) }
    else setMsg(m => m && m.id === it.id ? { ...m, labels: on ? [...new Set([...m.labels, label])] : m.labels.filter(l => l !== label) } : m)
    await refresh()
    const back = move && r.move_id ? () => undoMoveNow(r.move_id as number)
      : on ? () => void act(async () => { await api('label_apply', { mailbox: it.mailbox_id, id: it.id, label, on: false }); setMsg(m => m && m.id === it.id ? { ...m, labels: m.labels.filter(l => l !== label) } : m); await refresh(); say('Label taken off.') }) : undefined
    say(move ? `Moved to ${r.name || 'the label'}.` : on ? `Labelled ${r.name || ''}.` : 'Label taken off.', back)
  }), [act, refresh, say, sel, undoMoveNow])

  // Snooze (off my lists until a time) or remind me (tell me at a time if nobody has replied). `until: null` cancels.
  const snooze = useCallback((it: { mailbox_id: string; id: string }, until: number | null, kind: 'snooze' | 'remind' = 'snooze') => act(async () => {
    const cancel = async () => { await api('snooze', { mailbox: it.mailbox_id, id: it.id, on: false }); setMsg(m => m && m.id === it.id ? { ...m, snooze: undefined } : m); await refresh() }
    if (until === null) { await cancel(); say(kind === 'remind' ? 'Reminder cancelled.' : 'Back on your lists.'); return }
    await api('snooze', { mailbox: it.mailbox_id, id: it.id, until, kind })
    if (kind === 'snooze' && sel?.id === it.id) { setSel(null); setMsg(null) }
    else setMsg(m => m && m.id === it.id ? { ...m, snooze: { kind, until, woke: false } } : m)
    await refresh()
    const at = new Date(until).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    say(kind === 'remind' ? `You will be reminded ${at} if nobody has replied.` : `Snoozed until ${at}. It is off your lists until then.`, () => void act(async () => { await cancel(); say('Cancelled.') }))
  }), [act, refresh, say, sel])

  const makeLabel = useCallback(async (mailbox: string, name: string): Promise<Label | null> => {
    try {
      const r = await api<{ label: Label }>('label_save', { mailbox, name })
      await loadLabels(mailbox)
      return r.label
    } catch (e) { say((e as Error).message); return null }
  }, [loadLabels, say])

  // Block the sender of a message: that conversation goes to Trash, and so does anything new from them.
  const blockFrom = useCallback((it: { mailbox_id: string; id: string }) => act(async () => {
    const r = await api<{ addr: string; move_id: number | null }>('block', { mailbox: it.mailbox_id, id: it.id })
    if (sel?.id === it.id) { setSel(null); setMsg(null) }
    await refresh()
    say(`Blocked ${r.addr}. New mail from them goes straight to Trash.`, () => void act(async () => {
      await api('block', { mailbox: it.mailbox_id, addr: r.addr, on: false })
      if (r.move_id) await api('undo', { move: r.move_id })
      await refresh(); say('Unblocked, and the conversation is back.')
    }))
  }), [act, refresh, say, sel])

  const bulk = useCallback((mailbox: string, ids: string[], action: BulkAction, extra?: { label: string; move: boolean }) => act(async () => {
    say(`Working on ${ids.length}...`)
    const r = await api<{ n: number; failed: number; moves: number[] }>('bulk', { mailbox, ids, action, ...(extra ?? {}) })
    if (sel && ids.includes(sel.id) && (action === 'Archive' || action === 'Trash' || (action === 'label' && extra?.move))) { setSel(null); setMsg(null) }
    await refresh()
    const what = action === 'Archive' ? 'archived' : action === 'Trash' ? 'moved to Trash' : action === 'done' ? 'marked Done' : action === 'label' ? (extra?.move ? 'moved to the label' : 'labelled') : 'marked ' + action
    const undo = r.moves.length ? () => void act(async () => { say('Putting them back...'); for (const m of r.moves) await api('undo', { move: m }); await refresh(); say(`${r.moves.length} put back.`) }) : undefined
    say(`${r.n} ${what}.` + (r.failed ? ` ${r.failed} could not be changed.` : ''), undo)
  }), [act, refresh, say, sel])

  // Send, after the person pressed Send and confirmed. It waits a few seconds first so it can be undone.
  const doSend = useCallback(async (out: Outgoing) => {
    setPending(null)
    setToast({ text: `Sending to ${out.to}...` })   // stays up until the answer comes back
    if (toastTimer.current) clearTimeout(toastTimer.current)
    try {
      const r = await api<{ to: string; from: string }>('send', out.payload)
      clearDraft(out.start)
      say(`Sent to ${r.to} from ${r.from}.`)
      void refresh()
    } catch (e) {
      setToast(null)
      setErr('Not sent: ' + (e as Error).message + ' Your message is open again so you can fix it.')
      setCompose(out.start)
    }
  }, [refresh, say])
  const queueSend = useCallback((out: Outgoing, secs: number) => {
    setCompose(null); setErr('')
    if (!secs) { say('Sending...'); void doSend(out); return }
    setPending({ out, until: Date.now() + secs * 1000 })
    pendingTimer.current = setTimeout(() => void doSend(out), secs * 1000)
  }, [doSend, say])
  const undoSend = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    setPending(p => { if (p) setCompose(p.out.start); return null })
    say('Not sent. Your message is open again.')
  }, [say])
  const sendNow = useCallback(() => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    if (pending) void doSend(pending.out)
  }, [doSend, pending])
  // Closing the tab in those few seconds would lose the send: the browser asks first.
  useEffect(() => {
    if (!pending) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])

  const savePrefs = useCallback((next: Partial<Prefs>) => act(async () => {
    setSt(s => s ? { ...s, prefs: { ...s.prefs, hidden: s.prefs?.hidden ?? [], order: s.prefs?.order ?? [], ...next } } : s)
    await api('prefs', next)
  }), [act])

  // Mailboxes in the order this person chose (ones they have not placed keep their usual spot at the end).
  const boxes = useMemo(() => {
    const order = st?.prefs?.order ?? [], all = st?.boxes ?? []
    const at = (id: string) => { const i = order.indexOf(id); return i < 0 ? 999 : i }
    return all.map((b, i) => ({ b, i })).sort((x, y) => at(x.b.id) - at(y.b.id) || x.i - y.i).map(x => x.b)
  }, [st])
  const hidden = useMemo(() => new Set(st?.prefs?.hidden ?? []), [st])
  const moveBox = (id: string, by: number) => {
    const order = boxes.map(b => b.id), i = order.indexOf(id), j = i + by
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    void savePrefs({ order })
  }
  const setHidden = (id: string, on: boolean) => {
    const next = new Set(hidden); if (on) next.add(id); else next.delete(id)
    void savePrefs({ hidden: [...next] })
    say(on ? 'Closed. It is still in the list on the left; put it back from the bottom of the dashboard.' : 'Back on the dashboard.')
  }

  // Keyboard shortcuts (press ? for the list). Off while typing in a box or writing a message.
  const keyState = useRef({ list: null as Item[] | null, sel, msg, compose: false, view, boxes, def: '' })
  useEffect(() => { keyState.current = { list, sel, msg, compose: !!compose, view, boxes, def: st?.prefs?.default_from ?? '' } })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') { setMenu(null); setBoxMenu(null); setHelp(false); setNotifyOpen(false); setOrganize(null); return }
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return
      const k = keyState.current
      if (k.compose) return
      const first = k.view.kind === 'box' ? k.boxes.find(b => b.id === (k.view as { id: string }).id && b.connected) : k.boxes.find(b => b.connected)
      const cur = k.msg ? { mailbox_id: k.msg.mailbox_id, id: k.msg.id } : null
      const step = (by: number) => {
        if (!k.list?.length || k.view.kind !== 'box') return
        const i = k.sel ? k.list.findIndex(x => x.id === k.sel!.id) : -1
        const n = k.list[Math.max(0, Math.min(k.list.length - 1, i + by))]
        if (n) void openMsg(n.mailbox_id, n.id)
      }
      const done = () => e.preventDefault()
      switch (e.key) {
        case '?': setHelp(h => !h); return done()
        case 'c': { const from = k.view.kind === 'box' && first?.can_send ? first : k.boxes.find(b => b.id === k.def && b.connected && b.can_send) ?? k.boxes.find(b => b.connected && b.can_send); if (from) setCompose({ mode: 'new', mailbox: from.id }); return done() }
        case '/': document.getElementById('rp-search')?.focus(); return done()
        case 'j': step(1); return done()
        case 'k': step(-1); return done()
        case 'u': setSel(null); setMsg(null); return done()
      }
      if (!cur || !k.msg) return
      switch (e.key) {
        case 'e': void fileTo(cur, k.msg.in_inbox ? 'Archive' : 'Inbox'); return done()
        case '#': void fileTo(cur, 'Trash'); return done()
        case 'r': setCompose({ mode: 'reply', mailbox: cur.mailbox_id, id: cur.id }); return done()
        case 'a': setCompose({ mode: 'reply', mailbox: cur.mailbox_id, id: cur.id, all: true }); return done()
        case 'f': setCompose({ mode: 'forward', mailbox: cur.mailbox_id, id: cur.id }); return done()
        case 's': void toggleStar(cur, !k.msg.starred); return done()
        case 'd': void markDone(cur, !k.msg.done); return done()
        case 'm': void markRead(cur, !k.msg.unread); return done()
        case 'p': printMessage(k.msg); return done()
        case 'z': void snooze(cur, k.msg.snooze && !k.msg.snooze.woke ? null : atMorning(1), k.msg.snooze?.kind ?? 'snooze'); return done()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fileTo, markDone, markRead, openMsg, toggleStar, snooze])
  const boxName = useCallback((id: string) => boxes.find(b => b.id === id)?.name ?? '', [boxes])
  const cur = view.kind === 'box' ? boxes.find(b => b.id === view.id) ?? null : null

  if (!st) return <div className="p-6 text-sm text-muted-foreground">{err || 'Loading RPMail...'}</div>
  if (!st.enabled) return <Setup st={st} localUrl={localUrl} onOn={boot} />

  const onBoxMenu = (e: React.MouseEvent, b: BoxInfo) => { e.preventDefault(); e.stopPropagation(); setMenu(null); setBoxMenu({ x: e.clientX, y: e.clientY, box: b }) }
  const goBox = (id: string) => { setFilter({ view: 'inbox', q: '', unread: false, att: false }); setView({ kind: 'box', id }); setSel(null); setMsg(null) }
  const signOut = (b: BoxInfo) => { if (window.confirm(`Sign ${b.address} out of RPMail? Nothing in Gmail is touched. ${b.kind === 'shared' ? 'Everyone who has this shared mailbox loses it here until someone signs it in again.' : 'You can sign in again any time.'}`)) void act(async () => { await api('disconnect', { mailbox: b.id }); await boot(); say('Signed out.') }) }
  const canSignOut = (b: BoxInfo) => b.connected && (b.kind === 'personal' || st.role === 'owner')
  const rowProps = { onStar: (it: Item) => void toggleStar(it, !it.starred), onOpen: (it: Item) => { if (view.kind !== 'box' || view.id !== it.mailbox_id) { setFilter({ view: 'all', q: '', unread: false, att: false }); setView({ kind: 'box', id: it.mailbox_id }) } void openMsg(it.mailbox_id, it.id) },
    onMenu: (e: React.MouseEvent, it: Item) => { e.preventDefault(); setBoxMenu(null); setMenu({ x: e.clientX, y: e.clientY, item: it }) } }

  return (
    <Compact.Provider value={st.prefs?.density === 'compact'}>
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto" onClick={() => { if (menu) setMenu(null); if (boxMenu) setBoxMenu(null) }}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="rp-title">RPMail</h1>
          <p className="rp-subtitle">Your mail, what needs a reply and your jobs, in one place.{localUrl && <> <a className="underline" href={localUrl} target="_blank" rel="noopener noreferrer">Open your own RPMail</a></>}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={btn('ghost')} onClick={() => setNotifyOpen(true)} title="New-mail notifications"><Bell /><span className="hidden sm:inline">Notifications{st.prefs?.notify?.on ? ' on' : ''}</span></button>
          <Link className={btn('ghost')} href="/rpmail/settings" title="Your name on mail, signatures, defaults, time zone and more"><Settings /><span className="hidden sm:inline">Settings</span></Link>
          <button className={cn(btn('ghost'), 'hidden sm:inline-flex')} onClick={() => setHelp(true)} title="Keyboard shortcuts (press ?)"><Keyboard />Shortcuts</button>
          <button className={btn('ghost')} onClick={() => void syncAll(boxes)} disabled={busy} title="Check for new mail"><RefreshCw className={cn(busy && 'animate-spin')} />{busy ? 'Checking' : 'Check mail'}</button>
          <button className={btn('default')} onClick={() => setCompose({ mode: 'new', mailbox: cur?.connected && cur.can_send ? cur.id : boxes.find(b => b.id === st.prefs?.default_from && b.connected && b.can_send)?.id ?? boxes.find(b => b.connected && b.can_send)?.id ?? '' })} disabled={!boxes.some(b => b.connected && b.can_send) || !!pending}
            title={boxes.some(b => b.connected) && !boxes.some(b => b.connected && b.can_send) ? 'You can read your mailboxes here but not send from them. An owner can change that.' : undefined}><PenSquare />New message</button>
        </div>
      </div>
      {err && <p className="mb-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {st.note && <p className="mb-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">{st.note}</p>}

      <div className="flex flex-col lg:flex-row gap-4">
        <nav className="lg:w-56 shrink-0 flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          <NavBtn on={view.kind === 'dash'} onClick={() => { setView({ kind: 'dash' }); setSel(null); setMsg(null) }} icon={<LayoutDashboard className="size-4" />} label="Dashboard" />
          {boxes.map(b => (
            <NavBtn key={b.id} on={view.kind === 'box' && view.id === b.id} icon={<Mail className="size-4" />} label={b.name} sub={b.connected ? b.address : 'Signed out'} count={b.unread}
              onClick={() => goBox(b.id)} onContextMenu={e => onBoxMenu(e, b)} />
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {view.kind === 'dash' && ov && <Dash ov={ov} boxes={boxes} hidden={hidden} onBoxMenu={onBoxMenu} putBack={id => setHidden(id, false)} boxName={boxName} rowProps={rowProps} goBox={goBox}
            markDone={markDone} plateDone={plateDone} undo={id => void act(async () => { const u = await api<{ back_to: string }>('undo', { move: id }); await refresh(); say('Back in ' + u.back_to + '.') })} />}
          {view.kind === 'dash' && !ov && <p className="text-sm text-muted-foreground">Loading...</p>}
          {view.kind === 'dash' && (
            <p className="mt-6 text-xs text-muted-foreground">RPMail is on for your login.{' '}
              <button className="underline" onClick={() => { if (window.confirm('Turn RPMail off? Your own mailbox is disconnected from RP Intelligence. Your mail in Gmail is not touched, and you can turn it back on any time.')) void act(async () => { await api('enable', { on: false }); await boot() }) }}>Turn it off</button>
            </p>
          )}
          {view.kind === 'box' && cur && !cur.connected && <Connect box={cur} st={st} />}
          {view.kind === 'box' && cur && cur.connected && (
            <BoxView box={cur} filter={filter} setFilter={setFilter} list={list} sel={sel} msg={msg} msgErr={msgErr} rowProps={rowProps} reload={loadList} bulk={(ids, action, extra) => void bulk(cur.id, ids, action, extra)}
              labels={labelSet?.box === cur.id ? labelSet.labels : []} canEdit={labelSet?.box === cur.id && labelSet.can_edit} openOrganize={from => setOrganize({ from })} makeLabel={name => makeLabel(cur.id, name)} canSend={boxes.some(b => b.connected && b.can_send)}
              close={() => { setSel(null); setMsg(null) }} openOther={id => void openMsg(cur.id, id)}
              search={() => void act(async () => { say('Searching all of Gmail...'); const r = await api<{ messages: Item[] }>('search', { mailbox: cur.id, q: filter.q }); setList({ key: keyOf(view, filter), items: r.messages }); say(r.messages.length ? `${r.messages.length} found in Gmail.` : 'Nothing found in Gmail.') })}
              actions={{ fileTo, markRead, markDone, plateAdd, star: toggleStar, label: applyLabel, block: blockFrom, snooze, reply: (m, all, fwd) => setCompose({ mode: fwd ? 'forward' : 'reply', mailbox: m.mailbox_id, id: m.id, all }) }}
              editSig={() => setCompose({ mode: 'signature', mailbox: cur.id })}
              disconnect={canSignOut(cur) ? () => signOut(cur) : undefined} />
          )}
        </div>
      </div>

      {menu && (
        <div className="fixed z-50 rp-card py-1 text-sm shadow-lg" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 400) }}>
          <MenuBtn onClick={() => rowProps.onOpen(menu.item)}>Open</MenuBtn>
          <MenuBtn onClick={() => setCompose({ mode: 'reply', mailbox: menu.item.mailbox_id, id: menu.item.id })}>Reply</MenuBtn>
          <MenuBtn onClick={() => setCompose({ mode: 'forward', mailbox: menu.item.mailbox_id, id: menu.item.id })}>Forward</MenuBtn>
          <MenuBtn onClick={() => void markDone(menu.item)}>Done (off my lists)</MenuBtn>
          <MenuBtn onClick={() => void plateAdd(menu.item)}>Add to My Plate</MenuBtn>
          <MenuBtn onClick={() => void markRead(menu.item, !menu.item.unread)}>{menu.item.unread ? 'Mark read' : 'Mark unread'}</MenuBtn>
          <MenuBtn onClick={() => void toggleStar(menu.item, !menu.item.starred)}>{menu.item.starred ? 'Remove star' : 'Star'}</MenuBtn>
          {menu.item.snooze && !menu.item.snooze.woke
            ? <MenuBtn onClick={() => void snooze(menu.item, null, menu.item.snooze!.kind)}>{menu.item.snooze.kind === 'remind' ? 'Cancel the reminder' : 'Stop snoozing'}</MenuBtn>
            : <MenuBtn onClick={() => void snooze(menu.item, atMorning(1))}>Snooze until tomorrow morning</MenuBtn>}
          {menu.item.in_inbox && <MenuBtn onClick={() => void fileTo(menu.item, 'Archive')}>Archive</MenuBtn>}
          {boxes.find(b => b.id === menu.item.mailbox_id)?.can_delete !== false && <>
            <MenuBtn onClick={() => void fileTo(menu.item, 'Spam')}>Spam</MenuBtn>
            <MenuBtn onClick={() => void fileTo(menu.item, 'Trash')}>Delete</MenuBtn>
          </>}
          {!menu.item.sent && labelSet?.box === menu.item.mailbox_id && labelSet.can_edit && <MenuBtn onClick={() => void blockFrom(menu.item)}>Block this sender</MenuBtn>}
        </div>
      )}
      {boxMenu && (() => { const b = boxMenu.box, i = boxes.findIndex(x => x.id === b.id); return (
        <div className="fixed z-50 rp-card py-1 text-sm shadow-lg" style={{ left: Math.min(boxMenu.x, window.innerWidth - 230), top: Math.min(boxMenu.y, window.innerHeight - 290) }}>
          <p className="px-4 py-1 text-xs text-muted-foreground truncate max-w-[220px]">{b.address}</p>
          <MenuBtn onClick={() => goBox(b.id)}>Open</MenuBtn>
          {b.connected && <MenuBtn onClick={() => void syncAll([b])}>Check for new mail</MenuBtn>}
          {!b.connected && st.googleReady && <a className="block w-full px-4 py-1.5 text-left !font-normal hover:bg-raised" href={`/api/rpmail/connect?mailbox=${b.id}`}>Sign in</a>}
          {b.connected && st.googleReady && <a className="block w-full px-4 py-1.5 text-left !font-normal hover:bg-raised" href={`/api/rpmail/connect?mailbox=${b.id}`}>Sign in again</a>}
          {canSignOut(b) && <MenuBtn onClick={() => signOut(b)}>Sign out</MenuBtn>}
          {i > 0 && <MenuBtn onClick={() => moveBox(b.id, -1)}>Move earlier</MenuBtn>}
          {i >= 0 && i < boxes.length - 1 && <MenuBtn onClick={() => moveBox(b.id, 1)}>Move later</MenuBtn>}
          <MenuBtn onClick={() => setHidden(b.id, !hidden.has(b.id))}>{hidden.has(b.id) ? 'Put back on the dashboard' : 'Hide from the dashboard'}</MenuBtn>
        </div>
      ) })()}
      {help && <HelpSheet close={() => setHelp(false)} />}
      {organize && cur && <OrganizeSheet box={cur} labels={labelSet?.box === cur.id ? labelSet.labels : []} canEdit={labelSet?.box === cur.id && labelSet.can_edit} ruleFrom={organize.from}
        reload={async () => { await loadLabels(cur.id); await refresh() }} close={() => setOrganize(null)} say={say} />}
      {notifyOpen && <NotifySheet start={st.prefs?.notify} boxes={boxes} zone={ZONE_NAMES[st.prefs?.tz ?? ''] ?? 'Eastern'} close={() => setNotifyOpen(false)} save={async n => { await savePrefs({ notify: n }); setNotifyOpen(false); say(n.on ? 'Notifications are on.' : 'Notifications are off.') }} />}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-foreground text-background px-4 py-2.5 text-sm shadow-lg max-w-[92vw]">
          <span>{toast.text}</span>
          {toast.undo && <button className="font-semibold underline" onClick={() => { const u = toast.undo!; setToast(null); u() }}>Undo</button>}
        </div>
      )}
      {pending && !compose && <PendingBar to={pending.out.to} from={pending.out.from} until={pending.until} undo={undoSend} now={sendNow} />}
      {compose && <Compose key={JSON.stringify(compose)} start={compose} boxes={boxes} groups={st.prefs?.groups ?? []} undoSecs={st.prefs?.undo_secs ?? 10} setUndoSecs={n => void savePrefs({ undo_secs: n })}
        onClose={() => setCompose(null)} onDone={text => { setCompose(null); say(text); void refresh() }} onSend={out => queueSend(out, st.prefs?.undo_secs ?? 10)} />}
    </div>
    </Compact.Provider>
  )
}

function NavBtn({ on, onClick, onContextMenu, icon, label, sub, count }: { on: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; icon: React.ReactNode; label: string; sub?: string; count?: number }) {
  return (
    <button onClick={onClick} onContextMenu={onContextMenu} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm whitespace-nowrap lg:whitespace-normal', on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-raised')}>
      {icon}
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate', count ? 'font-bold' : 'font-medium')}>{label}</span>
        {sub && <span className="hidden lg:block truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
      {!!count && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums">{count}</span>}
    </button>
  )
}
const MenuBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => <button className="block w-full px-4 py-1.5 text-left hover:bg-raised" onClick={onClick}>{children}</button>

function Setup({ st, localUrl, onOn }: { st: State; localUrl: string | null; onOn: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [e, setE] = useState('')
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="rp-title mb-4">RPMail</h1>
      <div className="rp-card p-6 space-y-3">
        <div className="flex items-center gap-3">
          <span className="rounded-lg p-2 bg-primary/10 text-primary"><Mail className="size-6" /></span>
          <h2 className="font-semibold text-foreground">Your email, inside RP Intelligence</h2>
        </div>
        <p className="text-sm text-muted-foreground">RPMail is optional. Turn it on if you want your work email here: a dashboard, what is waiting on a reply, a daily summary, and reply or file without leaving the page.</p>
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
          <li>You sign in with Google once to connect {st.personalAddress ? <b className="text-foreground">{st.personalAddress}</b> : 'your work Gmail'}.</li>
          <li>Only you can open your mailbox here. Nobody else on RP Intelligence can.</li>
          <li>Messages are read from Gmail when you open them. RP Intelligence keeps only a short list (who, subject, date, first line) so the dashboard is quick.</li>
          <li>Nothing is ever sent unless you press Send. You can turn RPMail off again at any time.</li>
        </ul>
        {e && <p className="text-sm text-danger">{e}</p>}
        <button className={btn('default', 'default')} disabled={busy} onClick={async () => { setBusy(true); setE(''); try { await api('enable', { on: true }); await onOn() } catch (x) { setE((x as Error).message) } setBusy(false) }}>Turn on RPMail</button>
        {localUrl && <p className="text-xs text-muted-foreground">You also have your own RPMail: <a className="underline" href={localUrl} target="_blank" rel="noopener noreferrer">open it</a>.</p>}
      </div>
    </div>
  )
}

function Connect({ box, st }: { box: BoxInfo; st: State }) {
  return (
    <div className="rp-card p-6 max-w-xl space-y-3">
      <h2 className="font-semibold text-foreground">Connect {box.address}</h2>
      <p className="text-sm text-muted-foreground">Sign in with Google as <b className="text-foreground">{box.address}</b>. Google asks you to allow RP Intelligence to read, file and send mail for that mailbox. It cannot permanently delete anything.</p>
      {box.kind === 'shared' && <p className="text-sm text-muted-foreground">This is a shared mailbox. It only needs signing in once, by anyone who has its Google sign-in.</p>}
      <p className="text-xs text-muted-foreground">Google will show a &ldquo;Google hasn&rsquo;t verified this app&rdquo; page the first time. Choose Advanced, then &ldquo;Go to RP Intelligence&rdquo;. That page appears because this is a private company tool.</p>
      {st.googleReady
        ? <a className={btn('default', 'default')} href={`/api/rpmail/connect?mailbox=${box.id}`}>Sign in with Google</a>
        : <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">Sign in with Google is not switched on yet. Trae has one Google setup step left; this button will work once that is done.</p>}
      {box.last_error && <p className="text-xs text-danger">{box.last_error}</p>}
    </div>
  )
}

type Snooze = NonNullable<Item['snooze']>
const snoozeText = (z: Snooze) => z.kind === 'remind' ? (z.woke ? 'No reply yet' : 'Reminder ' + when(z.until)) : (z.woke ? 'Back from snooze' : 'Snoozed until ' + when(z.until))
// Times for the Snooze and Remind me choices. Worked out when the button is pressed, in the person's own time zone.
const inHours = (h: number) => Date.now() + h * 3_600_000
const atMorning = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(8, 0, 0, 0); return d.getTime() }
const nextMonday = () => atMorning(((8 - new Date().getDay()) % 7) || 7)

/** What a dragged conversation carries, so a label can tell it is mail being dropped on it. */
const DRAG = 'text/x-rpmail-id'

type RowProps = { onOpen: (it: Item) => void; onMenu: (e: React.MouseEvent, it: Item) => void; onStar?: (it: Item) => void }

function Row({ m, selected, boxLabel, onDone, onOpen, onMenu, onStar, pick, labelNames, drag }: { m: Item; selected?: boolean; boxLabel?: string; onDone?: () => void; pick?: { on: boolean; toggle: () => void }; labelNames?: Map<string, string>; drag?: boolean } & RowProps) {
  const bold = m.unread || m.waiting
  const compact = useContext(Compact)
  return (
    <div onClick={() => onOpen(m)} onContextMenu={e => onMenu(e, m)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(m)}
      draggable={drag || undefined} onDragStart={drag ? e => { e.dataTransfer.setData(DRAG, m.id); e.dataTransfer.effectAllowed = 'move' } : undefined}
      className={cn('flex gap-2 px-3 border-b border-hairline cursor-pointer hover:bg-raised', compact ? 'py-1' : 'py-2', selected && 'bg-primary/10', bold ? 'text-foreground' : 'text-muted-foreground')}>
      {pick && <input type="checkbox" className="mt-1 size-4 shrink-0" aria-label="Select this conversation" checked={pick.on} onClick={e => e.stopPropagation()} onChange={pick.toggle} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm', bold ? 'font-bold' : 'font-medium')}>{m.sent ? 'To: ' + (m.to_addrs.split(',')[0] || '') : m.from_name || m.from_addr}{(m.count ?? 1) > 1 && <span className="font-normal text-muted-foreground"> ({m.count})</span>}</span>
          <span className={cn('ml-auto shrink-0 text-xs tabular-nums', bold && 'font-bold')}>{when(m.date)}</span>
        </div>
        <div className={cn('truncate text-sm', bold ? 'font-bold text-foreground' : '')}>{m.subject || '(no subject)'}</div>
        {!compact && <div className="truncate text-xs text-muted-foreground">{m.snippet}</div>}
        <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
          {m.waiting && <span className="rp-pill" data-tone="warning">Waiting on a reply</span>}
          {m.snooze && <span className="rp-pill" data-tone={m.snooze.woke ? (m.snooze.kind === 'remind' ? 'warning' : 'info') : undefined}>{snoozeText(m.snooze)}</span>}
          {m.why && <span className="rp-pill" data-tone="info">{m.why}</span>}
          {m.site && <span className="rp-site-tag">{m.site}</span>}
          {m.po && <span className="rp-pill">PO {m.po}</span>}
          {m.has_att && <span className="rp-pill"><Paperclip className="size-3" /></span>}
          {labelNames && (m.labels ?? []).map(l => labelNames.has(l) && <span key={l} className="rp-pill"><Tag className="size-3" />{labelNames.get(l)}</span>)}
          {boxLabel && <span className="rp-pill">{boxLabel}</span>}
        </div>
      </div>
      {onStar && <button title={m.starred ? 'Remove the star' : 'Star it'} aria-label={m.starred ? 'Remove the star' : 'Star it'} className="self-start mt-0.5 shrink-0 text-muted-foreground hover:text-foreground" onClick={e => { e.stopPropagation(); onStar(m) }}><Star className={cn('size-4', m.starred && 'fill-warning text-warning')} /></button>}
      {onDone && <button title="Done: take it off my lists" className={cn(btn('ghost', 'xs'), 'self-center')} onClick={e => { e.stopPropagation(); onDone() }}><Check />Done</button>}
    </div>
  )
}

function Section({ id, title, count, children, right }: { id?: string; title: string; count?: number; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={id} className="rp-card overflow-hidden scroll-mt-4">
      <div className="rp-card-head"><h2 className="rp-card-title">{title}{count !== undefined && <span className="ml-2 text-muted-foreground tabular-nums">{count}</span>}</h2>{right}</div>
      {children}
    </section>
  )
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-5 text-sm text-muted-foreground">{children}</p>

function Tile({ title, sub, nums, foot, bold, onClick, onMenu }: { title: string; sub: string; nums: [number | string, string][]; foot: string; bold?: boolean; onClick: () => void; onMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} onContextMenu={onMenu} className="rp-card rp-card-link p-4 text-left relative">
      {onMenu && <span role="button" tabIndex={0} aria-label={'Options for ' + title} title="Options (or right-click)" className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-raised hover:text-foreground" onClick={onMenu} onKeyDown={e => { if (e.key === 'Enter') onMenu(e as unknown as React.MouseEvent) }}><MoreVertical className="size-4" /></span>}
      <div className={cn('text-sm text-foreground truncate', onMenu && 'pr-6', bold ? 'font-bold' : 'font-semibold')}>{title}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
      <div className="mt-3 flex gap-5">
        {nums.map(([n, l]) => <div key={l}><div className="rp-stat-value text-2xl">{n}</div><div className="rp-stat-label">{l}</div></div>)}
      </div>
      <div className={cn('mt-3 text-xs truncate', bold ? 'font-bold text-foreground' : 'text-muted-foreground')}>{foot}</div>
    </button>
  )
}

function Dash({ ov, boxes, hidden, onBoxMenu, putBack, boxName, rowProps, goBox, markDone, plateDone, undo }: { ov: Overview; boxes: BoxInfo[]; hidden: Set<string>; onBoxMenu: (e: React.MouseEvent, b: BoxInfo) => void; putBack: (id: string) => void
  boxName: (id: string) => string; rowProps: RowProps; goBox: (id: string) => void
  markDone: (it: { mailbox_id: string; id: string }, on?: boolean) => void; plateDone: (t: PlateItem) => void; undo: (id: number) => void }) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  const P = ov.plate.items, open = P.filter(t => t.status === 'open')
  const waitingJobs = ov.foryou.filter(m => m.waiting).length
  const s = ov.summary?.data
  const many = ov.boxes.length > 1
  const closed = boxes.filter(b => hidden.has(b.id))
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        {boxes.filter(b => !hidden.has(b.id)).map(b => (
          <Tile key={b.id} title={b.name} sub={b.address} bold={b.unread > 0} onClick={() => goBox(b.id)} onMenu={e => onBoxMenu(e, b)}
            nums={b.connected ? [[b.inbox, 'in inbox'], [b.unread, 'unread'], [b.needs, 'need you']] : [['-', 'not connected']]}
            foot={!b.connected ? (b.last_error || 'Signed out. Open it to sign in with Google.') : b.loading ? `Loading mail: ${b.loading.total - b.loading.left} of ${b.loading.total}` : b.last_error ? b.last_error : 'Checked ' + ago(b.last_sync_at)} />
        ))}
        <Tile title="My Plate" sub="What is on you" onClick={() => go('rp-plate')} nums={[[open.length, 'to do'], [P.length - open.length, 'waiting'], [P.filter(t => t.priority === 1).length, 'hot']]} foot={open[0]?.title ?? P[0]?.title ?? 'Nothing on your plate.'} />
        <Tile title="Your jobs" sub="Mail tied to your work" bold={waitingJobs > 0} onClick={() => go('rp-jobs')} nums={[[waitingJobs, 'waiting on a reply'], [ov.foryou.length, 'last 14 days']]}
          foot={ov.foryou[0] ? 'Newest: ' + (ov.foryou[0].from_name || ov.foryou[0].from_addr) + ' · ' + when(ov.foryou[0].date) : 'Nothing right now.'} />
        <Tile title="Needs you" sub="Mail waiting on a reply" bold={ov.needs.some(m => m.unread)} onClick={() => go('rp-needs')} nums={[[ov.needs.length, 'waiting'], [ov.needs.filter(m => m.unread).length, 'unread']]}
          foot={ov.needs[0] ? 'Newest: ' + (ov.needs[0].from_name || ov.needs[0].from_addr) + ' · ' + when(ov.needs[0].date) : 'Nothing waiting on you.'} />
        <Tile title="Daily summary" sub={ov.summary ? 'Made ' + when(ov.summary.created) : 'Made each morning after 6'} onClick={() => go('rp-sum')}
          nums={[[s ? s.boxes.reduce((n, b) => n + b.received, 0) : 0, 'received'], [s ? s.deadlines.length : 0, 'deadlines']]} foot={s ? `${s.needs.length} new need a reply, ${s.stale.length} older` : 'Not made yet.'} />
      </div>

      <Section id="rp-plate" title="My Plate" count={P.length} right={<Link href="/my" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">Open My Plate <ExternalLink className="size-3" /></Link>}>
        {ov.plate.error && <Empty>{ov.plate.error}</Empty>}
        {!ov.plate.error && !P.length && <Empty>Nothing on your plate right now.</Empty>}
        {P.map(t => (
          <div key={t.id} className="flex gap-3 px-4 py-2.5 border-b border-hairline">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-sm text-foreground">{t.title}</span>
                {t.site_number && <span className="rp-site-tag">{t.site_number}</span>}
                <span className="rp-pill" data-tone={t.status === 'waiting' ? 'info' : t.priority === 1 ? 'danger' : undefined}>{t.status === 'waiting' ? 'Waiting' + (t.waiting_on ? ' on ' + t.waiting_on : '') : t.priority === 1 ? 'Hot' : 'To do'}</span>
                {t.due_date && <span className="text-xs text-muted-foreground">due {new Date(t.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span>}
              </div>
              {t.detail && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.detail}</p>}
              {t.mail && <button className={cn('mt-1 text-xs underline text-left', t.mail.unread ? 'font-bold text-foreground' : 'text-muted-foreground')} onClick={() => rowProps.onOpen(t.mail!)}>
                Latest mail: {t.mail.from_name}, {when(t.mail.date)}: {t.mail.subject}{t.mail_n > 1 ? ` (${t.mail_n} in 2 weeks)` : ''}</button>}
            </div>
            <button className={cn(btn('outline', 'xs'), 'self-center')} onClick={() => plateDone(t)}><Check />Done</button>
          </div>
        ))}
      </Section>

      <Section id="rp-jobs" title="Your jobs" count={ov.foryou.length}>
        {!ov.foryou.length && <Empty>No mail about your jobs in the last 14 days.</Empty>}
        {ov.foryou.map(m => <Row key={m.mailbox_id + m.id} m={m} boxLabel={many ? boxName(m.mailbox_id) : undefined} onDone={() => markDone(m)} {...rowProps} />)}
      </Section>

      <Section id="rp-needs" title="Needs you" count={ov.needs.length}>
        {!ov.needs.length && <Empty>Nothing is waiting on you.</Empty>}
        {ov.needs.map(m => <Row key={m.mailbox_id + m.id} m={m} boxLabel={many ? boxName(m.mailbox_id) : undefined} onDone={() => markDone(m)} {...rowProps} />)}
      </Section>

      <Section id="rp-sum" title="Daily summary" right={ov.summary && <span className="text-xs text-muted-foreground">Since {new Date(ov.summary.data.since).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })}</span>}>
        {!s && <Empty>Your first summary is made the first time you open RPMail after 6 in the morning, once your mail has loaded.</Empty>}
        {s && (
          <div className="p-4 grid gap-4 md:grid-cols-2">
            <SumList title="New and needs a reply" items={s.needs} empty="Nothing new is waiting on you." rowProps={rowProps} markDone={markDone} />
            <SumList title="Still waiting (older than 2 days)" items={s.stale} empty="Nothing older is waiting." rowProps={rowProps} markDone={markDone} />
            <SumList title="Deadlines mentioned" items={s.deadlines} empty="No deadlines mentioned." rowProps={rowProps} markDone={markDone} />
            <SumList title="Permits" items={s.permits} empty="No permit mail." rowProps={rowProps} markDone={markDone} />
            <SumList title="PO numbers" items={s.pos} empty="No PO numbers." rowProps={rowProps} markDone={markDone} />
            {s.boxes.map(b => <SumList key={b.id} title={`${b.name}: ${b.received} received`} items={b.items} more={b.more} empty="Nothing from people." rowProps={rowProps} markDone={markDone} />)}
          </div>
        )}
      </Section>

      <DoneSection boxName={many ? boxName : undefined} rowProps={rowProps} putBack={m => markDone(m, false)} stamp={ov.now} />

      {closed.length > 0 && (
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">Closed boxes:
          {closed.map(b => <button key={b.id} className="rp-chip" onClick={() => putBack(b.id)} title="Put it back on the dashboard">{b.name} · put back</button>)}
        </p>
      )}

      {ov.moves.length > 0 && (
        <Section title="Recently filed">
          {ov.moves.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-2 border-b border-hairline text-sm">
              <span className="min-w-0 flex-1 truncate text-muted-foreground"><span className="text-foreground">{m.subject || '(no subject)'}</span> · to {m.to_place}{many ? ' · ' + boxName(m.mailbox_id) : ''} · {when(m.created_at)}</span>
              {m.undone ? <span className="text-xs text-muted-foreground">put back</span> : <button className={btn('ghost', 'xs')} onClick={() => undo(m.id)}>Undo</button>}
            </div>
          ))}
        </Section>
      )}
    </div>
  )
}

function SumList({ title, items, empty, more, rowProps, markDone }: { title: string; items: SumItem[]; empty: string; more?: number; rowProps: RowProps; markDone: (it: { mailbox_id: string; id: string }) => void }) {
  return (
    <div>
      <h3 className="rp-label mb-1.5">{title}</h3>
      {!items.length && <p className="text-xs text-muted-foreground">{empty}</p>}
      <ul className="space-y-1">
        {items.map(i => (
          <li key={i.mailbox_id + i.id} className="flex items-start gap-2 text-sm">
            <button className={cn('min-w-0 flex-1 text-left hover:underline', i.unread ? 'font-bold text-foreground' : 'text-muted-foreground')}
              onClick={() => rowProps.onOpen({ ...i, thread_id: '', from_addr: '', to_addrs: '', unread: !!i.unread, starred: false, has_att: false, in_inbox: true, sent: false, labels: [] })}>
              <span className="text-foreground">{i.from_name}</span>: {i.subject || '(no subject)'}{i.why && <span className="block text-xs font-normal text-muted-foreground">{i.why}</span>}
            </button>
            <button className="shrink-0 text-xs text-muted-foreground hover:text-foreground" title="Done: take it off my lists" onClick={() => markDone(i)}><Check className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      {!!more && <p className="mt-1 text-xs text-muted-foreground">and {more} more</p>}
    </div>
  )
}

type Actions = {
  fileTo: (it: { mailbox_id: string; id: string }, dest: 'Archive' | 'Inbox' | 'Spam' | 'Trash') => void
  markRead: (it: { mailbox_id: string; id: string }, unread: boolean) => void
  markDone: (it: { mailbox_id: string; id: string }, on?: boolean) => void
  plateAdd: (it: { mailbox_id: string; id: string }) => void
  star: (it: { mailbox_id: string; id: string }, on: boolean) => void
  label: (it: { mailbox_id: string; id: string }, label: string, on: boolean, move?: boolean) => void
  block: (it: { mailbox_id: string; id: string }) => void
  snooze: (it: { mailbox_id: string; id: string }, until: number | null, kind?: 'snooze' | 'remind') => void
  reply: (m: Full, all: boolean, fwd: boolean) => void
}

function BoxView({ box, filter, setFilter, list, sel, msg, msgErr, rowProps, reload, bulk, close, openOther, search, actions, editSig, disconnect, labels, canEdit, openOrganize, makeLabel, canSend }: {
  box: BoxInfo; filter: Filter; setFilter: (f: Filter) => void; list: Item[] | null; sel: { mailbox: string; id: string } | null; msg: Full | null; msgErr: string
  rowProps: RowProps; reload: () => void; bulk: (ids: string[], action: BulkAction, extra?: { label: string; move: boolean }) => void; close: () => void; openOther: (id: string) => void; search: () => void; actions: Actions; editSig: () => void; disconnect?: () => void
  labels: Label[]; canEdit: boolean; openOrganize: (ruleFrom?: string) => void; makeLabel: (name: string) => Promise<Label | null>; canSend: boolean }) {
  const views: [Filter['view'], string][] = [['inbox', 'Inbox'], ['needs', 'Needs you'], ['sent', 'Sent'], ['filed', 'Filed'], ['snoozed', 'Snoozed'], ['all', 'All']]
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const chosen = (list ?? []).filter(m => picked.has(m.id)).map(m => m.id)   // only what is on screen right now
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const run = (a: BulkAction, extra?: { label: string; move: boolean }) => { bulk(chosen, a, extra); setPicked(new Set()) }
  const [more, setMore] = useState(false)
  const [over, setOver] = useState('')   // the label a dragged conversation is hovering on
  const labelNames = useMemo(() => new Map(labels.map(l => [l.id, l.name])), [labels])
  const narrowed = !!(filter.from || filter.after || filter.before)
  return (
    <div className="rp-card overflow-hidden">
      <div className="rp-card-head">
        <div className="min-w-0">
          <h2 className="rp-card-title truncate">{box.name}</h2>
          <p className="text-xs text-muted-foreground truncate">{box.address} · {box.loading ? `loading mail: ${box.loading.total - box.loading.left} of ${box.loading.total}` : 'checked ' + ago(box.last_sync_at)}{box.crew_reads ? ' · the crew reads this mailbox: no pricing' : ''}{!box.can_send ? ' · you can read here, not send or delete' : !box.can_delete ? ' · you can read and send here, not delete' : ''}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className={btn('ghost', 'xs')} onClick={() => openOrganize()} title="Labels, rules for new mail, and blocked senders"><Tags />Labels and rules</button>
          <button className={btn('ghost', 'xs')} onClick={editSig}><Signature />Signature</button>
          <a className={cn(btn('ghost', 'xs'), '!text-xs !font-medium')} href={`/api/rpmail/connect?mailbox=${box.id}`} title="Use this if mail has stopped arriving or Google asks for permission again">Sign in again</a>
          {disconnect && <button className={btn('ghost', 'xs')} onClick={disconnect}><Unplug />Sign out</button>}
        </div>
      </div>
      {box.last_error && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-hairline bg-warning-soft text-sm text-warning">
          <span className="min-w-0 flex-1">Mail is not arriving for this mailbox: {box.last_error}</span>
          <a className={btn('default', 'xs')} href={`/api/rpmail/connect?mailbox=${box.id}`}>Sign in again</a>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-hairline">
        {views.map(([v, l]) => <button key={v} className="rp-chip" data-on={filter.view === v} onClick={() => setFilter({ ...filter, view: v })}>{l}{v === 'inbox' && box.unread ? ` (${box.unread})` : v === 'needs' && box.needs ? ` (${box.needs})` : ''}</button>)}
        <button className="rp-chip" data-on={filter.unread} onClick={() => setFilter({ ...filter, unread: !filter.unread })}>Unread only</button>
        <button className="rp-chip" data-on={filter.att} onClick={() => setFilter({ ...filter, att: !filter.att })}><Paperclip className="size-3" />Attachments</button>
        <button className="rp-chip" data-on={!!filter.starred} onClick={() => setFilter({ ...filter, starred: !filter.starred })}><Star className="size-3" />Starred</button>
        <button className="rp-chip" data-on={more || narrowed} onClick={() => setMore(!more)}><SlidersHorizontal className="size-3" />More filters</button>
        <form className="ml-auto flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); reload() }}>
          <input id="rp-search" className="rp-input !w-44 sm:!w-56" placeholder="Search name, subject, site #" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} />
          <button className={btn('outline', 'sm')} type="submit" title="Search the last 90 days"><Search /></button>
          {filter.q.trim().length > 1 && <button className={btn('ghost', 'sm')} type="button" onClick={search}>Search all of Gmail</button>}
        </form>
      </div>
      {(more || narrowed) && (
        <form className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-hairline text-xs text-muted-foreground" onSubmit={e => { e.preventDefault(); reload() }}>
          <label className="inline-flex items-center gap-1.5">From <input className="rp-input !w-44" placeholder="name or address" value={filter.from ?? ''} onChange={e => setFilter({ ...filter, from: e.target.value })} /></label>
          <label className="inline-flex items-center gap-1.5">On or after <input type="date" className="rp-input !w-auto" value={filter.after ?? ''} onChange={e => setFilter({ ...filter, after: e.target.value })} /></label>
          <label className="inline-flex items-center gap-1.5">On or before <input type="date" className="rp-input !w-auto" value={filter.before ?? ''} onChange={e => setFilter({ ...filter, before: e.target.value })} /></label>
          <button className={btn('outline', 'xs')} type="submit">Apply</button>
          {narrowed && <button className={btn('ghost', 'xs')} type="button" onClick={() => { setFilter({ ...filter, from: '', after: '', before: '' }); setTimeout(reload, 0) }}>Clear</button>}
          <span>Covers the mail RPMail has loaded (the inbox and the last 90 days). Days are counted in your time zone.</span>
        </form>
      )}
      {labels.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-hairline overflow-x-auto">
          <span className="shrink-0 text-xs text-muted-foreground">Labels</span>
          {labels.map(l => (
            <button key={l.id} className={cn('rp-chip shrink-0', over === l.id && 'ring-2 ring-primary')} data-on={filter.label === l.id} title="Click to see what carries this label. Drag a conversation onto it to move it there."
              onClick={() => setFilter(filter.label === l.id ? { ...filter, label: undefined } : { ...filter, view: 'all', label: l.id })}
              onDragOver={e => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); setOver(l.id) } }} onDragLeave={() => setOver('')}
              onDrop={e => { const id = e.dataTransfer.getData(DRAG); setOver(''); if (id) { e.preventDefault(); actions.label({ mailbox_id: box.id, id }, l.id, true, true) } }}>
              <Tag className="size-3" />{l.name}
            </button>
          ))}
        </div>
      )}
      <div className="lg:grid lg:grid-cols-[minmax(280px,38%)_1fr] lg:min-h-[60vh]">
        <div className={cn('lg:border-r border-hairline lg:max-h-[78vh] overflow-y-auto', sel && 'hidden lg:block')}>
          {list && list.length > 0 && filter.view !== 'needs' && (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 px-3 py-1.5 border-b border-hairline bg-card text-xs">
              <label className="inline-flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" className="size-4" checked={chosen.length > 0 && chosen.length === Math.min(list.length, 40)} onChange={e => setPicked(e.target.checked ? new Set(list.slice(0, 40).map(m => m.id)) : new Set())} />{chosen.length ? `${chosen.length} selected` : 'Select'}</label>
              {chosen.length > 0 && <>
                <button className={btn('outline', 'xs')} onClick={() => run('Archive')}><Archive />Archive</button>
                {box.can_delete && <button className={btn('outline', 'xs')} onClick={() => run('Trash')}><Trash2 />Delete</button>}
                <button className={btn('ghost', 'xs')} onClick={() => run('read')}>Mark read</button>
                <button className={btn('ghost', 'xs')} onClick={() => run('unread')}>Mark unread</button>
                <button className={btn('ghost', 'xs')} onClick={() => run('done')}><Check />Done</button>
                {labels.length > 0 && <>
                  <select className="rp-input !w-auto !py-0.5 !text-xs" aria-label="Add a label to the selected conversations" value="" onChange={e => { if (e.target.value) run('label', { label: e.target.value, move: false }) }}>
                    <option value="">Add label…</option>{labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <select className="rp-input !w-auto !py-0.5 !text-xs" aria-label="Move the selected conversations to a label" value="" onChange={e => { if (e.target.value) run('label', { label: e.target.value, move: true }) }}>
                    <option value="">Move to…</option>{labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </>}
                <button className={btn('ghost', 'xs')} onClick={() => setPicked(new Set())}>Clear</button>
              </>}
            </div>
          )}
          {list === null && <Empty>Loading...</Empty>}
          {list && !list.length && <Empty>{box.loading ? 'Your mail is still loading. This fills in as it arrives.' : filter.view === 'snoozed' ? 'Nothing is snoozed. Snooze a message to take it off your lists until a time you pick.' : 'Nothing here.'}</Empty>}
          {list?.map(m => <Row key={m.id} m={m} selected={sel?.id === m.id} pick={filter.view !== 'needs' ? { on: picked.has(m.id), toggle: () => toggle(m.id) } : undefined} labelNames={labelNames} drag={labels.length > 0} {...rowProps} />)}
        </div>
        <div className={cn('lg:max-h-[78vh] overflow-y-auto', !sel && 'hidden lg:block')}>
          {!sel && <Empty>Pick a message to read it. Opening a message does not mark it read.</Empty>}
          {sel && !msg && <Empty>{msgErr || 'Opening...'}</Empty>}
          {sel && msg && <Reader key={msg.id} m={msg} close={close} openOther={openOther} actions={actions} labels={labels} canEdit={canEdit} makeLabel={makeLabel} makeRule={openOrganize} canSend={canSend} canDelete={box.can_delete} />}
        </div>
      </div>
    </div>
  )
}

function Reader({ m, close, openOther, actions, labels, canEdit, makeLabel, makeRule, canSend, canDelete }: { m: Full; close: () => void; openOther: (id: string) => void; actions: Actions; labels: Label[]; canEdit: boolean; makeLabel: (name: string) => Promise<Label | null>; makeRule: (from: string) => void
  /** May this person send from any of their mailboxes, and may they delete in this one? An owner can switch either off for a shared mailbox. */
  canSend: boolean; canDelete: boolean }) {
  const [whenFor, setWhenFor] = useState<'snooze' | 'remind' | null>(null)
  const [imgs, setImgs] = useState(false)   // the reader is keyed by message, so pictures are hidden again for each new one
  const [picker, setPicker] = useState(false)
  const [zip, setZip] = useState('')
  const files = m.attachments.filter(a => !a.inline)
  // Every attachment in one zip file. The files are fetched the same way as opening them one at a time, then packed here in the browser.
  const zipAll = async () => {
    setZip('Getting the files…')
    try {
      const got: { name: string; data: Uint8Array }[] = []
      for (const a of files) {
        const r = await fetch(`/api/rpmail/attachment?mailbox=${m.mailbox_id}&id=${m.id}&i=${a.i}&download=1`)
        if (!r.ok) throw new Error(a.name)
        got.push({ name: a.name, data: new Uint8Array(await r.arrayBuffer()) })
      }
      const url = URL.createObjectURL(new Blob([makeZip(got).buffer as ArrayBuffer], { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url; link.download = (m.subject || 'attachments').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) + '.zip'
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setZip('')
    } catch (e) { setZip(`Could not get ${(e as Error).message}. Download the files one at a time.`) }
  }
  const hasRemote = !!m.html && /<img[^>]+src\s*=\s*["']?https?:/i.test(m.html)
  const doc = useMemo(() => {
    if (!m.html) return ''
    // The message is shown in a locked frame: no scripts, no forms, and nothing loads from the internet unless you ask for pictures.
    const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${imgs ? ' https: http:' : ''}; font-src data:`
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1b2330;margin:12px;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #cfd6e0;color:#555}</style></head><body>${m.html}</body></html>`
  }, [m.html, imgs])
  const it = { mailbox_id: m.mailbox_id, id: m.id }
  const att = (i: number, dl = false) => `/api/rpmail/attachment?mailbox=${m.mailbox_id}&id=${m.id}&i=${i}${dl ? '&download=1' : ''}`
  return (
    <div>
      <div className="px-4 py-3 border-b border-hairline">
        <button className={cn(btn('ghost', 'xs'), 'lg:hidden mb-2')} onClick={close}><ArrowLeft />Back to the list</button>
        <h3 className={cn('text-base text-foreground', m.unread ? 'font-bold' : 'font-semibold')}>{m.subject || '(no subject)'}</h3>
        <p className="text-sm text-muted-foreground mt-0.5"><span className="text-foreground font-medium">{m.from_name}</span> &lt;{m.from_addr}&gt; · {new Date(m.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
        <p className="text-xs text-muted-foreground truncate">To: {m.to_full || m.to_addrs}{m.cc_full ? ' · Cc: ' + m.cc_full : ''}</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {canSend && <>
            <button className={btn('default')} onClick={() => actions.reply(m, false, false)}><Reply />Reply</button>
            <button className={btn()} onClick={() => actions.reply(m, true, false)}><ReplyAll />Reply all</button>
            <button className={btn()} onClick={() => actions.reply(m, false, true)}><Forward />Forward</button>
          </>}
          {m.in_inbox
            ? <button className={btn()} onClick={() => actions.fileTo(it, 'Archive')}><Archive />Archive</button>
            : <button className={btn()} onClick={() => actions.fileTo(it, 'Inbox')}><Inbox />Move to inbox</button>}
          {canDelete && <>
            <button className={btn()} onClick={() => actions.fileTo(it, 'Spam')}><ShieldAlert />Spam</button>
            <button className={btn('destructive')} onClick={() => actions.fileTo(it, 'Trash')}><Trash2 />Delete</button>
          </>}
          <button className={btn('ghost')} onClick={() => actions.markRead(it, !m.unread)}><MailOpen />{m.unread ? 'Mark read' : 'Mark unread'}</button>
          <button className={btn('ghost')} onClick={() => actions.markDone(it, !m.done)}><Check />{m.done ? 'Not done' : 'Done'}</button>
          <button className={btn('ghost')} onClick={() => actions.plateAdd(it)}><ListPlus />Add to My Plate</button>
          <button className={btn('ghost')} onClick={() => actions.star(it, !m.starred)}><Star className={cn(m.starred && 'fill-warning text-warning')} />{m.starred ? 'Starred' : 'Star'}</button>
          <button className={btn('ghost')} onClick={() => printMessage(m)}><Printer />Print</button>
          <span className="relative">
            <button className={btn('ghost')} onClick={() => setPicker(!picker)} aria-expanded={picker}><Tag />Label</button>
            {picker && <LabelPicker labels={labels} on={m.labels ?? []} close={() => setPicker(false)}
              apply={(id, on, move) => actions.label(it, id, on, move)}
              create={async name => { const l = await makeLabel(name); if (l) actions.label(it, l.id, true) }} />}
          </span>
          <span className="relative">
            <button className={btn('ghost')} onClick={() => setWhenFor(whenFor === 'snooze' ? null : 'snooze')} aria-expanded={whenFor === 'snooze'} title="Take it off my lists until a time I pick"><AlarmClock />Snooze</button>
            <button className={btn('ghost')} onClick={() => setWhenFor(whenFor === 'remind' ? null : 'remind')} aria-expanded={whenFor === 'remind'} title="Tell me at a time I pick, if nobody has replied by then"><BellRing />Remind me</button>
            {whenFor && <WhenPicker kind={whenFor} close={() => setWhenFor(null)} pick={ms => { setWhenFor(null); actions.snooze(it, ms, whenFor) }} />}
          </span>
          {canEdit && !m.sent && <button className={btn('ghost')} onClick={() => actions.block(it)} title="This conversation goes to Trash, and so does anything new from this sender"><Ban />Block sender</button>}
          {canEdit && !m.sent && <button className={btn('ghost')} onClick={() => makeRule(m.from_addr)} title="Decide what happens to new mail from this sender"><Wand2 />Make a rule</button>}
        </div>
        {m.snooze && (
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="rp-pill" data-tone={m.snooze.woke ? (m.snooze.kind === 'remind' ? 'warning' : 'info') : undefined}>{snoozeText(m.snooze)}</span>{' '}
            <button className="underline" onClick={() => actions.snooze(it, null, m.snooze!.kind)}>{m.snooze.woke ? 'Clear' : m.snooze.kind === 'remind' ? 'Cancel the reminder' : 'Stop snoozing'}</button>
          </p>
        )}
        {(m.labels ?? []).some(l => labels.some(x => x.id === l)) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {labels.filter(l => (m.labels ?? []).includes(l.id)).map(l => (
              <span key={l.id} className="rp-pill"><Tag className="size-3" />{l.name}<button aria-label={`Take the label ${l.name} off`} title="Take this label off" onClick={() => actions.label(it, l.id, false)}><X className="size-3" /></button></span>
            ))}
          </div>
        )}
      </div>
      {m.attachments.length > 0 && (
        <div className="px-4 py-2 border-b border-hairline flex flex-wrap gap-1.5">
          {m.attachments.map(a => (
            <span key={a.i} className="rp-pill !py-1.5">
              <Paperclip className="size-3" /><a className="hover:underline" href={att(a.i)} target="_blank" rel="noopener noreferrer">{a.name}</a>
              <span className="text-muted-foreground">{size(a.size)}</span><a href={att(a.i, true)} title="Download"><Download className="size-3" /></a>
            </span>
          ))}
          {files.length > 1 && <button className={btn('ghost', 'xs')} onClick={() => void zipAll()} disabled={zip === 'Getting the files…'}><FileArchive />Download all as a zip</button>}
          {zip && <span className="self-center text-xs text-muted-foreground" role="status">{zip}</span>}
        </div>
      )}
      {hasRemote && !imgs && <div className="px-4 py-1.5 border-b border-hairline text-xs text-muted-foreground flex items-center gap-2"><ImageIcon className="size-3.5" />Pictures from the internet are hidden. <button className="underline" onClick={() => setImgs(true)}>Show pictures</button></div>}
      {m.html
        ? <iframe title="Message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} className="w-full h-[60vh] bg-white" />
        : <pre className="px-4 py-3 whitespace-pre-wrap break-words text-sm text-foreground font-sans">{m.text || '(no text)'}</pre>}
      {m.thread.length > 0 && (
        <div className="border-t border-hairline">
          <p className="rp-label px-4 pt-3 pb-1">Also in this conversation</p>
          {m.thread.map(t => (
            <button key={t.id} onClick={() => openOther(t.id)} className={cn('block w-full text-left px-4 py-1.5 text-sm hover:bg-raised', t.unread ? 'font-bold text-foreground' : 'text-muted-foreground')}>
              {t.sent ? 'Sent' : t.from_name} · {when(t.date)} · <span className="font-normal">{t.snippet}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The little box under the Label button: tick a label on or off, move the conversation to one, or make a new one. */
function LabelPicker({ labels, on, apply, create, close }: { labels: Label[]; on: string[]; apply: (id: string, on: boolean, move?: boolean) => void; create: (name: string) => Promise<void>; close: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="absolute left-0 z-20 mt-1 w-72 max-w-[86vw] rp-card p-2 text-sm shadow-lg" role="dialog" aria-label="Labels" onClick={e => e.stopPropagation()}>
      {!labels.length && <p className="px-2 py-1 text-xs text-muted-foreground">No labels yet. Make the first one below.</p>}
      <div className="max-h-60 overflow-y-auto">
        {labels.map(l => { const has = on.includes(l.id); return (
          <div key={l.id} className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-raised">
            <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" className="size-4 shrink-0" checked={has} onChange={() => apply(l.id, !has)} /><span className="truncate">{l.name}</span></label>
            {!has && <button className="shrink-0 text-xs text-muted-foreground underline" title="Label it and take it out of the inbox" onClick={() => { apply(l.id, true, true); close() }}>Move here</button>}
          </div>
        ) })}
      </div>
      <form className="mt-2 flex gap-1.5 border-t border-hairline pt-2" onSubmit={async e => { e.preventDefault(); if (!name.trim() || busy) return; setBusy(true); await create(name.trim()); setName(''); setBusy(false) }}>
        <input className="rp-input" placeholder="New label" aria-label="New label name" maxLength={60} value={name} onChange={e => setName(e.target.value)} />
        <button className={btn('outline', 'sm')} type="submit" disabled={busy || !name.trim()}>Add</button>
      </form>
    </div>
  )
}

/** The choices under Snooze and Remind me. The time is worked out at the moment a choice is pressed. */
function WhenPicker({ kind, pick, close }: { kind: 'snooze' | 'remind'; pick: (ms: number) => void; close: () => void }) {
  const [custom, setCustom] = useState('')
  const [bad, setBad] = useState('')
  const choices: [string, () => number][] = [['In 3 hours', () => inHours(3)], ['Tomorrow morning (8:00)', () => atMorning(1)], ['Monday morning (8:00)', nextMonday], ['In a week', () => atMorning(7)]]
  return (
    <div className="absolute left-0 z-20 mt-1 w-72 max-w-[86vw] rp-card p-2 text-sm shadow-lg" role="dialog" aria-label={kind === 'remind' ? 'Remind me' : 'Snooze'} onClick={e => e.stopPropagation()}>
      <p className="px-2 pb-1 text-xs text-muted-foreground">{kind === 'remind' ? 'You are told at this time if nobody has replied. Nothing is hidden.' : 'It leaves your Inbox and Needs you lists until this time. Only your lists change.'}</p>
      {choices.map(([label, at]) => <button key={label} className="block w-full rounded px-2 py-1.5 text-left hover:bg-raised" onClick={() => pick(at())}>{label}</button>)}
      <form className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-2" onSubmit={e => {
        e.preventDefault()
        const at = Date.parse(custom)
        if (!custom || Number.isNaN(at) || at < Date.now() + 60_000) { setBad('Pick a time that is still to come.'); return }
        pick(at)
      }}>
        <input type="datetime-local" className="rp-input !w-auto flex-1" aria-label="Pick a date and time" value={custom} onChange={e => { setCustom(e.target.value); setBad('') }} />
        <button className={btn('outline', 'sm')} type="submit" disabled={!custom}>Set</button>
        <button className={btn('ghost', 'sm')} type="button" onClick={close}>Cancel</button>
        {bad && <span className="w-full text-xs text-danger" role="alert">{bad}</span>}
      </form>
    </div>
  )
}

const ruleText = (r: Rule, names: Map<string, string>) => {
  const whenParts = [r.match.from && `from ${r.match.from}`, r.match.to && `to ${r.match.to}`, r.match.subject && `with "${r.match.subject}" in the subject`].filter(Boolean)
  const a = r.action
  const then = a.trash ? ['send it to Trash'] : [a.label && `label it ${names.get(a.label) ?? '(a label that was deleted)'}`, a.archive && 'skip the inbox', a.read && 'mark it read', a.star && 'star it', a.quiet && 'never notify'].filter(Boolean)
  return `New mail ${whenParts.join(' and ')}: ${then.join(', ')}.`
}
const NO_RULE = { from: '', to: '', subject: '', label: '', archive: false, read: false, star: false, quiet: false, trash: false }

/** Labels, rules and blocked senders for one mailbox. Renaming, deleting, rules and blocking change the mailbox for everyone who uses it. */
function OrganizeSheet({ box, labels, canEdit, reload, close, say, ruleFrom }: { box: BoxInfo; labels: Label[]; canEdit: boolean; reload: () => Promise<void>; close: () => void; say: (text: string) => void; ruleFrom?: string }) {
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [rule, setRule] = useState({ ...NO_RULE, from: ruleFrom ?? '' })
  const loadRules = useCallback(() => api<{ rules: Rule[] }>('rules', undefined, { mailbox: box.id }).then(r => setRules(r.rules)).catch(() => setRules([])), [box.id])
  useEffect(() => { void loadRules() }, [loadRules])
  const labelNames = useMemo(() => new Map(labels.map(l => [l.id, l.name])), [labels])
  const [blocked, setBlocked] = useState<{ addr: string; since: number }[] | null>(null)
  const [name, setName] = useState('')
  const [addr, setAddr] = useState('')
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null)
  const [drop, setDrop] = useState('')   // the label waiting for "yes, delete it"
  const [busy, setBusy] = useState(false)
  const loadBlocked = useCallback(() => api<{ blocked: { addr: string; since: number }[] }>('blocks', undefined, { mailbox: box.id }).then(r => setBlocked(r.blocked)).catch(() => setBlocked([])), [box.id])
  useEffect(() => { void loadBlocked() }, [loadBlocked])
  const run = async (fn: () => Promise<void>) => { if (busy) return; setBusy(true); try { await fn() } catch (e) { say((e as Error).message) } finally { setBusy(false) } }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" onClick={close}>
      <div className="rp-card w-full sm:max-w-lg max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="rp-card-head"><h2 className="rp-card-title truncate">Labels, rules and blocked senders: {box.name}</h2><button onClick={close} aria-label="Close"><X className="size-5" /></button></div>
        <div className="p-4 space-y-5 text-sm">
          {ruleFrom && canEdit && <p className="rounded-md border border-border bg-raised px-3 py-2 text-xs text-muted-foreground">A new rule for mail from <strong className="text-foreground">{ruleFrom}</strong> is started under Rules below. Choose what should happen and press Add rule.</p>}
          <section className="space-y-2">
            <p className="rp-label">Labels</p>
            <p className="text-xs text-muted-foreground">These are Gmail&apos;s own labels, so they show in Gmail too. Deleting a label never deletes mail.{!canEdit && ' On a shared mailbox only an owner can rename or delete one; anyone can add one.'}</p>
            {!labels.length && <p className="text-muted-foreground">No labels yet.</p>}
            <ul className="divide-y divide-hairline rounded-md border border-border">
              {labels.map(l => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  {edit?.id === l.id ? (
                    <form className="flex flex-1 gap-1.5" onSubmit={e => { e.preventDefault(); void run(async () => { await api('label_save', { mailbox: box.id, id: l.id, name: edit.name }); setEdit(null); await reload(); say('Label renamed.') }) }}>
                      <input className="rp-input" aria-label="Label name" maxLength={60} autoFocus value={edit.name} onChange={e => setEdit({ id: l.id, name: e.target.value })} />
                      <button className={btn('default', 'xs')} type="submit" disabled={busy}>Save</button>
                      <button className={btn('ghost', 'xs')} type="button" onClick={() => setEdit(null)}>Cancel</button>
                    </form>
                  ) : drop === l.id ? (
                    <>
                      <span className="min-w-0 flex-1">Delete <strong>{l.name}</strong>? The mail stays where it is.</span>
                      <button className={btn('destructive', 'xs')} disabled={busy} onClick={() => void run(async () => { await api('label_delete', { mailbox: box.id, label: l.id }); setDrop(''); await reload(); say('Label deleted. The mail is untouched.') })}>Delete the label</button>
                      <button className={btn('ghost', 'xs')} onClick={() => setDrop('')}>Keep it</button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate"><Tag className="mr-1.5 inline size-3.5 text-muted-foreground" />{l.name}</span>
                      {canEdit && <button className={btn('ghost', 'xs')} onClick={() => { setDrop(''); setEdit({ id: l.id, name: l.name }) }}>Rename</button>}
                      {canEdit && <button className={btn('ghost', 'xs')} onClick={() => { setEdit(null); setDrop(l.id) }}>Delete</button>}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); if (name.trim()) void run(async () => { await api('label_save', { mailbox: box.id, name: name.trim() }); setName(''); await reload(); say('Label added.') }) }}>
              <input className="rp-input" placeholder="New label" aria-label="New label name" maxLength={60} value={name} onChange={e => setName(e.target.value)} />
              <button className={btn('outline', 'sm')} type="submit" disabled={busy || !name.trim()}>Add label</button>
            </form>
          </section>
          <section className="space-y-2">
            <p className="rp-label">Rules for new mail</p>
            <p className="text-xs text-muted-foreground">A rule acts on mail as it arrives, within about 5 minutes. Mail that is already here is never touched.{!canEdit && ' On a shared mailbox only an owner can change the rules.'}</p>
            {rules === null && <p className="text-muted-foreground">Loading...</p>}
            {rules && !rules.length && <p className="text-muted-foreground">No rules yet.</p>}
            {rules && rules.length > 0 && (
              <ul className="divide-y divide-hairline rounded-md border border-border">
                {rules.map(r => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    {drop === 'rule:' + r.id ? (
                      <>
                        <span className="min-w-0 flex-1">Delete this rule?</span>
                        <button className={btn('destructive', 'xs')} disabled={busy} onClick={() => void run(async () => { await api('rule_delete', { mailbox: box.id, id: r.id }); setDrop(''); await loadRules(); say('Rule deleted.') })}>Delete the rule</button>
                        <button className={btn('ghost', 'xs')} onClick={() => setDrop('')}>Keep it</button>
                      </>
                    ) : (
                      <>
                        <span className={cn('min-w-0 flex-1', !r.enabled && 'text-muted-foreground line-through')}>{ruleText(r, labelNames)}</span>
                        {canEdit && <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" className="size-4" checked={r.enabled} disabled={busy}
                          onChange={e => void run(async () => { await api('rule_save', { mailbox: box.id, id: r.id, name: r.name, match: r.match, action: r.action, enabled: e.target.checked }); await loadRules() })} />On</label>}
                        {canEdit && <button className={btn('ghost', 'xs')} onClick={() => { setEdit(null); setDrop('rule:' + r.id) }}>Delete</button>}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form className="space-y-2 rounded-md border border-border p-3" onSubmit={e => { e.preventDefault(); void run(async () => {
                await api('rule_save', { mailbox: box.id, match: { from: rule.from, to: rule.to, subject: rule.subject }, action: { label: rule.label, archive: rule.archive, read: rule.read, star: rule.star, quiet: rule.quiet, trash: rule.trash } })
                setRule(NO_RULE); await loadRules(); say('Rule added. It starts with the next mail that arrives.')
              }) }}>
                <p className="text-xs font-semibold text-foreground">When new mail arrives that is…</p>
                <div className="grid gap-1.5 sm:grid-cols-3">
                  <input className="rp-input" placeholder="From (name or address)" aria-label="From contains" maxLength={100} value={rule.from} onChange={e => setRule({ ...rule, from: e.target.value })} />
                  <input className="rp-input" placeholder="To (address)" aria-label="To contains" maxLength={100} value={rule.to} onChange={e => setRule({ ...rule, to: e.target.value })} />
                  <input className="rp-input" placeholder="Subject has" aria-label="Subject contains" maxLength={100} value={rule.subject} onChange={e => setRule({ ...rule, subject: e.target.value })} />
                </div>
                <p className="text-xs font-semibold text-foreground">…then</p>
                <fieldset disabled={rule.trash} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', rule.trash && 'opacity-50')}>
                  <label className="inline-flex items-center gap-1.5">Label it
                    <select className="rp-input !w-auto" aria-label="Label to add" value={rule.label} onChange={e => setRule({ ...rule, label: e.target.value })}>
                      <option value="">no label</option>{labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select></label>
                  {([['archive', 'Skip the inbox'], ['read', 'Mark it read'], ['star', 'Star it'], ['quiet', 'Never notify']] as const).map(([k, l]) => (
                    <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" className="size-4" checked={rule[k]} onChange={e => setRule({ ...rule, [k]: e.target.checked })} />{l}</label>
                  ))}
                </fieldset>
                <label className="flex items-center gap-1.5"><input type="checkbox" className="size-4" checked={rule.trash} onChange={e => setRule({ ...rule, trash: e.target.checked })} />Send it straight to Trash instead (Gmail keeps it 30 days)</label>
                <button className={btn('outline', 'sm')} type="submit" disabled={busy}>Add rule</button>
              </form>
            )}
          </section>
          <section className="space-y-2">
            <p className="rp-label">Blocked senders</p>
            <p className="text-xs text-muted-foreground">New mail from a blocked sender goes straight to Gmail&apos;s Trash, where Gmail keeps it for 30 days. It never shows in RPMail and never sets off a notification.{!canEdit && ' On a shared mailbox only an owner can block or unblock.'}</p>
            {blocked === null && <p className="text-muted-foreground">Loading...</p>}
            {blocked && !blocked.length && <p className="text-muted-foreground">Nobody is blocked.</p>}
            {blocked && blocked.length > 0 && (
              <ul className="divide-y divide-hairline rounded-md border border-border">
                {blocked.map(b => (
                  <li key={b.addr} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate"><Ban className="mr-1.5 inline size-3.5 text-muted-foreground" />{b.addr}</span>
                    <span className="text-xs text-muted-foreground">{when(b.since)}</span>
                    {canEdit && <button className={btn('ghost', 'xs')} disabled={busy} onClick={() => void run(async () => { await api('block', { mailbox: box.id, addr: b.addr, on: false }); await loadBlocked(); say('Unblocked ' + b.addr + '.') })}>Unblock</button>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); if (addr.trim()) void run(async () => { await api('block', { mailbox: box.id, addr: addr.trim() }); setAddr(''); await loadBlocked(); say('Blocked.') }) }}>
                <input className="rp-input" type="email" placeholder="someone@example.com" aria-label="Address to block" value={addr} onChange={e => setAddr(e.target.value)} />
                <button className={btn('outline', 'sm')} type="submit" disabled={busy || !addr.trim()}>Block</button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))

/** Print one message: sender, date, who it went to, attachment names, then the message. Uses a locked frame that cannot run scripts or load anything. */
function printMessage(m: Full) {
  const date = new Date(m.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  const files = m.attachments.filter(a => !a.inline).map(a => esc(a.name)).join(', ')
  const head = `<h2 style="font:600 17px/1.3 Arial,sans-serif;margin:0 0 6px">${esc(m.subject || '(no subject)')}</h2>`
    + `<p style="font:12px/1.5 Arial,sans-serif;color:#333;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid #999">`
    + `<b>From:</b> ${esc(m.from_name)} &lt;${esc(m.from_addr)}&gt;<br><b>Date:</b> ${esc(date)}<br><b>To:</b> ${esc(m.to_full || m.to_addrs)}`
    + (m.cc_full ? `<br><b>Cc:</b> ${esc(m.cc_full)}` : '') + (files ? `<br><b>Attachments:</b> ${files}` : '') + '</p>'
  const body = m.html ?? `<pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.5 Arial,sans-serif">${esc(m.text || '')}</pre>`
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"
  const f = document.createElement('iframe')
  f.setAttribute('sandbox', 'allow-same-origin allow-modals')
  f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${esc(m.subject || 'Message')}</title><style>body{font:13px/1.5 Arial,sans-serif;color:#000;margin:16px}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${head}${body}</body></html>`
  f.onload = () => { try { f.contentWindow?.focus(); f.contentWindow?.print() } finally { setTimeout(() => f.remove(), 120_000) } }
  document.body.appendChild(f)
}

type DoneItem = Item & { done_at: number }

/** What you ticked Done, so a tick made by mistake can be put back. Loaded only when opened. */
function DoneSection({ boxName, rowProps, putBack, stamp }: { boxName?: (id: string) => string; rowProps: RowProps; putBack: (m: { mailbox_id: string; id: string }) => void; stamp: number }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<DoneItem[] | null>(null)
  const [e, setE] = useState('')
  useEffect(() => {
    if (!open) return
    let live = true
    api<{ items: DoneItem[] }>('done_list').then(r => { if (live) { setItems(r.items); setE('') } }).catch(x => { if (live) setE((x as Error).message) })
    return () => { live = false }
  }, [open, stamp])
  return (
    <Section title="Done" count={open && items ? items.length : undefined} right={<button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Show what I marked Done'}</button>}>
      {open && e && <Empty>{e}</Empty>}
      {open && !e && items === null && <Empty>Loading...</Empty>}
      {open && items && !items.length && <Empty>Nothing marked Done yet.</Empty>}
      {open && items?.map(m => (
        <div key={m.mailbox_id + m.id} className="flex items-center gap-3 px-4 py-2 border-b border-hairline text-sm">
          <button className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:underline" onClick={() => rowProps.onOpen(m)}>
            <span className="text-foreground">{m.from_name || m.from_addr}</span>: {m.subject || '(no subject)'}{boxName ? ' · ' + boxName(m.mailbox_id) : ''} · done {when(m.done_at)}
          </button>
          <button className={btn('ghost', 'xs')} onClick={() => putBack(m)}>Put back</button>
        </div>
      ))}
    </Section>
  )
}

const KEYS: [string, string][] = [
  ['?', 'Show or hide this list'], ['c', 'Write a new message'], ['/', 'Jump to the search box'], ['j', 'Next message in the list'], ['k', 'Previous message'],
  ['u', 'Back to the list'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['e', 'Archive (or move back to the inbox)'], ['#', 'Delete (to Trash)'],
  ['s', 'Star or unstar'], ['d', 'Done (off my lists) or not done'], ['m', 'Mark read or unread'], ['p', 'Print'], ['z', 'Snooze until tomorrow morning (or stop snoozing)'], ['Esc', 'Close a menu or this list'],
]
function HelpSheet({ close }: { close: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={close}>
      <div className="rp-card w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="rp-card-head"><h2 className="rp-card-title">Keyboard shortcuts</h2><button onClick={close} aria-label="Close"><X className="size-5" /></button></div>
        <div className="p-4 space-y-1.5 text-sm">
          {KEYS.map(([k, what]) => <div key={k} className="flex items-center gap-3"><kbd className="min-w-9 rounded border border-border bg-raised px-1.5 py-0.5 text-center text-xs font-semibold text-foreground">{k}</kbd><span className="text-muted-foreground">{what}</span></div>)}
          <p className="pt-2 text-xs text-muted-foreground">Shortcuts are off while you are typing. The letters from r down work on the message you have open. You can also right-click a message or a mailbox for a menu.</p>
        </div>
      </div>
    </div>
  )
}

/** The few seconds between pressing Send and the message leaving, with Undo. */
function PendingBar({ to, from, until, undo, now }: { to: string; from: string; until: number; undo: () => void; now: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)))
  useEffect(() => { const t = setInterval(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 250); return () => clearInterval(t) }, [until])
  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center gap-3 rounded-lg bg-foreground text-background px-4 py-2.5 text-sm shadow-lg max-w-[94vw]" role="status">
      <span className="min-w-0 truncate max-w-[60vw]">Sending to {to} from {from} in {left}s</span>
      <button className="font-semibold underline" onClick={undo}>Undo</button>
      <button className="underline opacity-80" onClick={now}>Send now</button>
    </div>
  )
}

const NO_NOTIFY: Notify = { on: false, what: 'people', quiet_from: '', quiet_to: '', off: [] }

/** New-mail notifications: on or off, what sets one off, quiet hours, and which mailboxes. Everything here can be turned back off. */
// What this device's own notification handler last wrote down: when a notification reached it, and whether it could show it.
type LastPush = { at: number; shown: boolean }
async function lastPush(): Promise<LastPush | null> {
  try {
    if (!('caches' in window)) return null
    const r = await (await caches.open('rps-diag')).match('/__push-last')
    const d = r ? await r.json() as Partial<LastPush> : null
    return d && typeof d.at === 'number' ? { at: d.at, shown: d.shown !== false } : null
  } catch { return null }
}
const pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
// Make sure this device runs the newest notification handler before a test, without ever holding the test up for long.
async function freshHandler() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (!reg) return
    await Promise.race([reg.update(), pause(4000)])
    for (let i = 0; i < 10 && (reg.installing || reg.waiting); i++) await pause(300)
  } catch { /* an old handler still shows notifications; it just cannot report back */ }
}

export function NotifySheet({ start, boxes, close, save, zone = 'Eastern' }: { start?: Notify; boxes: BoxInfo[]; close: () => void; save: (n: Notify) => Promise<void>; zone?: string }) {
  const [n, setN] = useState<Notify>(start ?? NO_NOTIFY)
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState('')
  const [local, setLocal] = useState('')
  const [last, setLast] = useState<LastPush | null>(null)
  useEffect(() => {
    // Looks again whenever the person comes back to the app, for a test that arrived while the phone was locked.
    const look = () => { void lastPush().then(setLast) }
    look(); void freshHandler()
    document.addEventListener('visibilitychange', look)
    return () => document.removeEventListener('visibilitychange', look)
  }, [])
  // This device's own registration, if it has one. Never waits long: a browser without notifications has none.
  const mySub = async (): Promise<PushSubscription | null> => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(() => r(null), 3000))])
      return reg ? await reg.pushManager.getSubscription() : null
    } catch { return null }
  }
  const runTest = async () => {
    setTest('Sending…'); setLocal('')
    type R = { devices: number; sent: number; failed: number; here: boolean | null }
    try {
      await freshHandler()
      const sub = await mySub()
      const since = Date.now() - 2000
      let r = await api<R>('notify_test', { endpoint: sub?.endpoint ?? '' })
      if (sub && r.here === false && !r.failed) {
        // This device is switched on but the site had lost track of it: register it again, then test once more.
        await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()) })
        r = await api<R>('notify_test', { endpoint: sub.endpoint })
      }
      const others = r.sent - (r.here ? 1 : 0)
      const n = (k: number) => `${k} other device${k === 1 ? '' : 's'}`
      if (!r.devices) return setTest('No phone or computer has notifications switched on yet. Press the Enable button above first.')
      if (!r.sent) return setTest('The notification service refused it. Press Disable above, then Enable again, and try once more.')
      if (!r.here) return setTest(`Sent to ${n(others)}, but not this one: notifications are not switched on here. Press Enable above to get them on this device too.`)
      // Sent to the device in hand: wait for its own handler to say it arrived.
      setTest(`Sent to this device${others ? ` and ${n(others)}` : ''}. Checking that it arrives…`)
      let got: LastPush | null = null
      for (let i = 0; i < 20 && !got; i++) { await pause(1000); const l = await lastPush(); if (l && l.at >= since) got = l }
      if (got) setLast(got)
      setTest(!got ? 'The notification service accepted it, but it has not reached this device after 20 seconds. Check the phone is online and Low Power Mode is off, then try again. If it keeps happening, press Disable above, then Enable, to register this device afresh.'
        : got.shown ? 'This device received it and handed it to the phone to show. If you saw no banner, the phone itself is hiding it: open Nothing appeared? below.'
        : 'This device received it but was not allowed to show it. Press Disable above, then Enable again, and allow notifications when asked.')
    } catch { setTest('Could not send the test. Try again in a minute.') }
  }
  // Real mail notifications arrive with the phone locked, so this one waits 15 seconds to give time to lock it.
  const runLater = () => {
    setLocal('')
    setTest('Lock the phone now. A test arrives in about 15 seconds. When you open RPMail again, the line below says whether this device received it.')
    void (async () => { const sub = await mySub(); await api('notify_test', { endpoint: sub?.endpoint ?? '', delay: 15 }).catch(() => null); setLast(await lastPush()) })()
  }
  // Shows one without going through the internet at all, to tell "the phone is hiding them" from "it never arrived".
  const runLocal = async () => {
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return setLocal('This browser cannot show notifications. On an iPhone, open RP Intelligence from its Home Screen icon.')
      if (Notification.permission !== 'granted') return setLocal('This device has not allowed notifications yet. Press Enable above.')
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('RPMail test', { body: 'Shown straight from this device.', icon: '/icon-192-v2.png', data: { link: '/rpmail' } })
      setLocal('Shown. If you saw this one but not the test above, this device is fine and the delivery is at fault. If you saw neither, this device is hiding them: go through the list.')
    } catch { setLocal('This device would not show it. Go through the list above, then press Disable and Enable again.') }
  }
  const what: [Notify['what'], string, string][] = [
    ['needs', 'Only mail that asks me for something', 'From a person, with a question or a request in it.'],
    ['people', 'Any mail from a person', 'Newsletters, receipts and other automatic mail stay quiet.'],
    ['all', 'Everything', 'Every new message, newsletters included.'],
  ]
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" onClick={close}>
      <div className="rp-card w-full sm:max-w-lg max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="rp-card-head"><h2 className="rp-card-title">Notifications</h2><button onClick={close} aria-label="Close"><X className="size-5" /></button></div>
        <div className="p-4 space-y-4 text-sm">
          <label className="flex items-start gap-2.5"><input type="checkbox" className="mt-0.5 size-4" checked={n.on} onChange={e => setN({ ...n, on: e.target.checked })} />
            <span><span className="font-semibold text-foreground">Tell me when new mail arrives</span><span className="block text-xs text-muted-foreground">Mail is checked every 5 minutes, even with RPMail closed. You get one notification per check, not one per message.</span></span></label>
          <fieldset disabled={!n.on} className={cn('space-y-4', !n.on && 'opacity-50')}>
            <div className="space-y-1.5">
              <p className="rp-label">What sets one off</p>
              {what.map(([v, l, d]) => <label key={v} className="flex items-start gap-2.5"><input type="radio" name="rp-notify-what" className="mt-0.5 size-4" checked={n.what === v} onChange={() => setN({ ...n, what: v })} /><span><span className="text-foreground">{l}</span><span className="block text-xs text-muted-foreground">{d}</span></span></label>)}
            </div>
            <div>
              <p className="rp-label mb-1.5">Quiet hours ({zone} time)</p>
              <div className="flex flex-wrap items-center gap-2 text-muted-foreground">Nothing between
                <input type="time" className="rp-input !w-auto" value={n.quiet_from} onChange={e => setN({ ...n, quiet_from: e.target.value })} aria-label="Quiet hours start" /> and
                <input type="time" className="rp-input !w-auto" value={n.quiet_to} onChange={e => setN({ ...n, quiet_to: e.target.value })} aria-label="Quiet hours end" />
                {(n.quiet_from || n.quiet_to) && <button type="button" className="underline text-xs" onClick={() => setN({ ...n, quiet_from: '', quiet_to: '' })}>No quiet hours</button>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Mail that arrives in quiet hours is not announced later; it is waiting in RPMail.</p>
            </div>
            {boxes.length > 0 && (
              <div className="space-y-1.5">
                <p className="rp-label">Which mailboxes</p>
                {boxes.map(b => <label key={b.id} className="flex items-center gap-2.5"><input type="checkbox" className="size-4" checked={!n.off.includes(b.id)} onChange={e => setN({ ...n, off: e.target.checked ? n.off.filter(x => x !== b.id) : [...n.off, b.id] })} /><span className="text-foreground">{b.name}</span><span className="text-xs text-muted-foreground truncate">{b.address}</span></label>)}
              </div>
            )}
          </fieldset>
          <div className="rounded-md border border-border bg-raised p-3 space-y-2">
            <p className="font-semibold text-foreground">This phone or computer</p>
            <p className="text-xs text-muted-foreground">Notifications arrive on each device where you switch them on here. On an iPhone, add RP Intelligence to the Home Screen first (Share, then Add to Home Screen) and open it from there.</p>
            <PushToggle />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" className={btn('outline', 'sm')} onClick={runTest}>Send a test notification</button>
              <button type="button" className={btn('ghost', 'sm')} onClick={runLater}>Send one in 15 seconds</button>
            </div>
            {test && <p className="text-xs text-muted-foreground" role="status">{test}</p>}
            {last && <p className="text-xs text-muted-foreground">Last notification this device received: {new Date(last.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' })}{last.shown ? '.' : ' (the device would not show it).'}</p>}
            {test && test !== 'Sending…' && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer font-semibold text-foreground">Nothing appeared?</summary>
                <ol className="mt-1.5 list-decimal pl-4 space-y-1">
                  <li>Swipe down from the top of the screen. It may be sitting in Notification Center without having made a sound.</li>
                  <li>iPhone: Settings, Notifications, then RP Intel (the name under the Home Screen icon). Allow Notifications must be on, with Lock Screen, Notification Center and Banners all ticked. If it is not in that list, this phone was never switched on: press Enable above.</li>
                  <li>Turn off Focus (Do Not Disturb, Sleep, Work, Driving), or allow RP Intel in it. In Settings, Notifications, Scheduled Summary, make sure RP Intel is not held for the summary.</li>
                  <li>On an iPhone it only works when opened from the Home Screen icon (not Safari), on iOS 16.4 or later.</li>
                  <li>Mac or PC: allow notifications for your browser in the computer&apos;s own notification settings, and switch off Do Not Disturb.</li>
                </ol>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" className={btn('outline', 'xs')} onClick={runLocal}>Show one straight from this device</button>
                  {local && <span role="status">{local}</span>}
                </div>
              </details>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Text messages are not available yet.</p>
          <div className="flex gap-2">
            <button className={btn('default', 'default')} disabled={busy} onClick={async () => { setBusy(true); await save(n); setBusy(false) }}>Save</button>
            <button className={btn('ghost', 'default')} onClick={close}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}
