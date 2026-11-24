'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { api, NotifySheet, ZONE_NAMES, type Group, type Prefs, type State } from './rpmail-app'
import { RichEditor } from './rich-editor'
import { cleanRich, textToHtml } from '@/lib/rpmail/rich'

// RPMail -> Settings: everything a person sets for themselves, in one place. Each part saves on its own, and
// nothing here changes anything for anyone else.

const btn = (variant: 'default' | 'outline' | 'ghost' | 'destructive' = 'outline', size: 'sm' | 'xs' = 'sm') => buttonVariants({ variant, size })

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rp-card overflow-hidden">
      <div className="rp-card-head"><h2 className="rp-card-title">{title}</h2></div>
      <div className="px-5 py-4 space-y-3 text-sm">
        {hint && <p className="text-muted-foreground">{hint}</p>}
        {children}
      </div>
    </section>
  )
}

export function RpmailSettings() {
  const [st, setSt] = useState<State | null>(null)
  const [err, setErr] = useState(''), [note, setNote] = useState('')
  const [name, setName] = useState<string | null>(null)   // null until the person types: then it is their draft
  const [notify, setNotify] = useState(false)
  const [off, setOff] = useState(false)

  const load = useCallback((): Promise<void> => api<State>('state').then(s => { setSt(s); setErr('') }).catch(e => setErr((e as Error).message)), [])
  useEffect(() => { void load() }, [load])

  const save = async (patch: Partial<Prefs>, done = 'Saved.') => {
    setErr(''); setNote('')
    try {
      const r = await api<{ prefs: Prefs }>('prefs', patch as Record<string, unknown>)
      setSt(s => s ? { ...s, prefs: r.prefs } : s)
      setNote(done)
    } catch (e) { setErr((e as Error).message) }
  }

  if (!st) return <p className="text-sm text-muted-foreground">{err || 'Loading...'}</p>
  if (!st.enabled) return <p className="text-sm text-muted-foreground">RPMail is off for your login. <Link className="underline" href="/rpmail">Turn it on from the RPMail page.</Link></p>
  const p = st.prefs ?? { hidden: [], order: [] }
  const sendable = st.boxes.filter(b => b.connected && b.can_send)
  const shownName = name ?? p.sender_name ?? ''

  return (
    <div className="space-y-5">
      {err && <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{err}</p>}
      {note && <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success" role="status">{note}</p>}

      <Card title="Your name on mail you send" hint={`This is the name people see next to your address. Leave it empty to use your RP Intelligence name (${st.name || 'not set'}).`}>
        <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void save({ sender_name: shownName }, 'Name saved. It is used from your next message.').then(() => setName(null)) }}>
          <input className="rp-input !w-72" maxLength={60} placeholder={st.name} aria-label="Your name on mail you send" value={shownName} onChange={e => setName(e.target.value)} />
          <button className={btn('default')} type="submit">Save</button>
        </form>
      </Card>

      <Card title="Your mailboxes" hint="Each mailbox keeps its own signature. Pick the one New message starts from.">
        {!st.boxes.length && <p className="text-muted-foreground">You have no mailboxes yet. {st.note}</p>}
        {st.boxes.map(b => <BoxSettings key={b.id} box={b} isDefault={(p.default_from || sendable[0]?.id) === b.id} canDefault={b.connected && b.can_send} googleReady={st.googleReady}
          setDefault={() => void save({ default_from: b.id }, `New messages start from ${b.name}.`)} say={setNote} fail={setErr} />)}
      </Card>

      <ListBoxes boxes={st.boxes} off={p.lists_off ?? []} save={(next, msg) => save({ lists_off: next }, msg)} />

      <Card title="Sending">
        <label className="flex flex-wrap items-center gap-2">Time to change your mind after pressing Send
          <select className="rp-input !w-auto" value={p.undo_secs ?? 10} onChange={e => void save({ undo_secs: Number(e.target.value) })}>
            {[0, 5, 10, 20, 30].map(n => <option key={n} value={n}>{n ? `${n} seconds` : 'None (send at once)'}</option>)}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">During that time an Undo bar shows at the bottom of RPMail. Mail only ever goes out after you press Send and confirm.</p>
      </Card>

      <Card title="How RPMail looks and opens">
        <label className="flex flex-wrap items-center gap-2">Open RPMail on
          <select className="rp-input !w-auto" value={p.start && st.boxes.some(b => b.id === p.start) ? p.start : ''} onChange={e => void save({ start: e.target.value })}>
            <option value="">the Dashboard</option>
            {st.boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">Message lists
          {([['comfortable', 'Comfortable (with a preview line)'], ['compact', 'Compact (more on screen)']] as const).map(([v, l]) => (
            <label key={v} className="inline-flex items-center gap-1.5"><input type="radio" name="rp-density" className="size-4" checked={(p.density ?? 'comfortable') === v} onChange={() => void save({ density: v })} />{l}</label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Light and dark are for all of RP Intelligence: use the sun and moon buttons at the bottom of the menu on the left. To make the text bigger, use your browser&apos;s zoom.</p>
      </Card>

      <Card title="Time zone" hint="Used for your quiet hours, for the date filters, for the date on mail you reply to, and for when your morning summary is made.">
        <select className="rp-input !w-auto" aria-label="Your time zone" value={p.tz && p.tz in ZONE_NAMES ? p.tz : 'America/New_York'} onChange={e => void save({ tz: e.target.value }, 'Time zone saved.')}>
          {Object.entries(ZONE_NAMES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">Times on the screen always follow the clock of the phone or computer you are looking at.</p>
      </Card>

      <Card title="Notifications">
        <p>{p.notify?.on ? `On: ${p.notify.what === 'needs' ? 'only mail that asks you for something' : p.notify.what === 'all' ? 'every new message' : 'any mail from a person'}${p.notify.quiet_from && p.notify.quiet_to ? `, quiet from ${p.notify.quiet_from} to ${p.notify.quiet_to}` : ''}.` : 'Off.'}</p>
        <button className={btn()} onClick={() => setNotify(true)}>Change notifications</button>
      </Card>

      <Groups key={JSON.stringify(p.groups ?? [])} start={p.groups ?? []} save={g => save({ groups: g as unknown as Group[] }, 'Groups saved.')} />

      <Card title="More">
        <p className="text-muted-foreground">Labels, rules for new mail and blocked senders belong to a mailbox: open the mailbox and press <strong className="text-foreground">Labels and rules</strong>. Keyboard shortcuts: press <kbd className="rounded border border-border bg-raised px-1.5 text-xs">?</kbd> in RPMail.</p>
        {st.role === 'owner' && <p><Link className="underline" href="/settings/rpmail">Company settings for RPMail</Link> <span className="text-muted-foreground">(people, shared mailboxes, blocked content, activity).</span></p>}
        {!off ? <button className={btn('ghost')} onClick={() => setOff(true)}>Turn RPMail off for my login</button> : (
          <div className="rounded-md border border-border p-3 space-y-2">
            <p>Turn RPMail off? Your own mailbox is disconnected from RP Intelligence. Your mail in Gmail is not touched, and you can turn it back on any time.</p>
            <div className="flex gap-2">
              <button className={btn('destructive')} onClick={() => void api('enable', { on: false }).then(() => { window.location.href = '/rpmail' }).catch(e => setErr((e as Error).message))}>Turn it off</button>
              <button className={btn('ghost')} onClick={() => setOff(false)}>Keep it on</button>
            </div>
          </div>
        )}
      </Card>

      {notify && <NotifySheet start={p.notify} boxes={st.boxes} zone={ZONE_NAMES[p.tz ?? ''] ?? 'Eastern'} close={() => setNotify(false)} save={async n => { await save({ notify: n }, n.on ? 'Notifications are on.' : 'Notifications are off.'); setNotify(false) }} />}
    </div>
  )
}

/** One mailbox: its state, what this person may do in it, the default-send choice, and its signature. */
function BoxSettings({ box, isDefault, canDefault, googleReady, setDefault, say, fail }: { box: State['boxes'][number]; isDefault: boolean; canDefault: boolean; googleReady: boolean; setDefault: () => void; say: (t: string) => void; fail: (t: string) => void }) {
  // The signature is written with the same formatting bar as a message. `saved` is what the server holds, to know when Save has work to do.
  const [sig, setSig] = useState(() => ({ html: cleanRich(box.signature_html || textToHtml(box.signature)).html, text: box.signature }))
  const [saved, setSaved] = useState(sig.html)
  const [busy, setBusy] = useState(false)
  const may = box.kind === 'personal' ? 'Your own mailbox.' : !box.can_send ? 'Shared. You can read it; you cannot send from it or delete in it.' : !box.can_delete ? 'Shared. You can read it and send from it; you cannot delete in it.' : 'Shared. You can read, send and delete.'
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">{box.name} <span className="font-normal text-muted-foreground">{box.address}</span></p>
          <p className="text-xs text-muted-foreground">{box.connected ? 'Connected. ' : 'Signed out. '}{may}{box.crew_reads ? ' The crew reads this mailbox: no pricing.' : ''}{box.last_error ? ' Mail is not arriving: ' + box.last_error : ''}</p>
        </div>
        {googleReady && <a className={btn(box.connected ? 'ghost' : 'default', 'xs')} href={`/api/rpmail/connect?mailbox=${box.id}`}>{box.connected ? 'Sign in again' : 'Sign in with Google'}</a>}
      </div>
      {canDefault && <label className="flex items-center gap-2"><input type="radio" name="rp-default-from" className="size-4" checked={isDefault} onChange={setDefault} />New messages start from this mailbox</label>}
      {box.connected && box.can_send && (
        <div className="space-y-1.5">
          <p className="rp-label">Signature</p>
          <RichEditor initial={sig.html} short label={'Signature for ' + box.name} onChange={raw => { const c = cleanRich(raw); setSig({ html: c.html, text: c.text }) }} />
          <button className={btn('outline', 'xs')} type="button" disabled={busy || sig.html === saved}
            onClick={() => { setBusy(true); void api('signature', { mailbox: box.id, text: sig.text, html: sig.html }).then(() => { setSaved(sig.html); say(`Signature for ${box.name} saved.`) }).catch(x => fail((x as Error).message)).finally(() => setBusy(false)) }}>Save signature</button>
        </div>
      )}
    </div>
  )
}

/** Named lists of addresses. Typing a group's name in To or Cc offers it, and picking it adds everyone in it. */
function Groups({ start, save }: { start: Group[]; save: (g: { name: string; addrs: string[] | string }[]) => Promise<void> }) {
  const [rows, setRows] = useState(start.map(g => ({ name: g.name, addrs: g.addrs.join(', ') })))
  const [dirty, setDirty] = useState(false)
  const set = (i: number, patch: Partial<{ name: string; addrs: string }>) => { setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r)); setDirty(true) }
  return (
    <Card title="Address groups" hint="A group is a name for several addresses, for example Estimating team. In a new message, type the group name in To or Cc and pick it to add everyone in it.">
      {rows.map((r, i) => (
        <div key={i} className="rounded-md border border-border p-3 space-y-2">
          <div className="flex gap-2">
            <input className="rp-input !w-64" maxLength={40} placeholder="Group name" aria-label="Group name" value={r.name} onChange={e => set(i, { name: e.target.value })} />
            <button className={btn('ghost', 'xs')} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true) }}>Remove</button>
          </div>
          <textarea className="rp-input min-h-16" placeholder="Addresses, separated by commas" aria-label="Addresses in this group" value={r.addrs} onChange={e => set(i, { addrs: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn()} onClick={() => { setRows([...rows, { name: '', addrs: '' }]); setDirty(true) }}>Add a group</button>
        {dirty && <button className={btn('default')} onClick={() => void save(rows)}>Save groups</button>}
        {dirty && <span className="text-xs text-muted-foreground">Not saved yet. A group needs a name and at least one address that looks right; anything else is left out.</span>}
      </div>
    </Card>
  )
}

/** Which mailboxes count toward this person's own lists. Unticking one only changes their lists: they can still open
 *  and read it, nobody else is affected, and notifications have their own per-mailbox switch. */
function ListBoxes({ boxes, off, save }: { boxes: State['boxes']; off: string[]; save: (next: string[], msg: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  if (boxes.length < 2) return null
  const toggle = async (id: string, name: string, on: boolean) => {
    setBusy(true)
    const next = on ? off.filter(x => x !== id) : [...new Set([...off, id])]
    await save(next, on ? `${name} counts toward your lists again.` : `${name} is left out of your lists. You can still open it.`)
    setBusy(false)
  }
  return (
    <Card title="Mailboxes in my lists" hint="Pick which mailboxes count toward your Needs you and For you lists, the mail shown on your My Plate cards, and your morning summary. A mailbox you untick is still there to open and read; only your own lists change.">
      <div className="space-y-2">
        {boxes.map(b => {
          const on = !off.includes(b.id)
          return (
            <label key={b.id} className="flex items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 size-4" checked={on} disabled={busy} onChange={e => void toggle(b.id, b.name, e.target.checked)} />
              <span><span className="font-medium text-foreground">{b.name}</span> <span className="text-muted-foreground">{b.address}</span>
                {b.kind === 'shared' && <span className="block text-xs text-muted-foreground">Shared mailbox</span>}</span>
            </label>
          )
        })}
      </div>
      {off.length > 0 && <p className="text-xs text-muted-foreground">Left out: {boxes.filter(b => off.includes(b.id)).map(b => b.name).join(', ') || 'none'}. New-mail notifications are set separately under Notifications.</p>}
    </Card>
  )
}
