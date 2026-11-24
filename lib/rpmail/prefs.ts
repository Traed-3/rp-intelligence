import { createAdminClient } from '@/lib/supabase/admin'
import type { Me } from './access'

// RPMail: each person's own settings (one row in rpmail_prefs). Everything here belongs to the person who is
// signed in and changes nothing for anyone else.

const UUID = /^[0-9a-f-]{36}$/
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const ADDR = /^[^@\s<>"',;:()]+@[^@\s<>"',;:()]+\.[a-z]{2,}$/i

/** The time zones a person can pick. Times in RPMail are Eastern unless they choose another. */
export const ZONES: Record<string, string> = {
  'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona (no daylight time)',
  'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii',
}
export const DEFAULT_TZ = 'America/New_York'

/** New-mail notifications. `what`: 'needs' = mail from a person that asks for something, 'people' = any mail from a person, 'all' = everything. */
export type NotifyPrefs = { on: boolean; what: 'needs' | 'people' | 'all'; quiet_from: string; quiet_to: string; off: string[] }
/** A named list of addresses, to put several people on a message at once. */
export type Group = { name: string; addrs: string[] }
export type Prefs = {
  hidden: string[]; order: string[]; undo_secs: number; notify: NotifyPrefs
  /** The name people see on mail this person sends. Empty = their RP Intelligence name. */
  sender_name: string
  /** The mailbox New message starts from, and the mailbox RPMail opens on ('' = the dashboard). */
  default_from: string; start: string
  density: 'comfortable' | 'compact'
  tz: string
  groups: Group[]
  /** Mailboxes the person left out of their own lists (Needs you, For you, the mail on My Plate cards, the morning summary).
   *  They can still open and read them; only these lists change, and only for this person. */
  lists_off: string[]
}

const ids = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))].slice(0, 60) : []
const notifyPrefs = (v: unknown): NotifyPrefs => {
  const d = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return { on: d.on === true, what: d.what === 'needs' || d.what === 'all' ? d.what : 'people',
    quiet_from: typeof d.quiet_from === 'string' && HHMM.test(d.quiet_from) ? d.quiet_from : '', quiet_to: typeof d.quiet_to === 'string' && HHMM.test(d.quiet_to) ? d.quiet_to : '', off: ids(d.off) }
}
const UNDO = [0, 5, 10, 20, 30]
const undoSecs = (v: unknown) => UNDO.includes(Number(v)) && v !== null && v !== undefined && v !== '' ? Number(v) : 10
const one = (v: unknown) => typeof v === 'string' && UUID.test(v) ? v : ''
// A display name is one line of ordinary text: no line breaks, and none of the characters that mean something in an address.
const senderName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
const zone = (v: unknown) => typeof v === 'string' && v in ZONES ? v : DEFAULT_TZ
const groups = (v: unknown): Group[] => (Array.isArray(v) ? v : []).slice(0, 30).flatMap(raw => {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = String(g.name ?? '').replace(/[\u0000-\u001f,;<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  const addrs = [...new Set((Array.isArray(g.addrs) ? g.addrs : String(g.addrs ?? '').split(/[,;\s]+/)).map(a => String(a).trim().toLowerCase()).filter(a => a.length <= 320 && ADDR.test(a)))].slice(0, 60)
  return name && addrs.length ? [{ name, addrs }] : []
})

export async function getPrefs(who: Pick<Me, 'id'>): Promise<Prefs> {
  const { data } = await createAdminClient().from('rpmail_prefs').select('data').eq('profile_id', who.id).maybeSingle()
  const d = (data?.data ?? {}) as Partial<Record<keyof Prefs, unknown>>
  return { hidden: ids(d.hidden), order: ids(d.order), undo_secs: undoSecs(d.undo_secs), notify: notifyPrefs(d.notify),
    sender_name: senderName(d.sender_name), default_from: one(d.default_from), start: one(d.start), density: d.density === 'compact' ? 'compact' : 'comfortable', tz: zone(d.tz), groups: groups(d.groups),
    lists_off: ids(d.lists_off) }
}

/** Save some of this person's settings; anything not named keeps its value. Only this person's own screen changes. */
export async function setPrefs(who: Me, p: Partial<Record<keyof Prefs, unknown>>) {
  const cur = await getPrefs(who)
  const next: Prefs = {
    hidden: p.hidden === undefined ? cur.hidden : ids(p.hidden), order: p.order === undefined ? cur.order : ids(p.order),
    undo_secs: p.undo_secs === undefined ? cur.undo_secs : undoSecs(p.undo_secs),
    notify: p.notify === undefined ? cur.notify : notifyPrefs(p.notify),
    sender_name: p.sender_name === undefined ? cur.sender_name : senderName(p.sender_name),
    default_from: p.default_from === undefined ? cur.default_from : one(p.default_from), start: p.start === undefined ? cur.start : one(p.start),
    density: p.density === undefined ? cur.density : p.density === 'compact' ? 'compact' : 'comfortable',
    tz: p.tz === undefined ? cur.tz : zone(p.tz), groups: p.groups === undefined ? cur.groups : groups(p.groups),
    lists_off: p.lists_off === undefined ? cur.lists_off : ids(p.lists_off),
  }
  const { error } = await createAdminClient().from('rpmail_prefs').upsert({ profile_id: who.id, data: next, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' })
  if (error) throw new Error('Could not save that.')
  return { ok: true, prefs: next }
}

// ── Time, in the person's own zone ────────────────────────────────────────────────────────────────────────────
/** How far the zone's clock is ahead of UTC at that moment, in milliseconds (negative in the Americas). */
export function zoneOffsetMs(tz: string, at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).map(x => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000
}
/** The moment a calendar day starts in a zone, as the database stores it. `plus` moves on that many days. */
export function dayStartIn(day: string, plus = 0, tz = DEFAULT_TZ): string {
  const [y, m, d] = day.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d + plus)
  let at = wall - zoneOffsetMs(tz, new Date(wall))
  at = wall - zoneOffsetMs(tz, new Date(at))   // again from the answer, for the two days a year the clocks change
  return new Date(at).toISOString()
}
/** The mailboxes that count toward this person's own lists: every mailbox they may open, minus the ones they left out. */
export const listMailboxes = <T extends { id: string }>(boxes: T[], prefs: Pick<Prefs, 'lists_off'>): T[] =>
  boxes.filter(b => !prefs.lists_off.includes(b.id))

/** Is `at` inside the person's quiet hours, by their own clock? A range may run past midnight (21:00 to 06:00). */
export function inQuietHours(n: Pick<NotifyPrefs, 'quiet_from' | 'quiet_to'>, at: Date, tz = DEFAULT_TZ): boolean {
  if (!n.quiet_from || !n.quiet_to || n.quiet_from === n.quiet_to) return false
  const now = at.toLocaleTimeString('en-GB', { timeZone: tz in ZONES ? tz : DEFAULT_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  return n.quiet_from < n.quiet_to ? now >= n.quiet_from && now < n.quiet_to : now >= n.quiet_from || now < n.quiet_to
}
/** The hour of the day (0 to 23) in a zone, right now or at `at`. */
export const hourIn = (tz: string, at = new Date()) => Number(at.toLocaleString('en-US', { timeZone: tz in ZONES ? tz : DEFAULT_TZ, hour: 'numeric', hour12: false })) % 24
