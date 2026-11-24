'use client'

import { useCallback, useEffect, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from './rpmail-app'
import { useAsk } from './ask'
import { IS_DEMO } from '@/lib/demo'

type Shared = { id: string; address: string; name: string; crew_reads: boolean; connected: boolean; connected_at: string | null; last_error: string | null }
type Person = { id: string; name: string; email: string; role: string; locked: boolean; hasLocal: boolean; enabled: boolean; mail_address: string | null
  own: { address: string; connected: boolean } | null; shared: string[]; levels: Record<string, Level> }
type Level = 'read' | 'send' | 'full'
type ContentRule = { id?: string; name: string; words: string[] | string; scope: 'crew' | 'all'; on: boolean }
type AdminState = { googleReady: boolean; shared: Shared[]; people: Person[]; content: ContentRule[] }
type Line = { id: number; at: number; kind: string; what: string; who: string; mailbox: string; about: string; detail: string }
const LEVELS: [Level, string][] = [['read', 'Read only'], ['send', 'Read and send'], ['full', 'Read, send, delete']]

const SUGGESTED_REAL = [
  { address: 'econstruction.rp@gmail.com', name: 'Construction Dept', crew_reads: true },
  { address: 'const.inv.rp@gmail.com', name: 'Construction Invoices', crew_reads: false },
  { address: 'const.receipt.rp@gmail.com', name: 'Construction Receipts', crew_reads: false },
  { address: 'const.log.rp@gmail.com', name: 'Construction Truck Log', crew_reads: true },
]
const SUGGESTED = IS_DEMO
  ? SUGGESTED_REAL.map(s => ({ ...s, address: s.address.replace(/\.rp@gmail\.com$/, '@demo.rpintelligence.app') }))
  : SUGGESTED_REAL
const ROLE = (r: string) => r.replace(/_/g, ' ')

export function RpmailAdmin({ connected, connectError }: { connected?: string; connectError?: string }) {
  const [s, setS] = useState<AdminState | null>(null)
  const [err, setErr] = useState(connectError ?? ''), [note, setNote] = useState(connected ? 'Connected. The mailbox starts loading the first time someone who has it opens RPMail.' : '')
  const [add, setAdd] = useState({ address: '', name: '', crew_reads: false })
  const [showAll, setShowAll] = useState(false)
  const [ask, asking] = useAsk()

  const load = useCallback((): Promise<void> => api<AdminState>('admin_state').then(r => { setS(r); setErr('') }).catch(e => setErr((e as Error).message)), [])
  useEffect(() => {
    void load()
    if (connected || connectError) window.history.replaceState(null, '', '/settings/rpmail')
  }, [load, connected, connectError])

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setErr(''); setNote('')
    try { const r = await fn() as { removed?: number }; await load(); if (done) setNote(done + (r?.removed ? ` ${r.removed} tech or shop login(s) lost access to it.` : '')) } catch (e) { setErr((e as Error).message) }
  }

  if (!s) return <p className="text-sm text-muted-foreground">{err || 'Loading...'}</p>
  const people = showAll ? s.people : s.people.filter(p => p.enabled || p.shared.length || !p.locked)
  const missing = SUGGESTED.filter(x => !s.shared.some(b => b.address === x.address))

  return (
    <div className="space-y-5">
      {asking}
      <div className="rounded-xl border border-info/30 bg-info-soft px-5 py-4 text-sm text-foreground space-y-1">
        <p className="font-semibold">How RPMail works for staff</p>
        <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
          <li>It is optional. Nobody has it until it is turned on, by the person on their own RPMail page or by you here.</li>
          <li>Each person connects their own Gmail with &ldquo;Sign in with Google&rdquo;. Only that person can open it.</li>
          <li>Shared mailboxes are ticked here, one person at a time. Tech and shop logins can only be given a mailbox marked &ldquo;the crew reads this&rdquo;; the others carry customer pricing.</li>
          <li>Pricing can never be sent to or from a mailbox marked &ldquo;the crew reads this&rdquo;.</li>
        </ul>
      </div>
      {!s.googleReady && <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">Sign in with Google is not switched on yet (the Google Cloud sign-in key is not in Vercel). People can turn RPMail on, but nobody can connect a mailbox until it is.</p>}
      {err && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
      {note && <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">{note}</p>}

      <section className="rp-card overflow-hidden">
        <div className="rp-card-head"><h2 className="rp-card-title">Shared mailboxes</h2></div>
        <div className="divide-y divide-hairline">
          {!s.shared.length && <p className="px-5 py-4 text-sm text-muted-foreground">None yet. Add them below.</p>}
          {s.shared.map(b => (
            <div key={b.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm text-foreground">{b.name} <span className="font-normal text-muted-foreground">{b.address}</span></p>
                <p className="text-xs text-muted-foreground">{b.connected ? 'Connected' + (b.connected_at ? ' ' + new Date(b.connected_at).toLocaleDateString('en-US') : '') : 'Not connected yet'}{b.last_error ? ' · ' + b.last_error : ''}</p>
              </div>
              <label className="text-xs inline-flex items-center gap-1.5"><input type="checkbox" checked={b.crew_reads} onChange={e => void run(() => api('admin_shared', { id: b.id, name: b.name, crew_reads: e.target.checked }), 'Saved.')} />The crew reads this (no pricing)</label>
              {s.googleReady && <a className={buttonVariants({ variant: b.connected ? 'outline' : 'default', size: 'sm' })} href={`/api/rpmail/connect?mailbox=${b.id}`}>{b.connected ? 'Sign in again' : 'Sign in with Google'}</a>}
              {b.connected && <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} onClick={() => void ask({ text: `Disconnect ${b.address}? Everyone who has it loses it in RPMail until it is signed in again. Gmail itself is not touched.`, yes: 'Disconnect' }).then(ok => { if (ok) void run(() => api('disconnect', { mailbox: b.id }), 'Disconnected.') })}>Disconnect</button>}
              <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} onClick={() => void ask({ text: `Take ${b.address} out of RPMail for everyone? Gmail itself is not touched.`, yes: 'Remove', danger: true }).then(ok => { if (ok) void run(() => api('admin_shared_delete', { id: b.id }), 'Removed.') })}>Remove</button>
            </div>
          ))}
        </div>
        <div className="border-t border-hairline px-5 py-3 space-y-2">
          {missing.length > 0 && <div className="flex flex-wrap gap-1.5 items-center text-xs text-muted-foreground">Add:{missing.map(x => <button key={x.address} className="rp-chip" onClick={() => void run(() => api('admin_shared', x), `${x.name} added.`)}>{x.name}</button>)}</div>}
          <form className="flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); void run(() => api('admin_shared', add), 'Added.').then(() => setAdd({ address: '', name: '', crew_reads: false })) }}>
            <input className="rp-input !w-64" placeholder="mailbox@gmail.com" value={add.address} onChange={e => setAdd({ ...add, address: e.target.value })} />
            <input className="rp-input !w-48" placeholder="Name, e.g. Shop Tasks" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
            <label className="text-xs inline-flex items-center gap-1.5"><input type="checkbox" checked={add.crew_reads} onChange={e => setAdd({ ...add, crew_reads: e.target.checked })} />The crew reads this</label>
            <button className={buttonVariants({ variant: 'outline', size: 'sm' })} type="submit">Add mailbox</button>
          </form>
        </div>
      </section>

      <section className="rp-card overflow-hidden">
        <div className="rp-card-head">
          <h2 className="rp-card-title">People</h2>
          <label className="text-xs inline-flex items-center gap-1.5"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />Show tech and shop logins too</label>
        </div>
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>
                <th className="text-left px-4 py-2">Person</th>
                <th className="text-left px-3 py-2">RPMail</th>
                <th className="text-left px-3 py-2">Own mailbox</th>
                {s.shared.map(b => <th key={b.id} className="px-2 py-2 text-center" title={b.address}>{b.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2"><p className="font-medium text-foreground">{p.name || p.email}</p><p className="text-xs text-muted-foreground">{p.email} · {ROLE(p.role)}{p.hasLocal ? ' · has own RPMail on their Mac' : ''}</p></td>
                  <td className="px-3 py-2">
                    <button className={cn('rp-chip', p.enabled && '!bg-success !border-success !text-white')} onClick={() => void run(() => api('admin_user', { profile: p.id, enabled: !p.enabled }), p.enabled ? `RPMail turned off for ${p.name}.` : `RPMail turned on for ${p.name}. They connect their own Gmail from the RPMail page.`)}>{p.enabled ? 'On' : 'Off'}</button>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <MailAddress p={p} save={v => void run(() => api('admin_user', { profile: p.id, mail_address: v }), 'Saved.')} />
                  </td>
                  {s.shared.map(b => {
                    const on = p.shared.includes(b.id), blocked = p.locked && !b.crew_reads
                    return (
                      <td key={b.id} className="px-2 py-2 text-center">
                        <select className="rp-input !w-auto !py-1 !text-xs" aria-label={`${b.name} for ${p.name || p.email}`} value={on ? p.levels?.[b.id] ?? 'full' : ''} disabled={(blocked && !on) || (on && p.role === 'owner')}
                          title={blocked ? 'Tech and shop logins can only have mailboxes the crew reads' : p.role === 'owner' && on ? 'An owner can always do everything in a mailbox they have' : 'What this person may do in this mailbox'}
                          onChange={e => { const v = e.target.value as Level | ''; void run(() => api('admin_grant', v ? { mailbox: b.id, profile: p.id, level: v } : { mailbox: b.id, profile: p.id, on: false }),
                            v ? `${p.name}: ${LEVELS.find(l => l[0] === v)![1].toLowerCase()} in ${b.name}.` : `${b.name} taken from ${p.name}.`) }}>
                          <option value="">No access</option>
                          {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground border-t border-hairline">A shared mailbox shows in someone&rsquo;s RPMail only once RPMail is on for them. Giving a mailbox never turns RPMail on by itself. &ldquo;Delete&rdquo; means moving mail to Trash or Spam; nobody can delete mail for good from RPMail.</p>
      </section>

      <ContentRules key={JSON.stringify(s.content)} start={s.content} save={rules => run(() => api('admin_content_save', { rules }), 'Blocked-content rules saved.')} />
      <Activity people={s.people} />
    </div>
  )
}

function MailAddress({ p, save }: { p: Person; save: (v: string) => void }) {
  const [edit, setEdit] = useState(false), [v, setV] = useState(p.mail_address ?? '')
  const address = p.own?.address ?? p.mail_address ?? (/@(gmail|googlemail)\.com$/i.test(p.email) ? p.email : null)
  if (edit) return (
    <form className="flex gap-1" onSubmit={e => { e.preventDefault(); save(v); setEdit(false) }}>
      <input className="rp-input !py-1 !w-48" value={v} onChange={e => setV(e.target.value)} placeholder="their.name@gmail.com" autoFocus />
      <button className={buttonVariants({ variant: 'outline', size: 'xs' })} type="submit">Save</button>
    </form>
  )
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={p.own?.connected ? 'text-success' : 'text-muted-foreground'}>{address ? address + (p.own ? (p.own.connected ? ' · connected' : ' · not connected') : '') : 'Login is not a Gmail address'}</span>
      <button className="underline text-muted-foreground" onClick={() => setEdit(true)}>change</button>
    </span>
  )
}

/** The rules about what may not be sent: the one that is built in, and the ones this company writes for itself. */
function ContentRules({ start, save }: { start: ContentRule[]; save: (rules: ContentRule[]) => Promise<void> }) {
  const [rules, setRules] = useState<ContentRule[]>(start.map(r => ({ ...r, words: Array.isArray(r.words) ? r.words.join(', ') : r.words })))
  const [dirty, setDirty] = useState(false)
  const set = (i: number, patch: Partial<ContentRule>) => { setRules(rules.map((r, j) => j === i ? { ...r, ...patch } : r)); setDirty(true) }
  return (
    <section className="rp-card overflow-hidden">
      <div className="rp-card-head"><h2 className="rp-card-title">Blocked content</h2></div>
      <div className="px-5 py-4 space-y-3 text-sm">
        <p className="rounded-md border border-border bg-raised px-3 py-2 text-muted-foreground"><span className="font-semibold text-foreground">Always on: customer pricing.</span> A message that mentions pricing cannot be sent to or from a mailbox marked &ldquo;the crew reads this&rdquo;. This rule is built in and cannot be switched off.</p>
        <p className="text-muted-foreground">Add your own. RPMail checks the subject, the message, the quoted mail under a reply and the names of attached files, and refuses to send if it finds one of your words or phrases. Whole words only, upper or lower case.</p>
        {rules.map((r, i) => (
          <div key={r.id ?? 'new' + i} className="rounded-md border border-border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input className="rp-input !w-56" placeholder="Rule name, e.g. Margins" aria-label="Rule name" maxLength={60} value={r.name} onChange={e => set(i, { name: e.target.value })} />
              <select className="rp-input !w-auto" aria-label="Where the rule applies" value={r.scope} onChange={e => set(i, { scope: e.target.value as ContentRule['scope'] })}>
                <option value="crew">Not to or from a mailbox the crew reads</option>
                <option value="all">Not in any mail sent from RPMail</option>
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" className="size-4" checked={r.on} onChange={e => set(i, { on: e.target.checked })} />On</label>
              <button className={buttonVariants({ variant: 'ghost', size: 'xs' })} onClick={() => { setRules(rules.filter((_, j) => j !== i)); setDirty(true) }}>Remove</button>
            </div>
            <textarea className="rp-input min-h-16" placeholder="Words or phrases to block, separated by commas: margin, our cost, markup" aria-label="Words or phrases to block" value={r.words as string} onChange={e => set(i, { words: e.target.value })} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => { setRules([...rules, { name: '', words: '', scope: 'crew', on: true }]); setDirty(true) }}>Add a rule</button>
          {dirty && <button className={buttonVariants({ variant: 'default', size: 'sm' })} onClick={() => void save(rules)}>Save rules</button>}
          {dirty && <span className="text-xs text-muted-foreground">Not saved yet.</span>}
        </div>
      </div>
    </section>
  )
}

/** Who did what, newest first, with a spreadsheet download. No message text is ever in it. */
function Activity({ people }: { people: Person[] }) {
  const [kind, setKind] = useState(''), [person, setPerson] = useState('')
  const [rows, setRows] = useState<Line[] | null>(null), [more, setMore] = useState(false), [err, setErr] = useState('')
  const load = useCallback((before?: number) => api<{ rows: Line[]; more: boolean }>('admin_activity', undefined, { kind, person, ...(before ? { before: String(before) } : {}) })
    .then(r => { setRows(old => before && old ? [...old, ...r.rows] : r.rows); setMore(r.more); setErr('') })
    .catch(e => setErr((e as Error).message)), [kind, person])
  useEffect(() => { void load() }, [load])
  const when = (ms: number) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <section className="rp-card overflow-hidden">
      <div className="rp-card-head flex-wrap gap-2">
        <h2 className="rp-card-title">Activity</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rp-input !w-auto !py-1 !text-xs" aria-label="What kind of activity" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">Everything</option><option value="mail">Mail sent, deleted or blocked</option><option value="access">Sign-ins and who can do what</option><option value="setup">Rules, labels and blocked senders</option>
          </select>
          <select className="rp-input !w-auto !py-1 !text-xs" aria-label="Whose activity" value={person} onChange={e => setPerson(e.target.value)}>
            <option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name || p.email}</option>)}
          </select>
          <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/api/rpmail/admin_activity_export?kind=${kind}&person=${person}`}>Download as a spreadsheet</a>
        </div>
      </div>
      {err && <p className="px-5 py-3 text-sm text-danger">{err}</p>}
      {rows === null && !err && <p className="px-5 py-4 text-sm text-muted-foreground">Loading...</p>}
      {rows && !rows.length && <p className="px-5 py-4 text-sm text-muted-foreground">Nothing yet. Sends, deletes, mailbox sign-ins and every change to who can do what show up here.</p>}
      {rows && rows.length > 0 && (
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr><th className="text-left px-4 py-2">When</th><th className="text-left px-3 py-2">Who</th><th className="text-left px-3 py-2">What</th><th className="text-left px-3 py-2">Mailbox</th><th className="text-left px-3 py-2">Detail</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">{when(r.at)}</td>
                  <td className="px-3 py-2">{r.who}</td>
                  <td className="px-3 py-2">{r.what}{r.about ? ` (${r.about})` : ''}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.mailbox}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[28rem] truncate" title={r.detail}>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-hairline text-xs text-muted-foreground">
        <span>Kept for about 13 months. It holds subject lines and addresses, never the text of a message. Signing in to RP Intelligence itself is not listed here; mailbox sign-ins with Google are.</span>
        {more && rows && <button className={buttonVariants({ variant: 'ghost', size: 'xs' })} onClick={() => void load(rows[rows.length - 1].id)}>Older</button>}
      </div>
    </section>
  )
}
