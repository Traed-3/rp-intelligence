// Stand-ins for the two outside systems RPMail talks to, so the tests can prove behaviour without touching
// production data or a real mailbox:
//   * FakeDb   - an in-memory copy of the rpmail_* tables that answers the same calls the Supabase client gets.
//   * FakeGmail - an in-memory Gmail for several accounts, reached through a replaced global `fetch`. It records
//     every call with the account it was made as, which is how the tests show one mailbox's sign-in is never used
//     for another mailbox.
import { randomUUID } from 'node:crypto'

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean
const like = (v: unknown, pat: string) => new RegExp('^' + pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i').test(String(v ?? ''))
const cmp = (a: unknown, b: unknown) => (a == null && b == null ? 0 : a == null ? -1 : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0)

const SERIAL = new Set(['rpmail_moves', 'rpmail_sent'])
const UUID_PK = new Set(['rpmail_mailboxes', 'rpmail_templates', 'con_tasks', 'rpmail_rules'])
const DEFAULTS: Record<string, Row> = {
  rpmail_mailboxes: { crew_reads: false, token_secret_id: null, scope: null, connected_at: null, history_id: null, sync: {}, last_sync_at: null, last_error: null, owner_id: null, failing_since: null, fail_alerted_at: null, notify_mark: null },
  rpmail_moves: { undone: false },
  rpmail_messages: { unread: false, in_inbox: false, sent: false, starred: false, has_att: false, bulk: false, asks: false, labels: [] },
}

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  private filters: Filter[] = []
  private orders: [string, boolean][] = []
  private max: number | null = null
  private from = 0
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private payload: Row[] = []
  private patch: Row = {}
  private conflict: string[] = []
  private ignoreDup = false
  private one: 'maybe' | 'single' | null = null
  private head = false
  private wantCount = false
  private returning = false
  constructor(private db: FakeDb, private table: string) {}
  private rows() { return (this.db.tables[this.table] ??= []) }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (this.op !== 'select') this.returning = true; if (opts?.count) this.wantCount = true; if (opts?.head) this.head = true; return this }
  insert(v: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(v) ? v : [v]; return this }
  upsert(v: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.op = 'upsert'; this.payload = Array.isArray(v) ? v : [v]; this.conflict = (o?.onConflict ?? '').split(',').map(s => s.trim()).filter(Boolean); this.ignoreDup = !!o?.ignoreDuplicates; return this }
  update(v: Row) { this.op = 'update'; this.patch = v; return this }
  delete() { this.op = 'delete'; return this }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this }
  neq(c: string, v: unknown) { this.filters.push(r => r[c] !== v); return this }
  in(c: string, v: unknown[]) { this.filters.push(r => v.includes(r[c])); return this }
  gte(c: string, v: unknown) { this.filters.push(r => r[c] != null && cmp(r[c], v) >= 0); return this }   // like SQL: nothing compares to an empty value
  lt(c: string, v: unknown) { this.filters.push(r => r[c] != null && cmp(r[c], v) < 0); return this }
  ilike(c: string, pat: string) { this.filters.push(r => like(r[c], pat)); return this }
  contains(c: string, v: unknown[]) { this.filters.push(r => Array.isArray(r[c]) && v.every(x => (r[c] as unknown[]).includes(x))); return this }
  or(expr: string) {
    const parts = expr.split(',').map(p => { const [c, op, ...rest] = p.split('.'); return { c, op, v: rest.join('.') } })
    this.filters.push(r => parts.some(p => (p.op === 'ilike' ? like(r[p.c], p.v) : String(r[p.c]) === p.v)))
    return this
  }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this }
  limit(n: number) { this.max = n; return this }
  range(a: number, b: number) { this.from = a; this.max = b - a + 1; return this }
  maybeSingle() { this.one = 'maybe'; return this }
  single() { this.one = 'single'; return this }

  private run(): { data: unknown; error: { message: string } | null; count?: number } {
    const all = this.rows()
    const hit = (r: Row) => this.filters.every(f => f(r))
    let out: Row[] = []
    if (this.op === 'insert' || this.op === 'upsert') {
      for (const raw of this.payload) {
        const row: Row = { ...(DEFAULTS[this.table] ?? {}), ...raw }
        const existing = this.conflict.length ? all.find(r => this.conflict.every(k => r[k] === row[k])) : undefined
        if (existing) { if (!this.ignoreDup) { Object.assign(existing, raw); out.push(existing) } continue }
        if (this.op === 'insert' && this.table === 'rpmail_mailboxes' && all.some(r => r.address === row.address)) return { data: null, error: { message: 'duplicate address' } }
        if (SERIAL.has(this.table)) row.id = ++this.db.serial
        else if (UUID_PK.has(this.table) && !row.id) row.id = randomUUID()
        row.created_at ??= new Date().toISOString()
        all.push(row); out.push(row)
      }
    } else if (this.op === 'update') {
      out = all.filter(hit); for (const r of out) Object.assign(r, this.patch)
    } else if (this.op === 'delete') {
      out = all.filter(hit); this.db.tables[this.table] = all.filter(r => !hit(r))
      // The real database removes what hangs off a mailbox when the mailbox goes.
      if (this.table === 'rpmail_mailboxes') for (const t of ['rpmail_access', 'rpmail_messages', 'rpmail_done', 'rpmail_moves', 'rpmail_blocks', 'rpmail_snoozes', 'rpmail_rules']) this.db.tables[t] = (this.db.tables[t] ?? []).filter(r => !out.some(b => b.id === r.mailbox_id))
    } else {
      out = all.filter(hit)
      for (const [c, asc] of [...this.orders].reverse()) out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[c], b[c]))
    }
    const count = out.length
    if (this.op === 'select') out = out.slice(this.from, this.max == null ? undefined : this.from + this.max)
    const copy = out.map(r => structuredClone(r))
    if (this.head) return { data: null, error: null, count }
    if (this.one) return copy.length ? { data: copy[0], error: null } : { data: null, error: this.one === 'single' ? { message: 'no rows' } : null }
    return { data: this.op === 'select' || this.returning ? copy : null, error: null, ...(this.wantCount ? { count } : {}) }
  }
  then<A, B>(ok?: ((v: { data: unknown; error: { message: string } | null; count?: number }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }
}

export class FakeDb {
  tables: Record<string, Row[]> = {}
  serial = 0
  vault = new Map<string, string>()            // mailbox id -> refresh token (stands in for Supabase Vault)
  files = new Map<string, { data: Buffer; type: string }>()   // the rpmail-outbox bucket
  stale = new Set<string>()                    // outbox paths the database would call older than two days
  client = {
    from: (t: string) => new Query(this, t),
    rpc: (name: string, a: Record<string, unknown>) => Promise.resolve(this.rpc(name, a)),
    storage: { from: () => ({
      createSignedUploadUrl: async (path: string) => ({ data: { token: 'tok', path }, error: null }),
      download: async (path: string) => { const f = this.files.get(path); return f ? { data: new Blob([new Uint8Array(f.data)], { type: f.type }), error: null } : { data: null, error: { message: 'not found' } } },
      remove: async (paths: string[]) => { for (const p of paths) this.files.delete(p); return { data: null, error: null } },
    }) },
  }
  t(name: string) { return (this.tables[name] ??= []) }
  private allowed(profile: string, box: string) {
    const p = this.t('profiles').find(x => x.id === profile), b = this.t('rpmail_mailboxes').find(x => x.id === box)
    return !!p && !!b && this.t('rpmail_access').some(a => a.profile_id === profile && a.mailbox_id === box) && p.company_id === b.company_id
      && (b.kind === 'personal' || !!b.crew_reads || !['service_tech', 'construction_tech', 'mechanic', 'shop_employee'].includes(String(p.role ?? '')))
  }
  private rpc(name: string, a: Record<string, unknown>): { data: unknown; error: null } {
    const box = this.t('rpmail_mailboxes').find(b => b.id === a.p_mailbox)
    if (name === 'rpmail_token_get') return { data: this.vault.get(String(a.p_mailbox)) ?? null, error: null }
    if (name === 'rpmail_token_set') { this.vault.set(String(a.p_mailbox), String(a.p_token)); if (box) box.token_secret_id = randomUUID(); return { data: null, error: null } }
    if (name === 'rpmail_token_clear') {
      this.vault.delete(String(a.p_mailbox))
      if (box) Object.assign(box, { token_secret_id: null, scope: null, connected_at: null, history_id: null, sync: {}, last_error: null })
      this.tables.rpmail_messages = this.t('rpmail_messages').filter(m => m.mailbox_id !== a.p_mailbox)
      return { data: null, error: null }
    }
    if (name === 'sync_token_ok') return { data: a.t === 'the-vault-token', error: null }
    if (name === 'rpmail_label_set' || name === 'rpmail_label_drop') {
      for (const m of this.t('rpmail_messages')) {
        if (m.mailbox_id !== a.p_mailbox || (name === 'rpmail_label_set' && m.thread_id !== a.p_thread)) continue
        const cur = ((m.labels as string[] | undefined) ?? []).filter(l => l !== a.p_label)
        m.labels = name === 'rpmail_label_set' && a.p_on ? [...cur, a.p_label] : cur
      }
      return { data: null, error: null }
    }
    if (name === 'rpmail_outbox_stale') return { data: [...this.files.keys()].filter(k => this.stale.has(k)), error: null }
    const mine = this.t('rpmail_messages').filter(m => this.allowed(String(a.p_profile), String(m.mailbox_id)))
    if (name === 'rpmail_counts') {
      const by = new Map<string, { mailbox_id: string; inbox: number; unread: number; newest: string | null }>()
      for (const m of mine.filter(m => m.in_inbox)) {
        const c = by.get(String(m.mailbox_id)) ?? { mailbox_id: String(m.mailbox_id), inbox: 0, unread: 0, newest: null }
        c.inbox++; if (m.unread) c.unread++; if (!c.newest || String(m.date) > c.newest) c.newest = String(m.date)
        by.set(c.mailbox_id, c)
      }
      return { data: [...by.values()], error: null }
    }
    if (name === 'rpmail_needs') {
      const addr = (id: unknown) => String(this.t('rpmail_mailboxes').find(b => b.id === id)?.address ?? '')
      const rows = mine.filter(m => (!a.p_mailbox || m.mailbox_id === a.p_mailbox) && m.in_inbox && !m.sent && !m.bulk && String(m.from_addr ?? '').toLowerCase() !== addr(m.mailbox_id)
        && !mine.some(s => s.mailbox_id === m.mailbox_id && s.thread_id === m.thread_id && String(s.date) > String(m.date) && (s.sent || String(s.from_addr ?? '').toLowerCase() === addr(m.mailbox_id)))
        && !this.t('rpmail_done').some(d => d.profile_id === a.p_profile && d.mailbox_id === m.mailbox_id && d.gmail_id === m.gmail_id))
      return { data: rows.sort((x, y) => cmp(y.date, x.date)).slice(0, Number(a.p_limit ?? 80)).map(r => structuredClone(r)), error: null }
    }
    throw new Error('FakeDb: no such function ' + name)
  }
}

// ── Gmail ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type FakeMsg = { id: string; threadId: string; labelIds: string[]; from: string; to: string; cc?: string; subject: string; body: string; date: number; html?: string
  files?: { name: string; type: string; data: Buffer }[]; headers?: Record<string, string> }
export type GCall = { account: string; method: string; path: string }
export type SentMail = { account: string; raw: string; threadId?: string; draft: boolean }

export class FakeGmail {
  boxes = new Map<string, FakeMsg[]>()      // address -> messages
  labels = new Map<string, { id: string; name: string; type: string }[]>()   // address -> the labels people made
  fresh = new Map<string, string[]>()      // address -> messages that arrived or changed since the mailbox was last looked at
  calls: GCall[] = []
  sent: SentMail[] = []
  revoked = new Set<string>()              // addresses whose sign-in Google has ended
  metadataReads = 0
  private n = 0
  add(address: string, m: Partial<FakeMsg> & { from: string; subject: string }): FakeMsg {
    const id = (++this.n).toString(16).padStart(16, '0')
    const msg: FakeMsg = { id, threadId: m.threadId ?? id, labelIds: m.labelIds ?? ['INBOX', 'UNREAD'], to: address, body: 'Hello', date: Date.now() - 3_600_000 + this.n * 1000, ...m }
    const list = this.boxes.get(address) ?? []; list.push(msg); this.boxes.set(address, list)
    this.fresh.set(address, [...(this.fresh.get(address) ?? []), id])
    return msg
  }
  addLabel(address: string, name: string) {
    const all = this.labels.get(address) ?? []
    const l = { id: 'Label_' + (all.length + 1), name, type: 'user' }
    this.labels.set(address, [...all, l])
    return l
  }
  get(address: string, id: string) { return (this.boxes.get(address) ?? []).find(m => m.id === id) }
  private full(m: FakeMsg) {
    const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url')
    const headers = [['From', m.from], ['To', m.to], ['Subject', m.subject], ['Message-ID', `<${m.id}@fake>`], ...(m.cc ? [['Cc', m.cc]] : []), ...Object.entries(m.headers ?? {})].map(([name, value]) => ({ name, value }))
    const text = { partId: '0', mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }], body: { size: m.body.length, data: b64(m.body) } }
    const html = m.html ? [{ partId: '0.1', mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: { size: m.html.length, data: b64(m.html) } }] : []
    const files = (m.files ?? []).map((f, i) => ({ partId: String(i + 1), mimeType: f.type, filename: f.name, headers: [{ name: 'Content-Disposition', value: 'attachment' }], body: { size: f.data.length, attachmentId: `att${i}` } }))
    return { id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: m.body.slice(0, 100), internalDate: String(m.date), historyId: '100',
      payload: { mimeType: 'multipart/mixed', headers, parts: [text, ...html, ...files] } }
  }
  /** Answers one Gmail API request made as `account`. */
  handle(account: string, method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | null): { status: number; json: unknown } {
    this.calls.push({ account, method, path })
    const list = this.boxes.get(account) ?? []
    const ok = (json: unknown) => ({ status: 200, json })
    const labels = (ms: FakeMsg[]) => { for (const m of ms) { m.labelIds = [...new Set([...m.labelIds.filter(l => !((body?.removeLabelIds as string[] | undefined) ?? []).includes(l)), ...((body?.addLabelIds as string[] | undefined) ?? [])])] } }
    let m: RegExpMatchArray | null
    if (path === 'profile') { this.fresh.set(account, []); return ok({ emailAddress: account, historyId: '100' }) }
    if (path === 'labels' && method === 'GET') return ok({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, ...(this.labels.get(account) ?? [])] })
    if (path === 'labels' && method === 'POST') {
      if ((this.labels.get(account) ?? []).some(l => l.name.toLowerCase() === String(body?.name).toLowerCase())) return { status: 409, json: { error: { message: 'Label name exists or conflicts' } } }
      return ok(this.addLabel(account, String(body?.name)))
    }
    if ((m = path.match(/^labels\/(Label_[\w-]+)$/))) {
      const all = this.labels.get(account) ?? [], l = all.find(x => x.id === m![1])
      if (!l) return { status: 404, json: {} }
      if (method === 'PATCH') { l.name = String(body?.name); return ok(l) }
      if (method === 'DELETE') { this.labels.set(account, all.filter(x => x !== l)); for (const x of list) x.labelIds = x.labelIds.filter(i => i !== l.id); return { status: 204, json: null } }
    }
    if (path === 'messages' && method === 'GET') {
      const q = query.get('q') ?? ''
      const vis = list.filter(x => !x.labelIds.some(l => l === 'TRASH' || l === 'SPAM'))
      const hit = q.includes('in:inbox') ? vis.filter(x => x.labelIds.includes('INBOX')) : /newer_than|^$/.test(q) ? vis : vis.filter(x => (x.subject + ' ' + x.body + ' ' + x.from).toLowerCase().includes(q.toLowerCase()))
      return ok({ messages: hit.map(x => ({ id: x.id })) })
    }
    if (path === 'history') {
      const ids = this.fresh.get(account) ?? []
      this.fresh.set(account, [])
      return ok({ history: ids.length ? [{ messages: ids.map(id => ({ id })) }] : [], historyId: '100' })
    }
    if (path === 'messages/send' || path === 'drafts') {
      const msg = (path === 'drafts' ? (body?.message as Record<string, unknown>) : body) ?? {}
      this.sent.push({ account, raw: Buffer.from(String(msg.raw), 'base64url').toString('utf8'), threadId: msg.threadId as string | undefined, draft: path === 'drafts' })
      if (path === 'drafts') return ok({ id: 'draft1' })
      const made = this.add(account, { from: account, to: 'someone@example.com', subject: 'sent', labelIds: ['SENT'], threadId: msg.threadId as string | undefined })
      return ok({ id: made.id, threadId: made.threadId })
    }
    if ((m = path.match(/^messages\/([0-9a-f]+)$/))) {
      const x = list.find(y => y.id === m![1]); if (!x) return { status: 404, json: {} }
      const full = this.full(x)
      if (query.get('format') !== 'metadata') return ok(full)
      // Headers only, as Gmail does for format=metadata: no parts, no text. A message with files says so in Content-Type.
      this.metadataReads++
      return ok({ ...full, payload: { headers: [...full.payload.headers, { name: 'Content-Type', value: x.files?.length ? 'multipart/mixed; boundary=x' : 'multipart/alternative; boundary=x' }] } })
    }
    if ((m = path.match(/^messages\/([0-9a-f]+)\/trash$/))) { const x = list.find(y => y.id === m![1]); if (!x) return { status: 404, json: {} }; x.labelIds = [...x.labelIds.filter(l => l !== 'INBOX'), 'TRASH']; return ok({}) }
    if ((m = path.match(/^messages\/([0-9a-f]+)\/modify$/))) { const x = list.find(y => y.id === m![1]); if (!x) return { status: 404, json: {} }; labels([x]); return ok({}) }
    if ((m = path.match(/^messages\/([0-9a-f]+)\/attachments\/att(\d+)$/))) { const f = list.find(y => y.id === m![1])?.files?.[Number(m[2])]; return f ? ok({ data: f.data.toString('base64url') }) : { status: 404, json: {} } }
    if ((m = path.match(/^threads\/([0-9a-f]+)(\/(modify|trash|untrash))?$/))) {
      const th = list.filter(y => y.threadId === m![1])
      if (!th.length) return { status: 404, json: {} }
      if (!m[3]) return ok({ messages: th.filter(y => !y.labelIds.includes('TRASH')).map(y => ({ id: y.id })) })
      if (m[3] === 'modify') labels(th)
      if (m[3] === 'trash') for (const y of th) y.labelIds = [...y.labelIds.filter(l => l !== 'INBOX'), 'TRASH']
      if (m[3] === 'untrash') for (const y of th) y.labelIds = y.labelIds.filter(l => l !== 'TRASH')
      return ok({})
    }
    return { status: 400, json: { error: { message: 'FakeGmail: unhandled ' + method + ' ' + path } } }
  }
  /** Replacement for global fetch: Google's token endpoint and the Gmail API. Anything else is an error. */
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const f = new URLSearchParams(String(init?.body ?? ''))
      const acct = (f.get('refresh_token') ?? '').replace(/^refresh:/, '')
      if (!acct || this.revoked.has(acct)) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      return json(200, { access_token: 'access:' + acct, expires_in: 3600 })
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') return json(200, {})
    if (url.host === 'gmail.googleapis.com') {
      const acct = String(new Headers(init?.headers).get('Authorization') ?? '').replace(/^Bearer access:/, '')
      if (!acct || this.revoked.has(acct)) return json(401, { error: { message: 'Invalid Credentials' } })
      const path = url.pathname.replace('/gmail/v1/users/me/', '')
      const r = this.handle(acct, init?.method ?? 'GET', path, url.searchParams, init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null)
      return r.status === 204 ? new Response(null, { status: 204 }) : json(r.status, r.json)
    }
    throw new Error('A test tried to reach the internet: ' + url.host)
  }
}

// ── A small world to test in ──────────────────────────────────────────────────────────────────────────────────
export const world = { db: new FakeDb(), gmail: new FakeGmail(), user: null as string | null }

export type Person = { id: string; company_id: string; role: string; full_name: string; email: string }
export function addPerson(company: string, role: string, name: string, email: string, on = true): Person {
  const p = { id: randomUUID(), company_id: company, role, full_name: name, email, is_active: true }
  world.db.t('profiles').push(p)
  if (on) world.db.t('rpmail_users').push({ profile_id: p.id, enabled: true, mail_address: null })
  return p
}
/** A connected mailbox with a working stand-in Google sign-in, given to `people`. */
export function addBox(company: string, address: string, kind: 'personal' | 'shared', people: Person[], extra: Row = {}): string {
  const id = randomUUID()
  world.db.t('rpmail_mailboxes').push({ ...DEFAULTS.rpmail_mailboxes, id, company_id: company, address, name: address.split('@')[0], kind, owner_id: kind === 'personal' ? people[0].id : null, token_secret_id: randomUUID(), scope: 'modify', connected_at: new Date().toISOString(), ...extra })
  world.db.vault.set(id, 'refresh:' + address)
  for (const p of people) world.db.t('rpmail_access').push({ mailbox_id: id, profile_id: p.id, granted_by: p.id })
  return id
}
export const signInAs = (p: Person | null) => { world.user = p?.id ?? null }
