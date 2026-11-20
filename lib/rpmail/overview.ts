import { createAdminClient } from '@/lib/supabase/admin'
import { googleClient, UserError } from './gmail'
import { myMailboxes, mailboxFor, personalAddress, ensurePersonalMailbox, type Me, type Mailbox } from './access'
import { LIST_COLS, toItem, getSignature, type Item } from './mail-ops'
import { subjectKey, AUTO_RE } from './parse'
import { getPrefs } from './extras'

// RPMail: what the Dashboard shows. Everything is worked out from the index rows of the mailboxes this one person
// may open, plus their own My Plate rows. Nobody else's mailbox or plate is ever read here.

const DAY = 86_400_000
type Row = Parameters<typeof toItem>[0] & { msgid?: string | null; refs?: string | null; bulk?: boolean; asks?: boolean; deadline?: string | null }

/** Keep only rows from mailboxes this person may open right now (myMailboxes applies the role rule). */
const onlyAllowed = <T extends { mailbox_id: string }>(rows: T[], boxes: Pick<Mailbox, 'id'>[]) => {
  const ok = new Set(boxes.map(b => b.id))
  return rows.filter(r => ok.has(r.mailbox_id))
}

export type BoxInfo = {
  id: string; name: string; address: string; kind: 'personal' | 'shared'; crew_reads: boolean; connected: boolean
  inbox: number; unread: number; newest: number | null; needs: number; last_sync_at: string | null; last_error: string | null
  loading: { total: number; left: number } | null; signature: string
}

export async function boxInfos(who: Me, boxes: Mailbox[]): Promise<BoxInfo[]> {
  const admin = createAdminClient()
  const { data: counts } = await admin.rpc('rpmail_counts', { p_profile: who.id })
  const by = new Map(((counts ?? []) as { mailbox_id: string; inbox: number; unread: number; newest: string | null }[]).map(c => [c.mailbox_id, c]))
  const { data: needs } = await admin.rpc('rpmail_needs', { p_profile: who.id, p_mailbox: null, p_limit: 500 })
  const needBy = new Map<string, number>()
  for (const n of onlyAllowed((needs ?? []) as { mailbox_id: string }[], boxes)) needBy.set(n.mailbox_id, (needBy.get(n.mailbox_id) ?? 0) + 1)
  return Promise.all(boxes.map(async b => {
    const c = by.get(b.id)
    return {
      id: b.id, name: b.name, address: b.address, kind: b.kind, crew_reads: b.crew_reads, connected: !!b.token_secret_id,
      inbox: Number(c?.inbox ?? 0), unread: Number(c?.unread ?? 0), newest: c?.newest ? Date.parse(c.newest) : null, needs: needBy.get(b.id) ?? 0,
      last_sync_at: b.last_sync_at, last_error: b.last_error,
      loading: b.sync?.todo?.length ? { total: b.sync.total ?? 0, left: b.sync.todo.length } : null,
      signature: await getSignature(who, b.id),
    }
  }))
}

/** First screen: is RPMail on, is Google sign-in ready, and which mailboxes does this person have. */
export async function state(who: Me) {
  let note: string | null = null
  if (who.enabled) {
    // The person's own mailbox is set up here, so an address Trae changes in Settings takes effect on their next visit.
    try { await ensurePersonalMailbox(who) } catch (e) { note = e instanceof UserError ? e.message : null }
    if (!personalAddress(who)) note = 'Your login is not a Gmail address, so RPMail does not know which mailbox is yours. Ask Trae to set your Gmail address in Settings, RPMail.'
  }
  const boxes = who.enabled ? await myMailboxes(who) : []
  return {
    enabled: who.enabled, name: who.name, role: who.role, googleReady: !!googleClient(), personalAddress: personalAddress(who), loginEmail: who.email,
    boxes: who.enabled ? await boxInfos(who, boxes) : [], note, prefs: await getPrefs(who),
  }
}

async function doneSet(who: Me): Promise<Set<string>> {
  const { data } = await createAdminClient().from('rpmail_done').select('mailbox_id, gmail_id').eq('profile_id', who.id).order('created_at', { ascending: false }).limit(3000)
  return new Set((data ?? []).map(d => d.mailbox_id + ':' + d.gmail_id))
}

/** Site numbers this person is working on: jobs they manage, what is on their plate, and what they have written about lately. */
async function mySites(who: Me, sentRows: Row[]): Promise<Set<string>> {
  const admin = createAdminClient()
  const sites = new Set<string>()
  const { data: jobs } = await admin.from('con_jobs').select('site_number').eq('company_id', who.company_id).eq('assigned_manager_id', who.id).limit(500)
  for (const j of jobs ?? []) if (j.site_number) sites.add(String(j.site_number))
  const { data: tasks } = await admin.from('con_tasks').select('site_number').eq('owner_id', who.id).in('status', ['open', 'waiting']).limit(500)
  for (const t of tasks ?? []) if (t.site_number) sites.add(String(t.site_number))
  const cutoff = Date.now() - 60 * DAY
  for (const r of sentRows) if (r.site && Date.parse(r.date) > cutoff) sites.add(r.site)
  return sites
}

/**
 * "Your jobs": mail in the person's mailboxes that touches their work. In a shared mailbox that is a reply to mail
 * they sent, mail about one of their jobs, or mail that names them. In their own mailbox it is mail about one of
 * their jobs. Read or unread makes no difference in a shared mailbox: other people open it too.
 */
export async function forYou(who: Me, boxes: Mailbox[], done: Set<string>, days = 14, limit = 60): Promise<Item[]> {
  const ids = boxes.filter(b => b.token_secret_id).map(b => b.id)
  if (!ids.length) return []
  const admin = createAdminClient()
  const mine = new Set([who.email, personalAddress(who) ?? ''].filter(Boolean))
  const cols = LIST_COLS + ', msgid, refs, bulk, asks'
  const { data: sentData } = await admin.from('rpmail_messages').select(cols).in('mailbox_id', ids).in('from_addr', [...mine])
    .gte('date', new Date(Date.now() - 90 * DAY).toISOString()).order('date', { ascending: false }).limit(2000)
  const sent = (sentData ?? []) as unknown as Row[]
  const sites = await mySites(who, sent)
  const mySubj = new Map<string, [number, number]>(), myIds = new Set<string>(), myThread = new Map<string, [number, number]>()
  for (const r of sent) {
    const t = Date.parse(r.date), k = subjectKey(r.subject)
    if (k.length >= 8) { const v = mySubj.get(k); mySubj.set(k, v ? [Math.min(v[0], t), Math.max(v[1], t)] : [t, t]) }
    if (r.msgid) myIds.add(r.msgid)
    const tk = r.mailbox_id + ':' + r.thread_id, tv = myThread.get(tk)
    myThread.set(tk, tv ? [Math.min(tv[0], t), Math.max(tv[1], t)] : [t, t])
  }
  const { data } = await admin.from('rpmail_messages').select(cols).in('mailbox_id', ids).eq('bulk', false).eq('sent', false)
    .gte('date', new Date(Date.now() - days * DAY).toISOString()).order('date', { ascending: false }).limit(2500)
  const rows = (data ?? []) as unknown as Row[]
  const newest = new Map<string, number>()
  for (const r of rows) { const k = r.mailbox_id + ':' + r.thread_id; newest.set(k, Math.max(newest.get(k) ?? 0, Date.parse(r.date))) }
  const boxBy = new Map(boxes.map(b => [b.id, b]))
  const first = (who.name || '').trim().split(/[\s-]+/)[0] ?? ''
  const nameRe = first.length >= 3 ? new RegExp(`\\b${first.replace(/[^A-Za-z]/g, '')}\\b`, 'i') : null
  const out: Item[] = []
  for (const r of rows) {
    const box = boxBy.get(r.mailbox_id)!
    const from = (r.from_addr ?? '').toLowerCase()
    if (mine.has(from) || AUTO_RE.test(from) || done.has(r.mailbox_id + ':' + r.gmail_id)) continue
    if (/reacted via Gmail/i.test(r.snippet ?? '')) continue
    const t = Date.parse(r.date), k = subjectKey(r.subject), why: string[] = []
    let mineAfter = 0
    if (box.kind === 'shared') {
      const th = myThread.get(r.mailbox_id + ':' + r.thread_id), sv = mySubj.get(k)
      if (th && th[0] < t) { why.push('Reply to your email'); mineAfter = Math.max(mineAfter, th[1]) }
      else if (sv && sv[0] < t) { why.push('Reply to your email'); mineAfter = Math.max(mineAfter, sv[1]) }
      else if ((r.refs ?? '').match(/<[^>]+>/g)?.some(i => myIds.has(i))) why.push('Reply to your email')
    } else {
      const th = myThread.get(r.mailbox_id + ':' + r.thread_id)
      if (th) mineAfter = th[1]
    }
    if (r.site && sites.has(r.site)) why.push('Your job ' + r.site)
    if (box.kind === 'shared' && nameRe && nameRe.test(r.snippet ?? '')) why.push('Mentions you')
    if (!why.length) continue
    const waiting = !!r.asks && mineAfter <= t && (newest.get(r.mailbox_id + ':' + r.thread_id) ?? 0) <= t && from !== box.address
    out.push({ ...toItem(r), why: why.slice(0, 2).join(' · '), waiting })
  }
  out.sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.date - a.date)
  return out.slice(0, limit)
}

// ── My Plate (the person's own con_tasks rows) ────────────────────────────────────────────────────────────────
const PLATE_COLS = 'id, title, detail, kind, site_number, priority, due_date, status, waiting_on, waiting_since, snoozed_until, my_note, created_at'
const UUID = /^[0-9a-f-]{36}$/

export async function plateList(who: Me, boxes: Mailbox[]) {
  const admin = createAdminClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const { data, error } = await admin.from('con_tasks').select(PLATE_COLS).eq('owner_id', who.id).in('status', ['open', 'waiting'])
    .order('priority').order('due_date', { nullsFirst: false }).order('created_at').limit(200)
  if (error) return { items: [], error: 'Could not load My Plate.' }
  const ids = boxes.map(b => b.id)
  const items = []
  for (const t of (data ?? []).filter(t => !(t.snoozed_until && t.snoozed_until > today))) {
    const s = String(t.site_number ?? '').trim()
    let mail: Item | null = null, mail_n = 0
    if (s && ids.length && /^[\w -]{2,20}$/.test(s)) {
      const { data: m } = await admin.from('rpmail_messages').select(LIST_COLS).in('mailbox_id', ids).eq('site', s)
        .gte('date', new Date(Date.now() - 30 * DAY).toISOString()).order('date', { ascending: false }).limit(1)
      mail = m?.[0] ? toItem(m[0] as unknown as Row) : null
      if (mail) {
        const { count } = await admin.from('rpmail_messages').select('gmail_id', { count: 'exact', head: true }).in('mailbox_id', ids).eq('site', s)
          .gte('date', new Date(Date.now() - 14 * DAY).toISOString())
        mail_n = count ?? 0
      }
    }
    items.push({ ...t, detail: String(t.detail ?? '').slice(0, 400), mail, mail_n })
  }
  items.sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open'))
  return { items, error: null as string | null }
}

export async function plateDone(who: Me, p: { id?: unknown; undo?: unknown; prev?: unknown }) {
  if (typeof p.id !== 'string' || !UUID.test(p.id)) throw new UserError('No such task.')
  const body = p.undo === true
    ? { status: p.prev === 'waiting' ? 'waiting' : 'open', done_at: null }
    : { status: 'done', done_at: new Date().toISOString() }
  const { data } = await createAdminClient().from('con_tasks').update(body).eq('id', p.id).eq('owner_id', who.id).select('id')
  if (!data?.length) throw new UserError('That task is not on your plate any more.')
  return { ok: true, done: p.undo !== true }
}

/** Put an email on the person's own My Plate as a follow-up. The same email is never added twice. */
export async function plateAdd(who: Me, p: { mailbox?: unknown; id?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const admin = createAdminClient()
  const { data: row } = await admin.from('rpmail_messages').select('gmail_id, subject, from_name, from_addr, date, site, msgid')
    .eq('mailbox_id', box.id).eq('gmail_id', String(p.id ?? '')).maybeSingle()
  if (!row) throw new UserError('Message not found.')
  const when = new Date(row.date as string).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', year: '2-digit' })
  const title = (String(row.subject || '(no subject)')).slice(0, 140)
  const body = {
    company_id: who.company_id, owner_id: who.id, title, detail: `From ${row.from_name || row.from_addr || '?'}, ${when} (${box.name}). Added from RPMail.`,
    kind: 'followup', site_number: row.site ?? null, source: 'manual', source_key: ('rpmail:' + (row.msgid || box.id + ':' + row.gmail_id)).slice(0, 190),
  }
  const { data, error } = await admin.from('con_tasks').upsert(body, { onConflict: 'company_id,owner_id,source_key', ignoreDuplicates: true }).select('id')
  if (error) throw new Error('Could not add it to My Plate.')
  return { ok: true, added: !!data?.length, title }
}

// ── Daily summary ─────────────────────────────────────────────────────────────────────────────────────────────
/** The moment it is `hour`:00 in New York on `day` (YYYY-MM-DD). */
function nyTime(day: string, hour: number): Date {
  for (const off of [4, 5]) {
    const d = new Date(`${day}T${String(hour + off).padStart(2, '0')}:00:00Z`)
    if (Number(d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) % 24 === hour) return d
  }
  return new Date(`${day}T${String(hour + 5).padStart(2, '0')}:00:00Z`)
}
const SUMMARY_HOUR = 6
type SumItem = { mailbox_id: string; id: string; date: number; from_name: string; subject: string; site: string | null; po: string | null; snippet: string; why?: string; unread?: boolean }
type Summary = { since: number; boxes: { id: string; name: string; received: number; items: SumItem[]; more: number }[]; needs: SumItem[]; stale: SumItem[]; permits: SumItem[]; pos: SumItem[]; deadlines: SumItem[] }

const sumItem = (r: Row, why?: string): SumItem => ({ mailbox_id: r.mailbox_id, id: r.gmail_id, date: Date.parse(r.date), from_name: r.from_name ?? '', subject: r.subject ?? '',
  site: r.site ?? null, po: r.po ?? null, snippet: (r.snippet ?? '').slice(0, 160), ...(why ? { why } : {}) })

async function buildSummary(who: Me, boxes: Mailbox[], day: string): Promise<Summary> {
  const admin = createAdminClient()
  const since = nyTime(day, SUMMARY_HOUR).getTime() - DAY
  const ids = boxes.map(b => b.id)
  const out: Summary = { since, boxes: [], needs: [], stale: [], permits: [], pos: [], deadlines: [] }
  if (!ids.length) return out
  const { data } = await admin.from('rpmail_messages').select(LIST_COLS + ', bulk, deadline').in('mailbox_id', ids).eq('sent', false)
    .gte('date', new Date(since).toISOString()).order('date', { ascending: false }).limit(3000)
  const rows = (data ?? []) as unknown as Row[]
  for (const b of boxes) {
    const mineRows = rows.filter(r => r.mailbox_id === b.id)
    const real = mineRows.filter(r => !r.bulk)
    out.boxes.push({ id: b.id, name: b.name, received: mineRows.length, items: real.slice(0, 12).map(r => sumItem(r)), more: Math.max(0, real.length - 12) })
  }
  const { data: need } = await admin.rpc('rpmail_needs', { p_profile: who.id, p_mailbox: null, p_limit: 60 })
  const cutoff = Date.now() - 2 * DAY
  for (const r of onlyAllowed((need ?? []) as Row[], boxes)) (Date.parse(r.date) >= cutoff ? out.needs : out.stale).push(sumItem(r))
  out.permits = rows.filter(r => !r.bulk && /\bpermit/i.test(r.subject ?? '')).slice(0, 30).map(r => sumItem(r))
  out.pos = rows.filter(r => r.po).slice(0, 30).map(r => sumItem(r))
  out.deadlines = rows.filter(r => r.deadline).slice(0, 25).map(r => sumItem(r, r.deadline ?? undefined))
  return out
}

/** Today's summary (made the first time the person opens RPMail after 6 AM), stamped with what is unread or Done right now. */
export async function dailySummary(who: Me, boxes: Mailbox[], done: Set<string>) {
  const admin = createAdminClient()
  const now = new Date()
  const nyHour = Number(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })) % 24
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const ready = boxes.some(b => b.token_secret_id && b.sync?.full_done)
  let { data: s } = await admin.from('rpmail_summaries').select('day, data, created_at').eq('profile_id', who.id).order('day', { ascending: false }).limit(1).maybeSingle()
  if (ready && nyHour >= SUMMARY_HOUR && (!s || s.day !== today)) {
    const data = await buildSummary(who, boxes.filter(b => b.token_secret_id), today)
    await admin.from('rpmail_summaries').upsert({ profile_id: who.id, day: today, data }, { onConflict: 'profile_id,day' })
    await admin.from('rpmail_summaries').delete().eq('profile_id', who.id).lt('day', new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10))
    s = { day: today, data, created_at: now.toISOString() }
  }
  if (!s) return null
  const allowed = new Set(boxes.map(b => b.id))
  const d = s.data as Summary
  const lists = [d.needs, d.stale, d.permits, d.pos, d.deadlines, ...d.boxes.map(b => b.items)]
  const keys = [...new Set(lists.flat().filter(i => allowed.has(i.mailbox_id)).map(i => i.id))]
  const unread = new Set<string>()
  for (let i = 0; i < keys.length; i += 300) {
    const { data: u } = await admin.from('rpmail_messages').select('mailbox_id, gmail_id').in('mailbox_id', [...allowed]).in('gmail_id', keys.slice(i, i + 300)).eq('unread', true)
    for (const r of u ?? []) unread.add(r.mailbox_id + ':' + r.gmail_id)
  }
  // A mailbox taken off this login since the summary was made drops out of it.
  const live = (l: SumItem[]) => l.filter(i => allowed.has(i.mailbox_id) && !done.has(i.mailbox_id + ':' + i.id)).map(i => ({ ...i, unread: unread.has(i.mailbox_id + ':' + i.id) }))
  return { day: s.day as string, created: Date.parse(s.created_at as string), data: {
    since: d.since, boxes: d.boxes.filter(b => allowed.has(b.id)).map(b => ({ ...b, items: live(b.items) })),
    needs: live(d.needs), stale: live(d.stale), permits: live(d.permits), pos: live(d.pos), deadlines: live(d.deadlines) } }
}

export async function overview(who: Me) {
  const boxes = await myMailboxes(who)
  const admin = createAdminClient()
  const done = await doneSet(who)
  const [infos, needsRes, foryou, plate, movesRes, summary, prefs] = await Promise.all([
    boxInfos(who, boxes),
    admin.rpc('rpmail_needs', { p_profile: who.id, p_mailbox: null, p_limit: 80 }),
    forYou(who, boxes, done),
    plateList(who, boxes),
    admin.from('rpmail_moves').select('id, mailbox_id, subject, from_place, to_place, undone, created_at').eq('profile_id', who.id).order('id', { ascending: false }).limit(12),
    dailySummary(who, boxes, done),
    getPrefs(who),
  ])
  return {
    boxes: infos, prefs, needs: onlyAllowed((needsRes.data ?? []) as Row[], boxes).map(toItem), foryou, plate, summary,
    moves: (movesRes.data ?? []).map(m => ({ ...m, created_at: Date.parse(m.created_at as string) })), now: Date.now(),
  }
}
