'use client'

import { useCallback, useEffect, useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from './rpmail-app'

type Shared = { id: string; address: string; name: string; crew_reads: boolean; connected: boolean; connected_at: string | null; last_error: string | null }
type Person = { id: string; name: string; email: string; role: string; locked: boolean; hasLocal: boolean; enabled: boolean; mail_address: string | null
  own: { address: string; connected: boolean } | null; shared: string[] }
type AdminState = { googleReady: boolean; shared: Shared[]; people: Person[] }

const SUGGESTED = [
  { address: 'econstruction.rp@gmail.com', name: 'Construction Dept', crew_reads: true },
  { address: 'const.inv.rp@gmail.com', name: 'Construction Invoices', crew_reads: false },
  { address: 'const.receipt.rp@gmail.com', name: 'Construction Receipts', crew_reads: false },
  { address: 'const.log.rp@gmail.com', name: 'Construction Truck Log', crew_reads: true },
]
const ROLE = (r: string) => r.replace(/_/g, ' ')

export function RpmailAdmin({ connected, connectError }: { connected?: string; connectError?: string }) {
  const [s, setS] = useState<AdminState | null>(null)
  const [err, setErr] = useState(connectError ?? ''), [note, setNote] = useState(connected ? 'Connected. The mailbox starts loading the first time someone who has it opens RPMail.' : '')
  const [add, setAdd] = useState({ address: '', name: '', crew_reads: false })
  const [showAll, setShowAll] = useState(false)

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
              {b.connected && <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} onClick={() => { if (window.confirm(`Disconnect ${b.address}? Everyone who has it loses it in RPMail until it is signed in again. Gmail itself is not touched.`)) void run(() => api('disconnect', { mailbox: b.id }), 'Disconnected.') }}>Disconnect</button>}
              <button className={buttonVariants({ variant: 'ghost', size: 'sm' })} onClick={() => { if (window.confirm(`Take ${b.address} out of RPMail for everyone? Gmail itself is not touched.`)) void run(() => api('admin_shared_delete', { id: b.id }), 'Removed.') }}>Remove</button>
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
                        <input type="checkbox" className="size-4" checked={on} disabled={blocked && !on}
                          title={blocked ? 'Tech and shop logins can only have mailboxes the crew reads' : on ? 'Take this mailbox away' : 'Give this mailbox'}
                          onChange={e => void run(() => api('admin_grant', { mailbox: b.id, profile: p.id, on: e.target.checked }), e.target.checked ? `${b.name} given to ${p.name}.` : `${b.name} taken from ${p.name}.`)} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-xs text-muted-foreground border-t border-hairline">A shared mailbox shows in someone&rsquo;s RPMail only once RPMail is on for them. Ticking a box never turns RPMail on by itself.</p>
      </section>
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
