'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Mail, LayoutDashboard, PenSquare, RefreshCw, Paperclip, Check, Archive, Trash2, ShieldAlert, Reply, ReplyAll, Forward, Inbox,
  MailOpen, ListPlus, ArrowLeft, Search, ExternalLink, Signature, Unplug, Image as ImageIcon, Download,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Item } from '@/lib/rpmail/mail-ops'
import type { BoxInfo } from '@/lib/rpmail/overview'
import { Compose, type ComposeStart } from './compose'

// The built-in RPMail page: Dashboard (a tile per mailbox, My Plate, Your jobs, Needs you, Daily summary) and one
// inbox per mailbox. Unread mail is bold everywhere. Opening a message never marks it read.

type State = { enabled: boolean; name: string; role: string; googleReady: boolean; personalAddress: string | null; loginEmail: string; boxes: BoxInfo[]; note: string | null }
type PlateItem = { id: string; title: string; detail: string; kind: string; site_number: string | null; priority: number; due_date: string | null; status: string; waiting_on: string | null; mail: Item | null; mail_n: number }
type SumItem = { mailbox_id: string; id: string; date: number; from_name: string; subject: string; site: string | null; po: string | null; snippet: string; why?: string; unread?: boolean }
type Summary = { day: string; created: number; data: { since: number; boxes: { id: string; name: string; received: number; items: SumItem[]; more: number }[]; needs: SumItem[]; stale: SumItem[]; permits: SumItem[]; pos: SumItem[]; deadlines: SumItem[] } }
type Move = { id: number; mailbox_id: string; subject: string; from_place: string; to_place: string; undone: boolean; created_at: number }
type Overview = { boxes: BoxInfo[]; needs: Item[]; foryou: Item[]; plate: { items: PlateItem[]; error: string | null }; summary: Summary | null; moves: Move[]; now: number }
type Full = Item & { cc_addrs: string; to_full: string; cc_full: string; text: string; html: string | null; done: boolean; hidden: boolean
  attachments: { i: number; name: string; type: string; size: number; inline: boolean }[]
  thread: { id: string; date: number; from_name: string; snippet: string; unread: boolean; sent: boolean }[] }
type Toast = { text: string; undo?: () => void } | null
type Filter = { view: 'inbox' | 'needs' | 'sent' | 'filed' | 'all'; q: string; unread: boolean; att: boolean }
type View = { kind: 'dash' } | { kind: 'box'; id: string }
/** Which list a set of rows belongs to, so a list for another mailbox or filter is never shown under the wrong heading. */
const keyOf = (v: View, f: Filter) => v.kind === 'box' ? [v.id, f.view, f.unread, f.att].join('|') : ''

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
    return api<{ messages: Item[] }>('messages', undefined, { mailbox: v.id, view: f.view, q: f.q, unread: f.unread ? '1' : '', att: f.att ? '1' : '' })
      .then(r => setList({ key: keyOf(v, f), items: r.messages }))
      .catch(e => setErr((e as Error).message))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const o = await api<Overview>('overview')
      setOv(o); setSt(s => s ? { ...s, boxes: o.boxes } : s); setErr('')
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
        for (let i = 0; i < 80; i++) {
          let r: { done: boolean; busy?: boolean }
          try { r = await api('sync', { mailbox: b.id }) } catch { break }
          if (r.done) break
          await refresh()
          if (r.busy) await new Promise(res => setTimeout(res, 4000))
        }
      }
      await refresh()
    } finally { syncing.current = false; setBusy(false) }
  }, [refresh])

  const boot = useCallback((): Promise<void> => api<State>('state')
    .then(async s => { setSt(s); if (s.enabled) { await refresh(); void syncAll(s.boxes) } })
    .catch(e => setErr((e as Error).message)), [refresh, syncAll])

  useEffect(() => {
    void boot()
    if (connected || connectError) window.history.replaceState(null, '', '/rpmail')
    const t = setInterval(() => { if (document.visibilityState === 'visible') void api<State>('state').then(s => { if (s.enabled) void syncAll(s.boxes) }).catch(() => null) }, 90_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void loadList() }, [view, filter.view, filter.unread, filter.att, loadList])   // typing in the search box waits for Enter

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

  const boxes = useMemo(() => st?.boxes ?? [], [st])
  const boxName = useCallback((id: string) => boxes.find(b => b.id === id)?.name ?? '', [boxes])
  const cur = view.kind === 'box' ? boxes.find(b => b.id === view.id) ?? null : null

  if (!st) return <div className="p-6 text-sm text-muted-foreground">{err || 'Loading RPMail...'}</div>
  if (!st.enabled) return <Setup st={st} localUrl={localUrl} onOn={boot} />

  const rowProps = { onOpen: (it: Item) => { if (view.kind !== 'box' || view.id !== it.mailbox_id) { setFilter({ view: 'all', q: '', unread: false, att: false }); setView({ kind: 'box', id: it.mailbox_id }) } void openMsg(it.mailbox_id, it.id) },
    onMenu: (e: React.MouseEvent, it: Item) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, item: it }) } }

  return (
    <div className="p-3 sm:p-5 max-w-[1500px] mx-auto" onClick={() => menu && setMenu(null)}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="rp-title">RPMail</h1>
          <p className="rp-subtitle">Your mail, what needs a reply and your jobs, in one place.{localUrl && <> <a className="underline" href={localUrl} target="_blank" rel="noopener noreferrer">Open your own RPMail</a></>}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={btn('ghost')} onClick={() => void syncAll(boxes)} disabled={busy} title="Check for new mail"><RefreshCw className={cn(busy && 'animate-spin')} />{busy ? 'Checking' : 'Check mail'}</button>
          <button className={btn('default')} onClick={() => setCompose({ mode: 'new', mailbox: cur?.connected ? cur.id : boxes.find(b => b.connected)?.id ?? '' })} disabled={!boxes.some(b => b.connected)}><PenSquare />New message</button>
        </div>
      </div>
      {err && <p className="mb-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {st.note && <p className="mb-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">{st.note}</p>}

      <div className="flex flex-col lg:flex-row gap-4">
        <nav className="lg:w-56 shrink-0 flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
          <NavBtn on={view.kind === 'dash'} onClick={() => { setView({ kind: 'dash' }); setSel(null); setMsg(null) }} icon={<LayoutDashboard className="size-4" />} label="Dashboard" />
          {boxes.map(b => (
            <NavBtn key={b.id} on={view.kind === 'box' && view.id === b.id} icon={<Mail className="size-4" />} label={b.name} sub={b.address} count={b.unread}
              onClick={() => { setFilter({ view: 'inbox', q: '', unread: false, att: false }); setView({ kind: 'box', id: b.id }); setSel(null); setMsg(null) }} />
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {view.kind === 'dash' && ov && <Dash ov={ov} boxName={boxName} rowProps={rowProps} goBox={id => { setFilter({ view: 'inbox', q: '', unread: false, att: false }); setView({ kind: 'box', id }) }}
            markDone={markDone} plateDone={plateDone} undo={id => void act(async () => { const u = await api<{ back_to: string }>('undo', { move: id }); await refresh(); say('Back in ' + u.back_to + '.') })} />}
          {view.kind === 'dash' && !ov && <p className="text-sm text-muted-foreground">Loading...</p>}
          {view.kind === 'dash' && (
            <p className="mt-6 text-xs text-muted-foreground">RPMail is on for your login.{' '}
              <button className="underline" onClick={() => { if (window.confirm('Turn RPMail off? Your own mailbox is disconnected from RP Intelligence. Your mail in Gmail is not touched, and you can turn it back on any time.')) void act(async () => { await api('enable', { on: false }); await boot() }) }}>Turn it off</button>
            </p>
          )}
          {view.kind === 'box' && cur && !cur.connected && <Connect box={cur} st={st} />}
          {view.kind === 'box' && cur && cur.connected && (
            <BoxView box={cur} filter={filter} setFilter={setFilter} list={list} sel={sel} msg={msg} msgErr={msgErr} rowProps={rowProps} reload={loadList}
              close={() => { setSel(null); setMsg(null) }} openOther={id => void openMsg(cur.id, id)}
              search={() => void act(async () => { say('Searching all of Gmail...'); const r = await api<{ messages: Item[] }>('search', { mailbox: cur.id, q: filter.q }); setList({ key: keyOf(view, filter), items: r.messages }); say(r.messages.length ? `${r.messages.length} found in Gmail.` : 'Nothing found in Gmail.') })}
              actions={{ fileTo, markRead, markDone, plateAdd, reply: (m, all, fwd) => setCompose({ mode: fwd ? 'forward' : 'reply', mailbox: m.mailbox_id, id: m.id, all }) }}
              editSig={() => setCompose({ mode: 'signature', mailbox: cur.id })}
              disconnect={cur.kind === 'personal' ? () => { if (window.confirm('Disconnect this mailbox from RPMail? Your mail in Gmail is not touched. You can sign in again any time.')) void act(async () => { await api('disconnect', { mailbox: cur.id }); await boot() }) } : undefined} />
          )}
        </div>
      </div>

      {menu && (
        <div className="fixed z-50 rp-card py-1 text-sm shadow-lg" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 150) }}>
          <MenuBtn onClick={() => void markDone(menu.item)}>Done (off my lists)</MenuBtn>
          <MenuBtn onClick={() => void plateAdd(menu.item)}>Add to My Plate</MenuBtn>
          <MenuBtn onClick={() => void markRead(menu.item, !menu.item.unread)}>{menu.item.unread ? 'Mark read' : 'Mark unread'}</MenuBtn>
          {menu.item.in_inbox && <MenuBtn onClick={() => void fileTo(menu.item, 'Archive')}>Archive</MenuBtn>}
        </div>
      )}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg bg-foreground text-background px-4 py-2.5 text-sm shadow-lg max-w-[92vw]">
          <span>{toast.text}</span>
          {toast.undo && <button className="font-semibold underline" onClick={() => { const u = toast.undo!; setToast(null); u() }}>Undo</button>}
        </div>
      )}
      {compose && <Compose start={compose} boxes={boxes} onClose={() => setCompose(null)} onDone={text => { setCompose(null); say(text); void refresh() }} />}
    </div>
  )
}

function NavBtn({ on, onClick, icon, label, sub, count }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub?: string; count?: number }) {
  return (
    <button onClick={onClick} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm whitespace-nowrap lg:whitespace-normal', on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card hover:bg-raised')}>
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

type RowProps = { onOpen: (it: Item) => void; onMenu: (e: React.MouseEvent, it: Item) => void }

function Row({ m, selected, boxLabel, onDone, onOpen, onMenu }: { m: Item; selected?: boolean; boxLabel?: string; onDone?: () => void } & RowProps) {
  const bold = m.unread || m.waiting
  return (
    <div onClick={() => onOpen(m)} onContextMenu={e => onMenu(e, m)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen(m)}
      className={cn('flex gap-2 px-3 py-2 border-b border-hairline cursor-pointer hover:bg-raised', selected && 'bg-primary/10', bold ? 'text-foreground' : 'text-muted-foreground')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm', bold ? 'font-bold' : 'font-medium')}>{m.sent ? 'To: ' + (m.to_addrs.split(',')[0] || '') : m.from_name || m.from_addr}{(m.count ?? 1) > 1 && <span className="font-normal text-muted-foreground"> ({m.count})</span>}</span>
          <span className={cn('ml-auto shrink-0 text-xs tabular-nums', bold && 'font-bold')}>{when(m.date)}</span>
        </div>
        <div className={cn('truncate text-sm', bold ? 'font-bold text-foreground' : '')}>{m.subject || '(no subject)'}</div>
        <div className="truncate text-xs text-muted-foreground">{m.snippet}</div>
        <div className="mt-1 flex flex-wrap gap-1 empty:hidden">
          {m.waiting && <span className="rp-pill" data-tone="warning">Waiting on a reply</span>}
          {m.why && <span className="rp-pill" data-tone="info">{m.why}</span>}
          {m.site && <span className="rp-site-tag">{m.site}</span>}
          {m.po && <span className="rp-pill">PO {m.po}</span>}
          {m.has_att && <span className="rp-pill"><Paperclip className="size-3" /></span>}
          {boxLabel && <span className="rp-pill">{boxLabel}</span>}
        </div>
      </div>
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

function Tile({ title, sub, nums, foot, bold, onClick }: { title: string; sub: string; nums: [number | string, string][]; foot: string; bold?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rp-card rp-card-link p-4 text-left">
      <div className={cn('text-sm text-foreground truncate', bold ? 'font-bold' : 'font-semibold')}>{title}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
      <div className="mt-3 flex gap-5">
        {nums.map(([n, l]) => <div key={l}><div className="rp-stat-value text-2xl">{n}</div><div className="rp-stat-label">{l}</div></div>)}
      </div>
      <div className={cn('mt-3 text-xs truncate', bold ? 'font-bold text-foreground' : 'text-muted-foreground')}>{foot}</div>
    </button>
  )
}

function Dash({ ov, boxName, rowProps, goBox, markDone, plateDone, undo }: { ov: Overview; boxName: (id: string) => string; rowProps: RowProps; goBox: (id: string) => void
  markDone: (it: { mailbox_id: string; id: string }) => void; plateDone: (t: PlateItem) => void; undo: (id: number) => void }) {
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  const P = ov.plate.items, open = P.filter(t => t.status === 'open')
  const waitingJobs = ov.foryou.filter(m => m.waiting).length
  const s = ov.summary?.data
  const many = ov.boxes.length > 1
  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
        {ov.boxes.map(b => (
          <Tile key={b.id} title={b.name} sub={b.address} bold={b.unread > 0} onClick={() => goBox(b.id)}
            nums={b.connected ? [[b.inbox, 'in inbox'], [b.unread, 'unread'], [b.needs, 'need you']] : [['-', 'not connected']]}
            foot={!b.connected ? 'Sign in with Google to connect' : b.loading ? `Loading mail: ${b.loading.total - b.loading.left} of ${b.loading.total}` : b.last_error ? b.last_error : 'Checked ' + ago(b.last_sync_at)} />
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
              onClick={() => rowProps.onOpen({ ...i, thread_id: '', from_addr: '', to_addrs: '', unread: !!i.unread, starred: false, has_att: false, in_inbox: true, sent: false })}>
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
  reply: (m: Full, all: boolean, fwd: boolean) => void
}

function BoxView({ box, filter, setFilter, list, sel, msg, msgErr, rowProps, reload, close, openOther, search, actions, editSig, disconnect }: {
  box: BoxInfo; filter: Filter; setFilter: (f: Filter) => void; list: Item[] | null; sel: { mailbox: string; id: string } | null; msg: Full | null; msgErr: string
  rowProps: RowProps; reload: () => void; close: () => void; openOther: (id: string) => void; search: () => void; actions: Actions; editSig: () => void; disconnect?: () => void }) {
  const views: [Filter['view'], string][] = [['inbox', 'Inbox'], ['needs', 'Needs you'], ['sent', 'Sent'], ['filed', 'Filed'], ['all', 'All']]
  return (
    <div className="rp-card overflow-hidden">
      <div className="rp-card-head">
        <div className="min-w-0">
          <h2 className="rp-card-title truncate">{box.name}</h2>
          <p className="text-xs text-muted-foreground truncate">{box.address} · {box.loading ? `loading mail: ${box.loading.total - box.loading.left} of ${box.loading.total}` : 'checked ' + ago(box.last_sync_at)}{box.crew_reads ? ' · the crew reads this mailbox: no pricing' : ''}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button className={btn('ghost', 'xs')} onClick={editSig}><Signature />Signature</button>
          {disconnect && <button className={btn('ghost', 'xs')} onClick={disconnect}><Unplug />Disconnect</button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-hairline">
        {views.map(([v, l]) => <button key={v} className="rp-chip" data-on={filter.view === v} onClick={() => setFilter({ ...filter, view: v })}>{l}{v === 'inbox' && box.unread ? ` (${box.unread})` : v === 'needs' && box.needs ? ` (${box.needs})` : ''}</button>)}
        <button className="rp-chip" data-on={filter.unread} onClick={() => setFilter({ ...filter, unread: !filter.unread })}>Unread only</button>
        <button className="rp-chip" data-on={filter.att} onClick={() => setFilter({ ...filter, att: !filter.att })}><Paperclip className="size-3" />Attachments</button>
        <form className="ml-auto flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); reload() }}>
          <input className="rp-input !w-44 sm:!w-56" placeholder="Search name, subject, site #" value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })} />
          <button className={btn('outline', 'sm')} type="submit" title="Search the last 90 days"><Search /></button>
          {filter.q.trim().length > 1 && <button className={btn('ghost', 'sm')} type="button" onClick={search}>Search all of Gmail</button>}
        </form>
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(280px,38%)_1fr] lg:min-h-[60vh]">
        <div className={cn('lg:border-r border-hairline lg:max-h-[78vh] overflow-y-auto', sel && 'hidden lg:block')}>
          {list === null && <Empty>Loading...</Empty>}
          {list && !list.length && <Empty>{box.loading ? 'Your mail is still loading. This fills in as it arrives.' : 'Nothing here.'}</Empty>}
          {list?.map(m => <Row key={m.id} m={m} selected={sel?.id === m.id} {...rowProps} />)}
        </div>
        <div className={cn('lg:max-h-[78vh] overflow-y-auto', !sel && 'hidden lg:block')}>
          {!sel && <Empty>Pick a message to read it. Opening a message does not mark it read.</Empty>}
          {sel && !msg && <Empty>{msgErr || 'Opening...'}</Empty>}
          {sel && msg && <Reader key={msg.id} m={msg} close={close} openOther={openOther} actions={actions} />}
        </div>
      </div>
    </div>
  )
}

function Reader({ m, close, openOther, actions }: { m: Full; close: () => void; openOther: (id: string) => void; actions: Actions }) {
  const [imgs, setImgs] = useState(false)   // the reader is keyed by message, so pictures are hidden again for each new one
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
          <button className={btn('default')} onClick={() => actions.reply(m, false, false)}><Reply />Reply</button>
          <button className={btn()} onClick={() => actions.reply(m, true, false)}><ReplyAll />Reply all</button>
          <button className={btn()} onClick={() => actions.reply(m, false, true)}><Forward />Forward</button>
          {m.in_inbox
            ? <button className={btn()} onClick={() => actions.fileTo(it, 'Archive')}><Archive />Archive</button>
            : <button className={btn()} onClick={() => actions.fileTo(it, 'Inbox')}><Inbox />Move to inbox</button>}
          <button className={btn()} onClick={() => actions.fileTo(it, 'Spam')}><ShieldAlert />Spam</button>
          <button className={btn('destructive')} onClick={() => actions.fileTo(it, 'Trash')}><Trash2 />Delete</button>
          <button className={btn('ghost')} onClick={() => actions.markRead(it, !m.unread)}><MailOpen />{m.unread ? 'Mark read' : 'Mark unread'}</button>
          <button className={btn('ghost')} onClick={() => actions.markDone(it, !m.done)}><Check />{m.done ? 'Not done' : 'Done'}</button>
          <button className={btn('ghost')} onClick={() => actions.plateAdd(it)}><ListPlus />Add to My Plate</button>
        </div>
      </div>
      {m.attachments.length > 0 && (
        <div className="px-4 py-2 border-b border-hairline flex flex-wrap gap-1.5">
          {m.attachments.map(a => (
            <span key={a.i} className="rp-pill !py-1.5">
              <Paperclip className="size-3" /><a className="hover:underline" href={att(a.i)} target="_blank" rel="noopener noreferrer">{a.name}</a>
              <span className="text-muted-foreground">{size(a.size)}</span><a href={att(a.i, true)} title="Download"><Download className="size-3" /></a>
            </span>
          ))}
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
