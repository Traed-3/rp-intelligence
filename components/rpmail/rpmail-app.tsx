'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Mail, LayoutDashboard, PenSquare, RefreshCw, Paperclip, Check, Archive, Trash2, ShieldAlert, Reply, ReplyAll, Forward, Inbox,
  MailOpen, ListPlus, ArrowLeft, Search, ExternalLink, Signature, Unplug, Image as ImageIcon, Download, Star, Printer, Keyboard, MoreVertical, X, Bell, Tag, Tags, Ban, FileArchive, SlidersHorizontal, AlarmClock, BellRing, Wand2, Settings, CircleHelp, Clock, Send, ChevronRight, AppWindow,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Item, ThreadItem } from '@/lib/rpmail/mail-ops'
import type { BoxInfo } from '@/lib/rpmail/overview'
import type { Label } from '@/lib/rpmail/organize'
import type { Found } from '@/lib/rpmail/search'
import type { Rule } from '@/lib/rpmail/arrival'
import { makeZip } from '@/lib/rpmail/zip'
import { buildStack, startOpen, shownOf, isForward, htmlHasQuote, splitPlainQuote, shownText, ownPictures, wantsRemotePictures, frameHeight, messageDoc } from '@/lib/rpmail/thread-view'
import { PushToggle } from '@/app/(app)/settings/alerts/push-toggle'
import { Compose, clearDraft, whenText, type ComposeStart, type Outgoing } from './compose'
import { useAsk } from './ask'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { openMailWindow, showInMain } from '@/lib/rpmail/window'

// The built-in RPMail page: Dashboard (a tile per mailbox, My Plate, Your jobs, Needs you, Daily summary) and one
// inbox per mailbox. Unread mail is bold everywhere. Opening a message never marks it read.

export type Notify = { on: boolean; what: 'needs' | 'people' | 'all'; quiet_from: string; quiet_to: string; off: string[] }
export type Group = { name: string; addrs: string[] }
export type Prefs = { hidden: string[]; order: string[]; undo_secs?: number; notify?: Notify; sender_name?: string; default_from?: string; start?: string; density?: 'comfortable' | 'compact'; tz?: string; groups?: Group[]; lists_off?: string[] }
/** Lists drawn tighter (one line less per message) when the person chose Compact in Settings. */
const Compact = createContext(false)
/** True inside the mail window (/mail): sign-ins come back to it, and links to the rest of RP Intelligence open in the main window. */
const Win = createContext(false)
const connectHref = (id: string, win: boolean) => `/api/rpmail/connect?mailbox=${id}${win ? '&back=mail' : ''}`
export type State = { prefs?: Prefs; enabled: boolean; name: string; role: string; googleReady: boolean; personalAddress: string | null; loginEmail: string; boxes: BoxInfo[]; note: string | null }
type PlateItem = { id: string; title: string; detail: string; kind: string; site_number: string | null; priority: number; due_date: string | null; status: string; waiting_on: string | null; mail: Item | null; mail_n: number }
type SumItem = { mailbox_id: string; id: string; date: number; from_name: string; subject: string; site: string | null; po: string | null; snippet: string; why?: string; unread?: boolean }
type Summary = { day: string; created: number; data: { since: number; boxes: { id: string; name: string; received: number; items: SumItem[]; more: number }[]; needs: SumItem[]; stale: SumItem[]; permits: SumItem[]; pos: SumItem[]; deadlines: SumItem[] } }
type Move = { id: number; mailbox_id: string; subject: string; from_place: string; to_place: string; undone: boolean; created_at: number }
type Overview = { prefs?: Prefs; boxes: BoxInfo[]; needs: Item[]; foryou: Item[]; plate: { items: PlateItem[]; error: string | null }; summary: Summary | null; moves: Move[]; now: number }
type Full = Item & { cc_addrs: string; to_full: string; cc_full: string; text: string; html: string | null; done: boolean; hidden: boolean
  attachments: { i: number; name: string; type: string; size: number; inline: boolean }[]
  thread: ThreadItem[] }
type Toast = { text: string; undo?: () => void } | null
type Filter = { view: 'inbox' | 'needs' | 'sent' | 'filed' | 'all' | 'snoozed' | 'drafts' | 'scheduled'; q: string; unread: boolean; att: boolean; starred?: boolean; label?: string; from?: string; after?: string; before?: string }
type LabelSet = { box: string; labels: Label[]; can_edit: boolean }
type BulkAction = 'Archive' | 'Trash' | 'read' | 'unread' | 'done' | 'label'
type View = { kind: 'dash' } | { kind: 'box'; id: string } | { kind: 'search' }
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
/** The Done button on the dashboard lists (My Plate, Your jobs, Needs you): one look everywhere, a solid green pill (Trae, 11/24/26),
 *  in the same green as the My Plate count (the theme's `success`). In dark mode that green is brighter, so the words turn dark. */
const DONE_BTN = cn(buttonVariants({ size: 'xs' }), 'self-center shrink-0 rounded-full px-3 border-transparent bg-success text-white hover:bg-success/90 focus-visible:ring-success/40 dark:text-[oklch(0.2_0.04_160)]')

export function RpmailApp({ localUrl, connected, connectError, windowed = false }: { localUrl: string | null; connected?: string; connectError?: string
  /** The mail window (/mail): mailboxes and folders fill the navy menu on the left, like the main RP Intelligence menu. */
  windowed?: boolean }) {
  const [st, setSt] = useState<State | null>(null)
  const [ov, setOv] = useState<Overview | null>(null)
  const [view, setView] = useState<View>(connected ? { kind: 'box', id: connected } : { kind: 'dash' })
  const [filter, setFilter] = useState<Filter>({ view: 'inbox', q: '', unread: false, att: false })
  const [listState, setList] = useState<{ key: string; items: Item[] } | null>(null)
  const [sel, setSel] = useState<{ mailbox: string; id: string } | null>(null)
  const [msg, setMsg] = useState<Full | null>(null)
  const [msgErr, setMsgErr] = useState('')
  const [peek, setPeek] = useState<Item | null>(null)   // the list line of the message being opened, shown until the message arrives
  // Search every mailbox: what was asked, what came back (null while looking), and whether the mailboxes themselves were asked too.
  const [found, setFound] = useState<{ q: string; items: Found[] | null; further?: boolean; busy?: boolean; missed?: string[] } | null>(null)
  const [allQ, setAllQ] = useState('')
  const selNow = useRef(sel)                       // what is open right now, for work that finishes later (a send)
  useEffect(() => { selNow.current = sel })
  const [toast, setToast] = useState<Toast>(connected ? { text: 'Connected. Your mail is loading.' } : null)
  const [busy, setBusy] = useState(false)
  const [compose, setCompose] = useState<ComposeStart | null>(null)
  const [err, setErr] = useState(connectError ?? '')
  const [menu, setMenu] = useState<{ x: number; y: number; item: Item } | null>(null)
  const [boxMenu, setBoxMenu] = useState<{ x: number; y: number; box: BoxInfo } | null>(null)
  const [help, setHelp] = useState(false)
  const [ask, asking] = useAsk()
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
    // Drafts are read live from Gmail Drafts (they are not in the list RPMail keeps), and shown as list lines.
    if (f.view === 'drafts') return api<{ drafts: { id: string; thread_id: string; date: number; to: string; subject: string; snippet: string; scheduled_at?: number | null }[] }>('drafts', undefined, { mailbox: v.id })
      .then(r => setList({ key: keyOf(v, f), items: r.drafts.map(d => ({ mailbox_id: v.id, id: d.id, thread_id: d.thread_id, date: d.date, from_name: d.scheduled_at ? 'Scheduled' : 'Draft', from_addr: '', to_addrs: d.to || '(nobody yet)',
        subject: d.subject, snippet: (d.scheduled_at ? `Goes out ${whenText(d.scheduled_at)}. ` : '') + d.snippet, unread: false, starred: false, has_att: false, in_inbox: false, sent: true, site: null, po: null, labels: [] })) }))
      .catch(e => setErr((e as Error).message))
    // Scheduled messages have their own list (ScheduledList), which loads itself.
    if (f.view === 'scheduled') { setList({ key: keyOf(v, f), items: [] }); return Promise.resolve() }
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
          // Google asked to slow down: give it a breather, so a message opened meanwhile is not kept waiting.
          if (r.busy) await new Promise(res => setTimeout(res, 15_000))
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
    if (connected || connectError) window.history.replaceState(null, '', windowed ? '/mail' : '/rpmail')
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
    // Marking read covers the whole conversation; marking unread only the message that was picked.
    setMsg(m => m && m.id === it.id ? { ...m, unread, thread: unread ? m.thread : m.thread.map(t => ({ ...t, unread: false })) } : m)
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
      // A reply shows in the open conversation straight away, without opening it again.
      const s = selNow.current
      if (s && out.start.mode === 'reply' && out.start.mailbox === s.mailbox) api<Full>('message', undefined, { mailbox: s.mailbox, id: s.id }).then(f => setMsg(cur => cur && cur.id === f.id ? f : cur)).catch(() => null)
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
    say(on ? (boxes.some(b => b.id === id) ? 'Closed. The mailbox is still in the list on the left; put the block back from under the dashboard blocks.' : 'Closed. Put it back from under the dashboard blocks.') : 'Back on the dashboard.')
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
      if (document.querySelector('[role=alertdialog]')) return   // an "are you sure?" box is open: no shortcut acts behind it
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
        case '/': (document.getElementById(k.view.kind === 'box' ? 'rp-search' : 'rp-search-all') ?? document.getElementById('rp-search-all'))?.focus(); return done()
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

  if (!st) return <div className={cn('p-6 text-sm text-muted-foreground', windowed && 'rp-main min-h-dvh')}>{err || 'Loading RPMail...'}</div>
  if (!st.enabled) return <div className={cn(windowed && 'rp-main min-h-dvh')}><Setup st={st} localUrl={localUrl} onOn={boot} /></div>

  const onBoxMenu = (e: React.MouseEvent, b: BoxInfo) => { e.preventDefault(); e.stopPropagation(); setMenu(null); setBoxMenu({ x: e.clientX, y: e.clientY, box: b }) }
  const goBox = (id: string) => { setFilter({ view: 'inbox', q: '', unread: false, att: false }); setView({ kind: 'box', id }); setSel(null); setMsg(null); setFound(null) }
  const signOut = (b: BoxInfo) => void ask({ text: `Sign ${b.address} out of RPMail? Nothing in Gmail is touched. ${b.kind === 'shared' ? 'Everyone who has this shared mailbox loses it here until someone signs it in again.' : 'You can sign in again any time.'}`, yes: 'Sign out' }).then(ok => { if (ok) void act(async () => { await api('disconnect', { mailbox: b.id }); await boot(); say('Signed out.') }) })
  const canSignOut = (b: BoxInfo) => b.connected && (b.kind === 'personal' || st.role === 'owner')
  const rowProps = { onStar: (it: Item) => void toggleStar(it, !it.starred), onOpen: (it: Item) => { setPeek(it); if (view.kind !== 'box' || view.id !== it.mailbox_id) { setFilter({ view: 'all', q: '', unread: false, att: false }); setView({ kind: 'box', id: it.mailbox_id }) } void openMsg(it.mailbox_id, it.id) },
    onMenu: (e: React.MouseEvent, it: Item) => { e.preventDefault(); setBoxMenu(null); setMenu({ x: e.clientX, y: e.clientY, item: it }) } }
  // In the Drafts list a line opens the draft to finish it; there is no menu or star (a draft is not a received message).
  const draftRows = { onOpen: (it: Item) => setCompose({ mode: 'draft', mailbox: it.mailbox_id, draft: it.id }), onMenu: (e: React.MouseEvent) => e.preventDefault() }

  const newMessage = () => setCompose({ mode: 'new', mailbox: cur?.connected && cur.can_send ? cur.id : boxes.find(b => b.id === st.prefs?.default_from && b.connected && b.can_send)?.id ?? boxes.find(b => b.connected && b.can_send)?.id ?? '' })
  const canWrite = boxes.some(b => b.connected && b.can_send)
  const writeTitle = boxes.some(b => b.connected) && !canWrite ? 'You can read your mailboxes here but not send from them. An owner can change that.' : undefined
  const goDash = () => { setView({ kind: 'dash' }); setSel(null); setMsg(null); setFound(null) }
  const pickFolder = (id: string, f: Partial<Filter>) => { setFilter({ view: 'inbox', q: '', unread: false, att: false, ...f }); setView({ kind: 'box', id }); setSel(null); setMsg(null); setFound(null) }
  const closeMenus = () => { if (menu) setMenu(null); if (boxMenu) setBoxMenu(null) }
  const ownWindow = () => { if (!openMailWindow()) say('Your browser stopped the new window. Allow pop-ups for rpintelligence.app, then press it again.') }
  const searchAll = async (q: string) => {
    setView({ kind: 'search' }); setSel(null); setMsg(null); setFound({ q, items: null })
    try { const r = await api<{ messages: Found[] }>('search_all', undefined, { q }); setFound({ q, items: r.messages }) }
    catch (e) { setFound(f => f && f.q === q ? { q, items: [] } : f); say((e as Error).message) }
  }
  const searchFurther = async () => {
    if (!found?.items) return
    const q = found.q
    setFound(f => f && { ...f, busy: true })
    try {
      const r = await api<{ messages: Found[]; missed: string[] }>('search_all_further', { q })
      setFound(f => {
        if (!f || f.q !== q) return f
        const key = (m: Found) => m.mailbox_id + ':' + m.thread_id
        const have = new Set((f.items ?? []).map(key))
        const items = [...(f.items ?? []), ...r.messages.filter(m => !have.has(key(m)))].sort((a, b) => b.date - a.date)
        return { q, items, further: true, missed: r.missed }
      })
    } catch (e) { setFound(f => f && { ...f, busy: false }); say((e as Error).message) }
  }
  const searchBox = (
    <form className="flex min-w-0 items-center gap-1.5" onSubmit={e => { e.preventDefault(); const q = allQ.trim(); if (q.length > 1) void searchAll(q) }}>
      <input id="rp-search-all" className="rp-input !w-52 sm:!w-72" placeholder="Search every mailbox" value={allQ} onChange={e => setAllQ(e.target.value)} aria-label="Search every mailbox" />
      <button className={btn('outline', 'sm')} type="submit" title="Search every mailbox (press / to jump here)"><Search /></button>
    </form>
  )

  const tools = (
    <div className="flex flex-wrap items-center gap-2">
      <button className={btn('ghost')} onClick={() => setNotifyOpen(true)} title="New-mail notifications"><Bell /><span className="hidden sm:inline">Notifications{st.prefs?.notify?.on ? ' on' : ''}</span></button>
      {windowed
        ? <button className={btn('ghost')} onClick={() => showInMain('/rpmail/settings')} title="Your name on mail, signatures, defaults, time zone and more (opens in RP Intelligence)"><Settings /><span className="hidden sm:inline">Settings</span></button>
        : <Link className={cn(btn('ghost'), '!text-[0.8rem] !font-semibold')} href="/rpmail/settings" title="Your name on mail, signatures, defaults, time zone and more"><Settings /><span className="hidden sm:inline">Settings</span></Link>}
      <button className={cn(btn('ghost'), 'hidden sm:inline-flex')} onClick={() => setHelp(true)} title="Keyboard shortcuts (press ?)"><Keyboard />Shortcuts</button>
      {windowed
        ? <button className={cn(btn('ghost'), 'hidden sm:inline-flex')} onClick={() => showInMain('/help/rpmail')} title="How to use RPMail, step by step (opens in RP Intelligence)"><CircleHelp />Help</button>
        : <Link className={cn(btn('ghost'), '!text-[0.8rem] !font-semibold hidden sm:inline-flex')} href="/help/rpmail" title="How to use RPMail, step by step"><CircleHelp />Help</Link>}
      {!windowed && <button className={cn(btn('ghost'), 'hidden md:inline-flex')} onClick={ownWindow} title="Open RPMail in its own window. It stays open and loaded while you use the rest of RP Intelligence."><AppWindow />Own window</button>}
      <button className={btn('ghost')} onClick={() => void syncAll(boxes)} disabled={busy} title="Check for new mail"><RefreshCw className={cn(busy && 'animate-spin')} />{busy ? 'Checking' : 'Check mail'}</button>
      <button className={cn(btn('default'), windowed && 'md:hidden')} onClick={newMessage} disabled={!canWrite || !!pending} title={writeTitle}><PenSquare />New message</button>
    </div>
  )
  const alerts = <>
    {err && <p className="mb-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
    {st.note && <p className="mb-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">{st.note}</p>}
  </>
  const boxButtons = <>
    <NavBtn on={view.kind === 'dash'} onClick={goDash} icon={<LayoutDashboard className="size-4" />} label="Dashboard" />
    {boxes.map(b => (
      <NavBtn key={b.id} on={view.kind === 'box' && view.id === b.id} icon={<Mail className="size-4" />} label={b.name} sub={b.connected ? b.address : 'Signed out'} count={b.unread}
        onClick={() => goBox(b.id)} onContextMenu={e => onBoxMenu(e, b)} />
    ))}
  </>
  const views = (
        <div className="flex-1 min-w-0">
          {view.kind === 'search' && found && (
            <Section title={'Search: ' + found.q} count={found.items?.length} tone="info" right={<button className={btn('ghost', 'xs')} onClick={() => { setFound(null); goDash() }}><X />Close</button>}>
              {found.items === null && <Empty>Looking in every mailbox...</Empty>}
              {found.items && !found.items.length && <Empty>Nothing found in what RPMail has loaded: each inbox, its folders and the last 90 days. Press the button below to ask every mailbox itself.</Empty>}
              {found.items?.map(m => <Row key={m.mailbox_id + m.id} m={m} boxLabel={boxName(m.mailbox_id) + ' · ' + m.where} {...rowProps} />)}
              {found.items && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
                  {found.further
                    ? <span>Every mailbox was asked too{found.missed?.length ? `; no answer from ${found.missed.join(', ')}` : ''}.</span>
                    : <><button className={btn('outline', 'sm')} disabled={found.busy} onClick={() => void searchFurther()}><Search />{found.busy ? 'Asking every mailbox...' : 'Look further back in every mailbox'}</button>
                      <span>Searches each mailbox itself, past the last 90 days (up to 25 matches each).</span></>}
                </div>
              )}
            </Section>
          )}
          {view.kind === 'box' && found && <button className={cn(btn('ghost', 'xs'), 'mb-2')} onClick={() => { setView({ kind: 'search' }); setSel(null); setMsg(null) }}><ArrowLeft />Back to the search for &ldquo;{found.q}&rdquo;</button>}
          {view.kind === 'dash' && ov && <Dash ov={ov} boxes={boxes} hidden={hidden} order={st.prefs?.order ?? []} reorder={order => void savePrefs({ order })} close={id => setHidden(id, true)} onBoxMenu={onBoxMenu} putBack={id => setHidden(id, false)} boxName={boxName} rowProps={rowProps} goBox={goBox}
            markDone={markDone} plateDone={plateDone} undo={id => void act(async () => { const u = await api<{ back_to: string }>('undo', { move: id }); await refresh(); say('Back in ' + u.back_to + '.') })} />}
          {view.kind === 'dash' && !ov && <p className="text-sm text-muted-foreground">Loading...</p>}
          {view.kind === 'dash' && (
            <p className="mt-6 text-xs text-muted-foreground">RPMail is on for your login.{' '}
              <button className="underline" onClick={() => void ask({ text: 'Turn RPMail off? Your own mailbox is disconnected from RP Intelligence. Your mail in Gmail is not touched, and you can turn it back on any time.', yes: 'Turn it off', danger: true }).then(ok => { if (ok) void act(async () => { await api('enable', { on: false }); await boot() }) })}>Turn it off</button>
            </p>
          )}
          {view.kind === 'box' && cur && !cur.connected && <Connect box={cur} st={st} />}
          {view.kind === 'box' && cur && cur.connected && (
            <BoxView box={cur} filter={filter} setFilter={setFilter} list={list} sel={sel} msg={msg} msgErr={msgErr} peek={peek && peek.id === sel?.id ? peek : null} rowProps={filter.view === 'drafts' ? draftRows : rowProps} reload={loadList} bulk={(ids, action, extra) => void bulk(cur.id, ids, action, extra)}
              labels={labelSet?.box === cur.id ? labelSet.labels : []} canEdit={labelSet?.box === cur.id && labelSet.can_edit} openOrganize={from => setOrganize({ from })} makeLabel={name => makeLabel(cur.id, name)} canSend={boxes.some(b => b.connected && b.can_send)}
              close={() => { setSel(null); setMsg(null) }}
              search={() => void act(async () => { say('Searching all of Gmail...'); const r = await api<{ messages: Item[] }>('search', { mailbox: cur.id, q: filter.q }); setList({ key: keyOf(view, filter), items: r.messages }); say(r.messages.length ? `${r.messages.length} found in Gmail.` : 'Nothing found in Gmail.') })}
              actions={{ fileTo, markRead, markDone, plateAdd, star: toggleStar, label: applyLabel, block: blockFrom, snooze, reply: (m, all, fwd) => setCompose({ mode: fwd ? 'forward' : 'reply', mailbox: m.mailbox_id, id: m.id, all }) }}
              editSig={() => setCompose({ mode: 'signature', mailbox: cur.id })}
              openDraft={draft => setCompose({ mode: 'draft', mailbox: cur.id, draft })} say={say}
              disconnect={canSignOut(cur) ? () => signOut(cur) : undefined} />
          )}
        </div>
  )
  const overlays = <>
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
          {!b.connected && st.googleReady && <a className="block w-full px-4 py-1.5 text-left !font-normal hover:bg-raised" href={connectHref(b.id, windowed)}>Sign in</a>}
          {b.connected && st.googleReady && <a className="block w-full px-4 py-1.5 text-left !font-normal hover:bg-raised" href={connectHref(b.id, windowed)}>Sign in again</a>}
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
      {asking}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-foreground text-background px-4 py-2.5 text-sm shadow-lg max-w-[92vw]">
          <span>{toast.text}</span>
          {toast.undo && <button className="font-semibold underline" onClick={() => { const u = toast.undo!; setToast(null); u() }}>Undo</button>}
        </div>
      )}
      {pending && !compose && <PendingBar to={pending.out.to} from={pending.out.from} until={pending.until} undo={undoSend} now={sendNow} />}
      {compose && <Compose key={JSON.stringify(compose)} start={compose} boxes={boxes} groups={st.prefs?.groups ?? []} undoSecs={st.prefs?.undo_secs ?? 10} setUndoSecs={n => void savePrefs({ undo_secs: n })}
        onClose={() => setCompose(null)} onDone={text => { setCompose(null); say(text); void refresh() }} onSend={out => queueSend(out, st.prefs?.undo_secs ?? 10)} />}
  </>

  return (
    <Win.Provider value={windowed}>
    <Compact.Provider value={st.prefs?.density === 'compact'}>
    {windowed ? (
      <div className="flex h-dvh w-full overflow-hidden" onClick={closeMenus}>
        <MailSidebar boxes={boxes} view={view} filter={filter} needs={ov?.needs.length ?? 0} stamp={ov?.now ?? 0} newMessage={newMessage} canWrite={canWrite && !pending} writeTitle={writeTitle}
          goDash={goDash} pick={pickFolder} onBoxMenu={onBoxMenu} />
        <main className="rp-main flex-1 min-w-0 overflow-y-auto">
          <div className="p-3 sm:p-5 max-w-[1700px] mx-auto">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{searchBox}{tools}</div>
            {/* On a phone the menu on the left steps aside; the mailboxes are a row across the top instead. */}
            <nav className="md:hidden mb-3 flex gap-1.5 overflow-x-auto pb-1">{boxButtons}</nav>
            {alerts}
            {views}
          </div>
        </main>
        {overlays}
      </div>
    ) : (
      <div className="p-3 sm:p-5 max-w-[1500px] mx-auto" onClick={closeMenus}>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h1 className="rp-title">RPMail</h1>
            <p className="rp-subtitle">Your mail, what needs a reply and your jobs, in one place.{localUrl && <> <a className="underline" href={localUrl} target="_blank" rel="noopener noreferrer">Open your own RPMail</a></>}</p>
          </div>
          {tools}
        </div>
        <div className="mb-3">{searchBox}</div>
        {alerts}
        <div className="flex flex-col lg:flex-row gap-4">
          <nav className="lg:w-56 shrink-0 flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">{boxButtons}</nav>
          {views}
        </div>
        {overlays}
      </div>
    )}
    </Compact.Provider>
    </Win.Provider>
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
type FolderNode = { name: string; path: string; label?: Label; kids: FolderNode[] }
/** Labels named with slashes ("RPS/Project Folders") as a tree, the way Gmail and Proton show them. */
function folderTree(labels: Label[]): FolderNode[] {
  const root: FolderNode = { name: '', path: '', kids: [] }
  for (const l of [...labels].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = l.name.split('/').map(x => x.trim()).filter(Boolean)
    let at = root
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let n = at.kids.find(k => k.name === part)
      if (!n) { n = { name: part, path, kids: [] }; at.kids.push(n) }
      if (i === parts.length - 1) n.label = l
      at = n
    })
  }
  return root.kids
}
const readSet = (key: string, fallback: string[] = []): Set<string> => { try { const v = JSON.parse(localStorage.getItem(key) ?? 'null'); return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : fallback) } catch { return new Set(fallback) } }
const keepSet = (key: string, v: Set<string>) => { try { localStorage.setItem(key, JSON.stringify([...v])) } catch { /* storage is off: the tree just starts open each time */ } }

/** "10 / 762": unread (in gold) of everything RPMail has loaded there; just the total when nothing is unread. */
function Count({ unread, total }: { unread?: number; total?: number }) {
  if (!unread && !total) return null
  return <span className="ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-gray-500">{unread ? <><b className="font-semibold text-gold">{unread}</b>{total ? ' / ' + total : ''}</> : total}</span>
}

/**
 * The navy menu of the mail window: New message, Dashboard, then every mailbox with its folders (the views RPMail keeps,
 * and the mailbox's own labels or Proton folders as a tree with unread / total). Drawn like the main RP Intelligence menu.
 */
function MailSidebar({ boxes, view, filter, needs, stamp, newMessage, canWrite, writeTitle, goDash, pick, onBoxMenu }: {
  boxes: BoxInfo[]; view: View; filter: Filter; needs: number; stamp: number; newMessage: () => void; canWrite: boolean; writeTitle?: string
  goDash: () => void; pick: (box: string, f: Partial<Filter>) => void; onBoxMenu: (e: React.MouseEvent, b: BoxInfo) => void }) {
  // Which mailboxes are opened up, and which folders are folded shut: remembered in this browser.
  const [open, setOpen] = useState<Set<string>>(() => readSet('rpmail:tree:open', boxes.slice(0, 2).map(b => b.id)))
  const [shut, setShut] = useState<Set<string>>(() => readSet('rpmail:tree:shut'))
  const [folders, setFolders] = useState<Record<string, Label[]>>({})
  const loadedAt = useRef<Record<string, number>>({})
  useEffect(() => {
    for (const b of boxes) {
      if (!b.connected || !open.has(b.id)) continue
      if (Date.now() - (loadedAt.current[b.id] ?? 0) < 60_000) continue   // counts follow the mail, at most once a minute per mailbox
      loadedAt.current[b.id] = Date.now()
      api<{ labels: Label[] }>('labels', undefined, { mailbox: b.id }).then(r => setFolders(f => ({ ...f, [b.id]: r.labels }))).catch(() => { loadedAt.current[b.id] = 0 })
    }
  }, [boxes, open, stamp])
  const flip = (set: Set<string>, key: string, save: (s: Set<string>) => void, store: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); keepSet(store, n); save(n) }
  const here = (id: string) => view.kind === 'box' && view.id === id
  const row = (on: boolean) => cn('group relative flex w-full min-w-0 items-center gap-1.5 rounded-md py-[5px] pr-2 text-left text-[13px] transition-colors',
    on ? 'bg-sidebar-accent text-foreground' : 'text-gray-600 hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent focus-visible:text-foreground')
  const mark = (on: boolean) => on && <span aria-hidden className="absolute -left-3 top-1 bottom-1 w-[3px] rounded-r-full bg-brand" />

  const node = (b: BoxInfo, n: FolderNode, depth: number): React.ReactNode => {
    const key = b.id + ':' + n.path, closed = shut.has(key), on = !!n.label && here(b.id) && filter.label === n.label.id
    return (
      <li key={key}>
        <div className={row(on)} style={{ paddingLeft: 10 + depth * 14 }}>
          {mark(on)}
          {n.kids.length > 0
            ? <button className="-ml-1 rounded p-0.5 text-gray-500 hover:text-foreground" aria-label={(closed ? 'Open ' : 'Fold ') + n.name} aria-expanded={!closed} onClick={() => flip(shut, key, setShut, 'rpmail:tree:shut')}><ChevronRight className={cn('size-3.5 transition-transform', !closed && 'rotate-90')} /></button>
            : <span className="w-4 shrink-0" />}
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => n.label ? pick(b.id, { view: 'all', label: n.label.id }) : flip(shut, key, setShut, 'rpmail:tree:shut')} title={n.path}>{n.name}</button>
          <Count unread={n.label?.unread} total={n.label?.total} />
        </div>
        {!closed && n.kids.length > 0 && <ul>{n.kids.map(k => node(b, k, depth + 1))}</ul>}
      </li>
    )
  }
  const sys = (b: BoxInfo, v: Filter['view'], label: string, count?: { unread?: number; total?: number }) => {
    const on = here(b.id) && filter.view === v && !filter.label
    return <li key={v}><button className={row(on)} style={{ paddingLeft: 24 }} onClick={() => pick(b.id, { view: v })}>{mark(on)}<span className="min-w-0 flex-1 truncate">{label}</span>{count && <Count {...count} />}</button></li>
  }

  return (
    <aside className="dark rp-sidebar hidden md:flex print:hidden h-dvh w-64 shrink-0 flex-col border-r border-sidebar-border text-foreground">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <button onClick={() => showInMain('/dashboard')} aria-label="Go to RP Intelligence" title="Go to RP Intelligence" className="inline-block shrink-0 rounded-lg bg-white px-1.5 py-1 dark:ring-1 dark:ring-white/10">
          <Image src="/logo-full-v4.png" alt="RP Intelligence" width={220} height={100} priority className="h-11 w-auto" />
        </button>
        <span className="text-2xl font-bold uppercase tracking-wide text-foreground [font-family:var(--font-display)]">RPMail</span>
      </div>
      <div className="px-3 pb-2">
        <button className="flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-3 py-2.5 text-sm font-semibold text-[#1d1a12] shadow-sm transition hover:brightness-105 disabled:opacity-50" onClick={newMessage} disabled={!canWrite} title={writeTitle}><PenSquare className="size-4" />New message</button>
      </div>
      <nav aria-label="Mailboxes" className="flex-1 overflow-y-auto px-3 py-1">
        <button className={cn(row(view.kind === 'dash'), 'mb-2 !py-2 !text-sm font-semibold')} style={{ paddingLeft: 10 }} onClick={goDash}>
          {mark(view.kind === 'dash')}<LayoutDashboard className={cn('size-4 shrink-0', view.kind === 'dash' ? 'text-brand' : 'text-gray-400 group-hover:text-gold')} /><span className="flex-1">Dashboard</span>
          {needs > 0 && <span className="rounded-full bg-white/15 px-2 text-[11px] font-bold tabular-nums">{needs}</span>}
        </button>
        <ul className="space-y-2">
          {boxes.map(b => {
            const opened = open.has(b.id), labels = folders[b.id] ?? []
            return (
              <li key={b.id} onContextMenu={e => onBoxMenu(e, b)}>
                <div className={cn(row(here(b.id) && filter.view === 'inbox' && !filter.label), '!py-1.5')} style={{ paddingLeft: 4 }}>
                  {mark(here(b.id) && filter.view === 'inbox' && !filter.label)}
                  <button className="rounded p-0.5 text-gray-500 hover:text-foreground" aria-label={(opened ? 'Fold ' : 'Open ') + b.name} aria-expanded={opened} onClick={() => flip(open, b.id, setOpen, 'rpmail:tree:open')}><ChevronRight className={cn('size-3.5 transition-transform', opened && 'rotate-90')} /></button>
                  <button className="min-w-0 flex-1 text-left" onClick={() => pick(b.id, { view: 'inbox' })} title={b.address}>
                    <span className="flex items-center gap-2">
                      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', b.connected && !b.last_error ? 'bg-success' : 'bg-danger')} />
                      <span className={cn('truncate text-sm', b.unread ? 'font-bold text-foreground' : 'font-semibold')}>{b.name}</span>
                    </span>
                    <span className="block truncate pl-4 text-[11px] text-gray-500 font-mono">{b.connected ? b.address : 'Not connected'}</span>
                  </button>
                  {b.unread > 0 && <span className="shrink-0 rounded-full bg-white/15 px-2 text-[11px] font-bold tabular-nums text-foreground">{b.unread}</span>}
                </div>
                {opened && b.connected && (
                  <ul className="mt-0.5">
                    {sys(b, 'inbox', 'Inbox', { unread: b.unread, total: b.inbox })}
                    {sys(b, 'needs', 'Needs you', { total: b.needs })}
                    {folderTree(labels).map(n => node(b, n, 1))}
                    {sys(b, 'sent', 'Sent')}
                    {sys(b, 'drafts', 'Drafts')}
                    {sys(b, 'scheduled', 'Scheduled')}
                    {sys(b, 'snoozed', 'Snoozed')}
                    {sys(b, 'filed', 'Filed')}
                    {sys(b, 'all', 'All mail')}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
        <ThemeToggle className="w-full" />
        <button className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm font-medium text-gray-600 transition-colors hover:bg-sidebar-accent hover:text-foreground" onClick={() => showInMain('/dashboard')}>
          <ExternalLink className="size-[18px] shrink-0 text-gray-400 group-hover:text-gold" strokeWidth={1.9} />Back to RP Intelligence
        </button>
      </div>
    </aside>
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
          <span className="rounded-lg p-2 rp-icon-navy"><Mail className="size-6" /></span>
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
  const win = useContext(Win)
  return (
    <div className="rp-card p-6 max-w-xl space-y-3">
      <h2 className="font-semibold text-foreground">Connect {box.address}</h2>
      <p className="text-sm text-muted-foreground">Sign in with Google as <b className="text-foreground">{box.address}</b>. Google asks you to allow RP Intelligence to read, file and send mail for that mailbox. It cannot permanently delete anything.</p>
      {box.kind === 'shared' && <p className="text-sm text-muted-foreground">This is a shared mailbox. It only needs signing in once, by anyone who has its Google sign-in.</p>}
      <p className="text-xs text-muted-foreground">Google will show a &ldquo;Google hasn&rsquo;t verified this app&rdquo; page the first time. Choose Advanced, then &ldquo;Go to RP Intelligence&rdquo;. That page appears because this is a private company tool.</p>
      {st.googleReady
        ? <a className={btn('default', 'default')} href={connectHref(box.id, win)}>Sign in with Google</a>
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
      className={cn('flex gap-2 px-3 border-b border-hairline cursor-pointer hover:bg-raised', compact ? 'py-1' : 'py-2', selected && 'bg-primary/10', m.unread && 'shadow-[inset_3px_0_0_var(--info)]', bold ? 'text-foreground' : 'text-muted-foreground')}>
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
      {onDone && <button title="Done: take it off my lists" className={DONE_BTN} onClick={e => { e.stopPropagation(); onDone() }}><Check />Done</button>}
    </div>
  )
}

function Section({ id, title, count, tone, children, right }: { id?: string; title: string; count?: number; tone?: Hue; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={id} className="rp-card overflow-hidden scroll-mt-4">
      <div className={cn('rp-card-head', tone && 'rp-accent')} data-tone={tone}><h2 className="rp-card-title">{title}{count !== undefined && <span className={cn('ml-2 tabular-nums', tone && count ? HUE_TEXT[tone] : 'text-muted-foreground')}>{count}</span>}</h2>{right}</div>
      {children}
    </section>
  )
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-4 py-5 text-sm text-muted-foreground">{children}</p>

// Color by meaning (Trae, 11/24/26): red = hot, amber = waiting, green = done, blue = information.
type Hue = 'info' | 'warning' | 'danger' | 'success'
const HUE_TEXT: Record<Hue, string> = { info: 'text-info', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }
const HUE_TOP: Record<Hue, string> = { info: 'border-t-info', warning: 'border-t-warning', danger: 'border-t-danger', success: 'border-t-success' }

/**
 * One dashboard block, laid out like Trae's own RPMail (11/25/26): a status dot and the name in capitals, a read-only tag,
 * big numbers with small capital labels, and a line at the bottom. Every block can be dragged to a new place or closed.
 */
function Tile({ title, sub, mono, pill, dot, nums, foot, footTone, bold, tone = 'info', onClick, onMenu, onClose }: {
  title: string; sub: string; mono?: boolean; pill?: string; dot?: 'ok' | 'bad'; nums: [number | string, string, Hue?][]; foot: string; footTone?: Hue; bold?: boolean; tone?: Hue
  onClick: () => void; onMenu?: (e: React.MouseEvent) => void; onClose?: () => void }) {
  const stop = (fn: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn(e) }
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter') onClick() }} onContextMenu={onMenu}
      className={cn('rp-card rp-card-link relative flex h-full cursor-pointer flex-col p-4 text-left border-t-[3px]', HUE_TOP[tone])}>
      <span className="absolute right-1.5 top-1.5 flex items-center opacity-60 transition-opacity group-hover/tile:opacity-100 focus-within:opacity-100">
        {onMenu && <button aria-label={'Options for ' + title} title="Options (or right-click)" className="rounded p-1 text-muted-foreground hover:bg-raised hover:text-foreground" onClick={stop(onMenu)}><MoreVertical className="size-4" /></button>}
        {onClose && <button aria-label={'Close ' + title} title="Close this block (put it back from the bottom of the dashboard)" className="rounded p-1 text-muted-foreground hover:bg-raised hover:text-foreground" onClick={stop(() => onClose())}><X className="size-4" /></button>}
      </span>
      <div className="flex items-center gap-2 pr-14">
        {dot && <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot === 'ok' ? 'bg-success' : 'bg-danger')} />}
        <span className="rp-card-title !text-[1.1rem] leading-tight">{title}</span>
      </div>
      {pill && <span className="mt-1.5 self-start rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-border">{pill}</span>}
      <div className={cn('mt-1 truncate text-xs text-muted-foreground', mono && 'font-mono')}>{sub}</div>
      {/* The numbers sit side by side; each label wraps word by word under its number ("need / you"), as in Trae's own RPMail. */}
      <div className={cn('mt-3 flex', nums.length > 3 ? 'gap-x-3' : 'gap-x-5')}>
        {nums.map(([n, l, h]) => <div key={l} className="w-min min-w-[2.25rem]"><div className={cn('rp-stat-value text-[1.8rem] leading-none', h && n !== 0 && n !== '-' && HUE_TEXT[h])}>{n}</div><div className="mt-1 text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">{l}</div></div>)}
      </div>
      <div className={cn('mt-auto pt-3 text-xs', footTone ? HUE_TEXT[footTone] : bold ? 'font-bold text-foreground' : 'text-muted-foreground')}>
        <div className="border-t border-hairline pt-2 line-clamp-2">{foot}</div>
      </div>
    </div>
  )
}

/** The blocks on the dashboard that are not mailboxes, and their names for the "closed" list. */
const TILE_NAMES: Record<string, string> = { plate: 'My Plate', jobs: 'Your jobs', needs: 'Needs you', summary: 'Daily summary' }
const TILE_DRAG = 'text/x-rpmail-tile'
const clock = (ms: number | null) => ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''

function Dash({ ov, boxes, hidden, order, reorder, close, onBoxMenu, putBack, boxName, rowProps, goBox, markDone, plateDone, undo }: { ov: Overview; boxes: BoxInfo[]; hidden: Set<string>
  /** The person's own order of the blocks (mailbox ids and the names in TILE_NAMES); dragging a block saves a new one. */
  order: string[]; reorder: (order: string[]) => void; close: (key: string) => void
  onBoxMenu: (e: React.MouseEvent, b: BoxInfo) => void; putBack: (id: string) => void
  boxName: (id: string) => string; rowProps: RowProps; goBox: (id: string) => void
  markDone: (it: { mailbox_id: string; id: string }, on?: boolean) => void; plateDone: (t: PlateItem) => void; undo: (id: number) => void }) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  const P = ov.plate.items, open = P.filter(t => t.status === 'open')
  const waitingJobs = ov.foryou.filter(m => m.waiting).length
  const s = ov.summary?.data
  // Mailboxes the person left out of their own lists (RPMail → Settings → Mailboxes in my lists).
  const offCount = (ov.prefs?.lists_off ?? []).filter(id => ov.boxes.some(b => b.id === id)).length
  const leftOut = offCount > 0 ? <Link href="/rpmail/settings" className="text-xs text-muted-foreground hover:text-foreground">Leaving out {offCount} mailbox{offCount === 1 ? '' : 'es'} · Change</Link> : undefined
  const many = ov.boxes.length > 1
  const [dragging, setDragging] = useState('')
  const [over, setOver] = useState('')
  const sinceYesterday = s ? s.boxes.reduce((n, b) => n + b.received, 0) : 0
  const tiles: { key: string; name: string; el: React.ReactNode }[] = [
    ...boxes.map(b => {
      const ok = b.connected && !b.last_error
      return { key: b.id, name: b.name, el: (
        <Tile title={b.name} sub={b.address} mono pill={b.connected && !b.can_send ? 'read-only' : undefined} dot={ok ? 'ok' : 'bad'} bold={b.unread > 0} tone={ok ? 'info' : 'danger'}
          onClick={() => goBox(b.id)} onMenu={e => onBoxMenu(e, b)} onClose={() => close(b.id)}
          nums={[[b.connected ? b.unread : 0, 'unread', 'info'], [b.connected ? b.needs : 0, 'need you', 'warning'], [b.connected ? b.inbox : 0, 'in inbox']]}
          footTone={!b.connected || b.last_error ? 'danger' : undefined}
          foot={!b.connected ? 'Not connected. Click to connect.' : b.last_error ? b.last_error : b.loading ? `Loading mail: ${b.loading.total - b.loading.left} of ${b.loading.total}` : (b.newest ? 'Newest ' + clock(b.newest) + ' · ' : '') + 'synced ' + ago(b.last_sync_at)} />
      ) }
    }),
    { key: 'plate', name: TILE_NAMES.plate, el: <Tile title="My Plate" sub="Your tasks from RP Intelligence" tone="success" onClick={() => go('rp-plate')} onClose={() => close('plate')}
        nums={[[open.length, 'to do', 'info'], [P.length - open.length, 'waiting', 'warning'], [P.filter(t => t.priority === 1).length, 'hot', 'danger']]} foot={open[0] ? 'Next: ' + open[0].title : P[0]?.title ?? 'Nothing on your plate.'} /> },
    { key: 'jobs', name: TILE_NAMES.jobs, el: <Tile title="Your jobs" sub="Mail tied to your work" bold={waitingJobs > 0} tone="info" onClick={() => go('rp-jobs')} onClose={() => close('jobs')}
        nums={[[waitingJobs, 'waiting on a reply', 'warning'], [ov.foryou.length, 'last 14 days', 'info']]}
        foot={ov.foryou[0] ? 'Newest: ' + (ov.foryou[0].from_name || ov.foryou[0].from_addr) + ' · ' + when(ov.foryou[0].date) : 'Nothing right now.'} /> },
    { key: 'needs', name: TILE_NAMES.needs, el: <Tile title="Needs you" sub="Mail waiting on a reply from you" bold={ov.needs.length > 0} tone="warning" onClick={() => go('rp-needs')} onClose={() => close('needs')}
        nums={[[ov.needs.length, 'waiting', 'warning'], [ov.needs.filter(m => m.unread).length, 'unread', 'info']]}
        foot={ov.needs[0] ? 'Newest: ' + (ov.needs[0].from_name || ov.needs[0].from_addr) + ' · ' + when(ov.needs[0].date) : 'Nothing waiting on you.'} /> },
    { key: 'summary', name: TILE_NAMES.summary, el: <Tile title="Daily summary" sub={ov.summary ? ov.summary.day : 'Made each morning after 6'} tone="info" onClick={() => go('rp-sum')} onClose={() => close('summary')}
        nums={[[s ? s.needs.length : 0, 'to reply', 'warning'], [s ? s.stale.length : 0, 'over 2 days', 'danger'], [s ? s.permits.length : 0, 'permits', 'info'], [s ? s.pos.length : 0, 'POs', 'success']]}
        foot={s ? `${sinceYesterday} received since yesterday` : 'Not made yet.'} /> },
  ]
  // Blocks in the person's order; any they have not placed keep their usual spot after those.
  const place = (k: string, i: number) => { const n = order.indexOf(k); return n < 0 ? 1000 + i : n }
  const all = tiles.map((t, i) => ({ t, i })).sort((a, b) => place(a.t.key, a.i) - place(b.t.key, b.i)).map(x => x.t)
  const shown = all.filter(t => !hidden.has(t.key))
  const closed = all.filter(t => hidden.has(t.key))
  const drop = (onto: string) => {
    const from = dragging
    setDragging(''); setOver('')
    if (!from || from === onto) return
    const keys = all.map(t => t.key).filter(k => k !== from)
    keys.splice(keys.indexOf(onto), 0, from)
    reorder(keys)
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(205px,1fr))]">
        {shown.map(t => (
          <div key={t.key} draggable className={cn('group/tile rounded-xl transition-shadow', dragging === t.key && 'opacity-50', over === t.key && dragging !== t.key && 'ring-2 ring-primary')}
            title="Drag to move this block"
            onDragStart={e => { e.dataTransfer.setData(TILE_DRAG, t.key); e.dataTransfer.effectAllowed = 'move'; setDragging(t.key) }}
            onDragEnd={() => { setDragging(''); setOver('') }}
            onDragOver={e => { if (e.dataTransfer.types.includes(TILE_DRAG)) { e.preventDefault(); if (over !== t.key) setOver(t.key) } }}
            onDragLeave={() => { if (over === t.key) setOver('') }}
            onDrop={e => { if (e.dataTransfer.types.includes(TILE_DRAG)) { e.preventDefault(); drop(t.key) } }}>
            {t.el}
          </div>
        ))}
      </div>
      {closed.length > 0 && (
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">Closed blocks:
          {closed.map(t => <button key={t.key} className="rp-chip" onClick={() => putBack(t.key)} title="Put it back on the dashboard">{t.name} · put back</button>)}
        </p>
      )}

      <h2 className="rp-title !text-[1.75rem] border-b-2 border-foreground/70 pb-2 pt-3">Dashboard</h2>

      <Section id="rp-plate" title="My Plate" count={P.length} tone="success" right={<Link href="/my" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">Open My Plate <ExternalLink className="size-3" /></Link>}>
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
            <button className={DONE_BTN} title="Done: take it off My Plate" onClick={() => plateDone(t)}><Check />Done</button>
          </div>
        ))}
      </Section>

      <Section id="rp-jobs" title="Your jobs" count={ov.foryou.length} tone="info" right={leftOut}>
        {!ov.foryou.length && <Empty>No mail about your jobs in the last 14 days.</Empty>}
        {ov.foryou.map(m => <Row key={m.mailbox_id + m.id} m={m} boxLabel={many ? boxName(m.mailbox_id) : undefined} onDone={() => markDone(m)} {...rowProps} />)}
      </Section>

      <Section id="rp-needs" title="Needs you" count={ov.needs.length} tone="warning" right={leftOut}>
        {!ov.needs.length && <Empty>Nothing is waiting on you.</Empty>}
        {ov.needs.map(m => <Row key={m.mailbox_id + m.id} m={m} boxLabel={many ? boxName(m.mailbox_id) : undefined} onDone={() => markDone(m)} {...rowProps} />)}
      </Section>

      <Section id="rp-sum" title="Daily summary" tone="info" right={ov.summary && <span className="text-xs text-muted-foreground">Since {new Date(ov.summary.data.since).toLocaleString('en-US', { weekday: 'short', hour: 'numeric' })}</span>}>
        {!s && <Empty>Your first summary is made the first time you open RPMail after 6 in the morning, once your mail has loaded.</Empty>}
        {s && (
          <div className="p-4 grid gap-4 md:grid-cols-2">
            <SumList tone="warning" title="New and needs a reply" items={s.needs} empty="Nothing new is waiting on you." rowProps={rowProps} markDone={markDone} />
            <SumList tone="warning" title="Still waiting (older than 2 days)" items={s.stale} empty="Nothing older is waiting." rowProps={rowProps} markDone={markDone} />
            <SumList tone="danger" title="Deadlines mentioned" items={s.deadlines} empty="No deadlines mentioned." rowProps={rowProps} markDone={markDone} />
            <SumList tone="info" title="Permits" items={s.permits} empty="No permit mail." rowProps={rowProps} markDone={markDone} />
            <SumList tone="success" title="PO numbers" items={s.pos} empty="No PO numbers." rowProps={rowProps} markDone={markDone} />
            {s.boxes.map(b => <SumList key={b.id} tone="info" title={`${b.name}: ${b.received} received`} items={b.items} more={b.more} empty="Nothing from people." rowProps={rowProps} markDone={markDone} />)}
          </div>
        )}
      </Section>

      <DoneSection boxName={many ? boxName : undefined} rowProps={rowProps} putBack={m => markDone(m, false)} stamp={ov.now} />

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

function SumList({ title, items, empty, more, tone, rowProps, markDone }: { title: string; items: SumItem[]; empty: string; more?: number; tone?: Hue; rowProps: RowProps; markDone: (it: { mailbox_id: string; id: string }) => void }) {
  return (
    <div>
      <h3 className={cn('rp-label mb-1.5', tone && HUE_TEXT[tone])}>{title}</h3>
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

type Sched = { id: number; mailbox_id: string; draft_id: string; to: string; subject: string; send_at: number; status: 'waiting' | 'sending' | 'sent' | 'failed' | 'cancelled'; sent_at: number | null; error: string | null }

/**
 * The messages this person scheduled in one mailbox: what goes out when, and what went out, failed or was stopped in the
 * last three days. Send now and Cancel ask first; Edit opens the waiting draft (sending, saving or scheduling it again
 * there replaces the schedule).
 */
function ScheduledList({ box, openDraft, say, stamp }: { box: BoxInfo; openDraft: (draftId: string) => void; say: (text: string) => void; stamp?: unknown }) {
  const [rows, setRows] = useState<Sched[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [ask, asking] = useAsk()
  const load = useCallback(() => api<{ scheduled: Sched[] }>('scheduled', undefined, { mailbox: box.id }).then(r => { setRows(r.scheduled); setErr('') }).catch(e => setErr((e as Error).message)), [box.id])
  // Loads again every 30 seconds, and whenever the page reloads its lists (after something was scheduled, for one).
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30_000); return () => clearInterval(t) }, [load, stamp])
  const run = async (s: Sched, what: 'now' | 'cancel') => {
    const name = s.subject || '(no subject)'
    const ok = await ask(what === 'now' ? { text: `Send "${name}" to ${s.to || 'nobody'} now?`, yes: 'Send now' } : { text: `Stop "${name}" from going out? It stays in Drafts, to finish or delete there.`, yes: s.status === 'failed' ? 'Take it off this list' : 'Stop it' })
    if (!ok) return
    setBusy(s.id); setErr('')
    try {
      if (what === 'now') { const r = await api<{ to: string }>('schedule_now', { id: s.id, confirmed: true }); say(`Sent to ${r.to}.`) }
      else { await api('schedule_cancel', { id: s.id }); say(s.status === 'failed' ? 'Taken off the list. It is still in Drafts.' : 'Stopped. It is still in Drafts.') }
    } catch (e) { setErr((e as Error).message) }
    setBusy(null); void load()
  }
  const line = (s: Sched) => s.status === 'waiting' ? <>Goes out <b className="text-foreground">{whenText(s.send_at)}</b></>
    : s.status === 'sending' ? 'Sending now...'
    : s.status === 'sent' ? <span className="text-success">Sent {whenText(s.sent_at ?? s.send_at)}</span>
    : s.status === 'cancelled' ? 'Stopped. It is in Drafts.'
    : <span className="text-danger">Not sent: {s.error || 'something stopped it.'} It is still in Drafts.</span>
  return (
    <div>
      {asking}
      {err && <p className="m-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {rows === null && !err && <Empty>Loading...</Empty>}
      {rows && !rows.length && <Empty>Nothing is scheduled here. Write a message, press Schedule and pick a time. It waits in Drafts and goes out then.</Empty>}
      {rows?.map(s => (
        <div key={s.id} className="px-3 py-2.5 border-b border-hairline">
          <p className="text-sm font-medium text-foreground truncate"><Clock className="inline size-3.5 text-muted-foreground mr-1" />{s.subject || '(no subject)'}</p>
          <p className="text-xs text-muted-foreground truncate">To {s.to || '(nobody)'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{line(s)}</p>
          {(s.status === 'waiting' || s.status === 'failed') && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button className={btn('outline', 'xs')} disabled={busy === s.id || !box.can_send} onClick={() => void run(s, 'now')}><Send />Send now</button>
              <button className={btn('ghost', 'xs')} disabled={busy === s.id} onClick={() => openDraft(s.draft_id)}>Edit</button>
              <button className={btn('ghost', 'xs')} disabled={busy === s.id} onClick={() => void run(s, 'cancel')}><X />{s.status === 'failed' ? 'Take off the list' : 'Stop it'}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function BoxView({ box, filter, setFilter, list, sel, msg, msgErr, peek, rowProps, reload, bulk, close, search, actions, editSig, disconnect, labels, canEdit, openOrganize, makeLabel, canSend, openDraft, say }: {
  box: BoxInfo; filter: Filter; setFilter: (f: Filter) => void; list: Item[] | null; sel: { mailbox: string; id: string } | null; msg: Full | null; msgErr: string; peek: Item | null
  rowProps: RowProps; reload: () => void; bulk: (ids: string[], action: BulkAction, extra?: { label: string; move: boolean }) => void; close: () => void; search: () => void; actions: Actions; editSig: () => void; disconnect?: () => void
  labels: Label[]; canEdit: boolean; openOrganize: (ruleFrom?: string) => void; makeLabel: (name: string) => Promise<Label | null>; canSend: boolean
  openDraft: (draftId: string) => void; say: (text: string) => void }) {
  const views: [Filter['view'], string][] = [['inbox', 'Inbox'], ['needs', 'Needs you'], ['sent', 'Sent'], ['drafts', 'Drafts'], ['scheduled', 'Scheduled'], ['filed', 'Filed'], ['snoozed', 'Snoozed'], ['all', 'All']]
  const win = useContext(Win)
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
      <div className="rp-card-head rp-accent" data-tone="info">
        <div className="min-w-0">
          <h2 className="rp-card-title truncate">{box.name}</h2>
          <p className="text-xs text-muted-foreground truncate">{box.address} · {box.loading ? `loading mail: ${box.loading.total - box.loading.left} of ${box.loading.total}` : 'checked ' + ago(box.last_sync_at)}{box.crew_reads ? ' · the crew reads this mailbox: no pricing' : ''}{!box.can_send ? ' · you can read here, not send or delete' : !box.can_delete ? ' · you can read and send here, not delete' : ''}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className={btn('ghost', 'xs')} onClick={() => openOrganize()} title="Labels, rules for new mail, and blocked senders"><Tags />Labels and rules</button>
          <button className={btn('ghost', 'xs')} onClick={editSig}><Signature />Signature</button>
          <a className={cn(btn('ghost', 'xs'), '!text-xs !font-medium')} href={connectHref(box.id, win)} title="Use this if mail has stopped arriving or Google asks for permission again">Sign in again</a>
          {disconnect && <button className={btn('ghost', 'xs')} onClick={disconnect}><Unplug />Sign out</button>}
        </div>
      </div>
      {box.last_error && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-hairline bg-warning-soft text-sm text-warning">
          <span className="min-w-0 flex-1">Mail is not arriving for this mailbox: {box.last_error}</span>
          <a className={btn('default', 'xs')} href={connectHref(box.id, win)}>Sign in again</a>
        </div>
      )}
      {/* On a phone the filters step aside while a conversation is open, so reading starts at the top of the screen. */}
      <div className={cn('flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-hairline', sel && 'hidden lg:flex')}>
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
        <form className={cn('flex flex-wrap items-center gap-2 px-3 py-2 border-b border-hairline text-xs text-muted-foreground', sel && 'hidden lg:flex')} onSubmit={e => { e.preventDefault(); reload() }}>
          <label className="inline-flex items-center gap-1.5">From <input className="rp-input !w-44" placeholder="name or address" value={filter.from ?? ''} onChange={e => setFilter({ ...filter, from: e.target.value })} /></label>
          <label className="inline-flex items-center gap-1.5">On or after <input type="date" className="rp-input !w-auto" value={filter.after ?? ''} onChange={e => setFilter({ ...filter, after: e.target.value })} /></label>
          <label className="inline-flex items-center gap-1.5">On or before <input type="date" className="rp-input !w-auto" value={filter.before ?? ''} onChange={e => setFilter({ ...filter, before: e.target.value })} /></label>
          <button className={btn('outline', 'xs')} type="submit">Apply</button>
          {narrowed && <button className={btn('ghost', 'xs')} type="button" onClick={() => { setFilter({ ...filter, from: '', after: '', before: '' }); setTimeout(reload, 0) }}>Clear</button>}
          <span>Covers the mail RPMail has loaded (the inbox and the last 90 days). Days are counted in your time zone.</span>
        </form>
      )}
      {labels.length > 0 && (
        // In the mail window the folders are in the menu on the left, so this row only shows where that menu is not (phones).
        <div className={cn('flex items-center gap-1.5 px-3 py-2 border-b border-hairline overflow-x-auto', sel && 'hidden lg:flex', win && 'md:!hidden')}>
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
          {filter.view === 'scheduled' && <ScheduledList box={box} openDraft={openDraft} say={say} stamp={list} />}
          {list && list.length > 0 && filter.view !== 'needs' && filter.view !== 'drafts' && (
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
          {list && !list.length && filter.view !== 'scheduled' && <Empty>{box.loading ? 'Your mail is still loading. This fills in as it arrives.' : filter.view === 'drafts' ? 'No drafts. A message saved with Save to Gmail Drafts (here or in Gmail) shows here, to open and finish.' : filter.view === 'snoozed' ? 'Nothing is snoozed. Snooze a message to take it off your lists until a time you pick.' : 'Nothing here.'}</Empty>}
          {list?.map(m => <Row key={m.id} m={m} selected={sel?.id === m.id} pick={filter.view !== 'needs' && filter.view !== 'drafts' ? { on: picked.has(m.id), toggle: () => toggle(m.id) } : undefined} labelNames={labelNames} drag={labels.length > 0 && filter.view !== 'drafts'} {...rowProps} />)}
        </div>
        <div className={cn('lg:max-h-[78vh] overflow-y-auto', !sel && 'hidden lg:block')}>
          {!sel && <Empty>Pick a message to read it. Opening a message does not mark it read.</Empty>}
          {sel && !msg && (peek && !msgErr
            // While the message comes from Gmail, what the list already knows is shown, so the screen does not sit empty.
            ? <div className="px-4 py-3" aria-busy="true">
                <button className={cn(btn('ghost', 'xs'), 'lg:hidden mb-2')} onClick={close}><ArrowLeft />Back to the list</button>
                <h3 className="text-base font-semibold text-foreground">{peek.subject || '(no subject)'}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground"><span className="font-medium text-foreground">{peek.from_name || peek.from_addr}</span> · {when(peek.date)}</p>
                <p className="mt-3 text-sm text-muted-foreground">{peek.snippet}</p>
                <p className="mt-3 text-xs text-muted-foreground" role="status">Opening the whole conversation...</p>
              </div>
            : <Empty>{msgErr || 'Opening...'}</Empty>)}
          {sel && msg && <Reader key={msg.id} m={msg} close={close} actions={actions} labels={labels} canEdit={canEdit} makeLabel={makeLabel} makeRule={openOrganize} canSend={canSend} canDelete={box.can_delete} />}
        </div>
      </div>
    </div>
  )
}

/**
 * One conversation: every message in it stacked, oldest first. The message that was picked is open; the others are one
 * line each until pressed, and their text is only fetched from Gmail then. The buttons at the top act on the whole
 * conversation; Reply, Reply all, Forward and Print sit on each message.
 */
function Reader({ m, close, actions, labels, canEdit, makeLabel, makeRule, canSend, canDelete }: { m: Full; close: () => void; actions: Actions; labels: Label[]; canEdit: boolean; makeLabel: (name: string) => Promise<Label | null>; makeRule: (from: string) => void
  /** May this person send from any of their mailboxes, and may they delete in this one? An owner can switch either off for a shared mailbox. */
  canSend: boolean; canDelete: boolean }) {
  const [whenFor, setWhenFor] = useState<'snooze' | 'remind' | null>(null)
  const [picker, setPicker] = useState(false)
  const stack = useMemo(() => buildStack(m, m.thread), [m])
  // The reader is keyed by the message that was picked, so all of this starts again for each conversation.
  const [open, setOpen] = useState(() => new Set(startOpen(m.id, m.thread)))
  const [got, setGot] = useState<Record<string, Full | { error: string }>>({})
  const [all, setAll] = useState(false)
  const asked = useRef(new Set<string>())
  // Three at a time at most, so "Open all" on a long conversation does not hit Gmail with everything at once.
  const lanes = useRef<Promise<void>[]>([Promise.resolve(), Promise.resolve(), Promise.resolve()])
  const turn = useRef(0)
  const load = useCallback((id: string) => {
    const lane = turn.current++ % 3
    lanes.current[lane] = lanes.current[lane].then(() => api<Full>('message', undefined, { mailbox: m.mailbox_id, id })
      .then(f => setGot(g => ({ ...g, [id]: f })), e => setGot(g => ({ ...g, [id]: { error: (e as Error).message } }))))
  }, [m.mailbox_id])
  useEffect(() => { for (const id of open) if (id !== m.id && !asked.current.has(id)) { asked.current.add(id); load(id) } }, [open, m.id, load])
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const retry = (id: string) => { setGot(g => { const n = { ...g }; delete n[id]; return n }); load(id) }
  const { shown, hidden } = shownOf(stack, open, all)
  const many = stack.length > 1
  const anyUnread = m.unread || m.thread.some(t => t.unread)
  const allOpen = stack.every(t => open.has(t.id))
  const it = { mailbox_id: m.mailbox_id, id: m.id }
  return (
    <div>
      <div className="px-4 py-3 border-b border-hairline">
        <button className={cn(btn('ghost', 'xs'), 'lg:hidden mb-2')} onClick={close}><ArrowLeft />Back to the list</button>
        <h3 className={cn('text-base text-foreground', anyUnread ? 'font-bold' : 'font-semibold')}>{m.subject || '(no subject)'}</h3>
        {many && (
          <p className="mt-0.5 text-xs text-muted-foreground">{stack.length} messages in this conversation, oldest first ·{' '}
            <button className="underline" onClick={() => { if (allOpen) setOpen(new Set([m.id])); else { setAll(true); setOpen(new Set(stack.map(t => t.id))) } }}>{allOpen ? 'Fold all but one' : 'Open all'}</button>
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {m.in_inbox
            ? <button className={btn()} onClick={() => actions.fileTo(it, 'Archive')}><Archive />Archive</button>
            : <button className={btn()} onClick={() => actions.fileTo(it, 'Inbox')}><Inbox />Move to inbox</button>}
          {canDelete && <>
            <button className={btn()} onClick={() => actions.fileTo(it, 'Spam')}><ShieldAlert />Spam</button>
            <button className={btn('destructive')} onClick={() => actions.fileTo(it, 'Trash')}><Trash2 />Delete</button>
          </>}
          <button className={btn('ghost')} onClick={() => actions.markRead(it, !anyUnread)}><MailOpen />{anyUnread ? 'Mark read' : 'Mark unread'}</button>
          <button className={btn('ghost')} onClick={() => actions.markDone(it, !m.done)}><Check />{m.done ? 'Not done' : 'Done'}</button>
          <button className={btn('ghost')} onClick={() => actions.plateAdd(it)}><ListPlus />Add to My Plate</button>
          <button className={btn('ghost')} onClick={() => actions.star(it, !m.starred)}><Star className={cn(m.starred && 'fill-warning text-warning')} />{m.starred ? 'Starred' : 'Star'}</button>
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
      {hidden > 0 && <button className="block w-full border-b border-hairline px-4 py-2 text-left text-xs text-muted-foreground hover:bg-raised" onClick={() => setAll(true)}>Show {hidden} earlier message{hidden === 1 ? '' : 's'}</button>}
      {shown.map(t => {
        const f = t.id === m.id ? m : got[t.id]
        if (open.has(t.id) && f && !('error' in f)) return <MessageCard key={t.id} f={f} many={many} fold={() => toggle(t.id)} canSend={canSend} actions={actions} />
        return (
          <div key={t.id} className="border-b border-hairline">
            <button className="flex w-full items-baseline gap-2 px-4 py-2 text-left text-sm hover:bg-raised" onClick={() => toggle(t.id)} aria-expanded={open.has(t.id)}>
              <span className={cn('max-w-[45%] shrink-0 truncate text-foreground', t.unread ? 'font-bold' : 'font-medium')}>{t.from_name || t.from_addr}</span>
              {t.sent && <span className="rp-pill shrink-0 !py-0 text-[11px]">Sent</span>}
              <span className={cn('min-w-0 flex-1 truncate', t.unread ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{t.snippet}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{when(t.date)}</span>
            </button>
            {open.has(t.id) && !f && <p className="px-4 pb-2 text-xs text-muted-foreground" role="status">Opening...</p>}
            {open.has(t.id) && f && 'error' in f && <p className="px-4 pb-2 text-xs text-danger">Could not open this one: {f.error} <button className="underline" onClick={() => retry(t.id)}>Try again</button></p>}
          </div>
        )
      })}
    </div>
  )
}

/** One message, open: who and when, its own Reply / Forward / Print, attachments, and the text in its locked frame. */
function MessageCard({ f, many, fold, canSend, actions }: { f: Full; many: boolean; fold: () => void; canSend: boolean; actions: Actions }) {
  const [imgs, setImgs] = useState(false)       // pictures from the internet stay hidden until asked for, per message
  const [quoted, setQuoted] = useState(false)   // the mail a reply was answering stays folded: it is already in the stack above
  const [tall, setTall] = useState(false)
  const [zip, setZip] = useState('')
  const [screen] = useState(() => typeof window === 'undefined' ? { narrow: false, h: 800 } : { narrow: window.innerWidth < 640, h: window.innerHeight })
  const files = f.attachments.filter(a => !a.inline)
  // Every attachment in one zip file. The files are fetched the same way as opening them one at a time, then packed here in the browser.
  const zipAll = async () => {
    setZip('Getting the files…')
    try {
      const packed: { name: string; data: Uint8Array }[] = []
      for (const a of files) {
        const r = await fetch(`/api/rpmail/attachment?mailbox=${f.mailbox_id}&id=${f.id}&i=${a.i}&download=1`)
        if (!r.ok) throw new Error(a.name)
        packed.push({ name: a.name, data: new Uint8Array(await r.arrayBuffer()) })
      }
      const url = URL.createObjectURL(new Blob([makeZip(packed).buffer as ArrayBuffer], { type: 'application/zip' }))
      const link = document.createElement('a')
      link.href = url; link.download = (f.subject || 'attachments').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 80) + '.zip'
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setZip('')
    } catch (e) { setZip(`Could not get ${(e as Error).message}. Download the files one at a time.`) }
  }
  const canHide = many && !isForward(f.subject, f.text)
  const split = canHide ? splitPlainQuote(f.text) : null
  const htmlQuote = !!f.html && canHide && htmlHasQuote(f.html)
  const hiding = !quoted && (f.html ? htmlQuote : !!split)
  const hasRemote = !!f.html && wantsRemotePictures(f.html)
  const doc = useMemo(() => f.html ? messageDoc(f.html, { pictures: imgs, hideQuoted: htmlQuote && !quoted }) : '', [f.html, imgs, htmlQuote, quoted])
  // The frame cannot report its own height (nothing in it may run), so the height is worked out from the words that will show.
  const sizing = useMemo(() => f.html ? { text: shownText(f.html, htmlQuote && !quoted), pics: ownPictures(f.html) } : { text: '', pics: 0 }, [f.html, htmlQuote, quoted])
  const frame = frameHeight(sizing.text, { narrow: screen.narrow, pictures: imgs && hasRemote, ownPictures: sizing.pics, max: Math.round(screen.h * (tall ? 0.85 : 0.6)) })
  const att = (i: number, dl = false) => `/api/rpmail/attachment?mailbox=${f.mailbox_id}&id=${f.id}&i=${i}${dl ? '&download=1' : ''}`
  const head = <>
    <p className="text-sm text-muted-foreground"><span className={cn('text-foreground', f.unread ? 'font-bold' : 'font-medium')}>{f.from_name}</span> &lt;{f.from_addr}&gt; · {new Date(f.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
    <p className="text-xs text-muted-foreground truncate">To: {f.to_full || f.to_addrs}{f.cc_full ? ' · Cc: ' + f.cc_full : ''}</p>
  </>
  return (
    <div className="border-b border-hairline">
      {many
        ? <button className="block w-full px-4 pt-3 text-left hover:bg-raised" onClick={fold} aria-expanded title="Fold this message away">{head}</button>
        : <div className="px-4 pt-3">{head}</div>}
      <div className="px-4 pt-2 pb-2.5 flex flex-wrap gap-1.5">
        {canSend && <>
          <button className={btn('default')} onClick={() => actions.reply(f, false, false)}><Reply />Reply</button>
          <button className={btn()} onClick={() => actions.reply(f, true, false)}><ReplyAll />Reply all</button>
          <button className={btn()} onClick={() => actions.reply(f, false, true)}><Forward />Forward</button>
        </>}
        <button className={btn('ghost')} onClick={() => printMessage(f)}><Printer />Print</button>
      </div>
      {f.attachments.length > 0 && (
        <div className="px-4 py-2 border-t border-hairline flex flex-wrap gap-1.5">
          {f.attachments.map(a => (
            <span key={a.i} className="rp-pill !py-1.5">
              <Paperclip className="size-3" /><a className="hover:underline" href={att(a.i)} target="_blank" rel="noopener noreferrer">{a.name}</a>
              <span className="text-muted-foreground">{size(a.size)}</span><a href={att(a.i, true)} title="Download"><Download className="size-3" /></a>
            </span>
          ))}
          {files.length > 1 && <button className={btn('ghost', 'xs')} onClick={() => void zipAll()} disabled={zip === 'Getting the files…'}><FileArchive />Download all as a zip</button>}
          {zip && <span className="self-center text-xs text-muted-foreground" role="status">{zip}</span>}
        </div>
      )}
      {hasRemote && !imgs && <div className="px-4 py-1.5 border-t border-hairline text-xs text-muted-foreground flex items-center gap-2"><ImageIcon className="size-3.5" />Pictures from the internet are hidden. <button className="underline" onClick={() => setImgs(true)}>Show pictures</button></div>}
      {f.html
        ? <iframe title={'Message from ' + f.from_name} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: frame.px }} className="w-full resize-y border-t border-hairline bg-white" />
        : <pre className="px-4 py-3 border-t border-hairline whitespace-pre-wrap break-words text-sm text-foreground font-sans">{(hiding && split ? split.top : f.text) || '(no text)'}</pre>}
      {(htmlQuote || split || (f.html && frame.capped) || tall) && (
        <p className="flex flex-wrap gap-x-4 px-4 py-1.5 text-xs text-muted-foreground">
          {(htmlQuote || split) && <button className="underline" onClick={() => setQuoted(!quoted)} title="The mail this one was answering. It is already in the conversation above.">{quoted ? 'Hide the quoted mail' : 'Show the quoted mail'}</button>}
          {f.html && (frame.capped || tall) && <button className="underline" onClick={() => setTall(!tall)}>{tall ? 'Shorter' : 'Taller'}</button>}
        </p>
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
          <p className="text-xs text-muted-foreground">While writing a message: Ctrl or Cmd with B for bold, I for italic, U for underline, K for a link.</p>
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
