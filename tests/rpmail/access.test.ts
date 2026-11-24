import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/rpmail/[op]/route'
import { world, addPerson, addBox, signInAs, type Person } from './fakes'

// The promise these tests hold RPMail to: a person can only ever reach a mailbox that was put on their own login,
// and one company can never reach another company's mail. Every request goes through the real API route.

const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002'
let ann: Person, bob: Person, tom: Person, off: Person, zed: Person
let annBox: string, bobBox: string, pricing: string, crew: string, zedBox: string
let annMsg: string, zedMsg: string, pricingMsg: string, annDraft: string

const call = async (method: 'GET' | 'POST', op: string, data: Record<string, unknown> = {}) => {
  const url = new URL('https://rpintelligence.app/api/rpmail/' + op)
  if (method === 'GET') for (const [k, v] of Object.entries(data)) url.searchParams.set(k, String(v))
  const req = new NextRequest(url, method === 'GET' ? {} : { method, headers: { origin: 'https://rpintelligence.app', 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const res = await (method === 'GET' ? GET : POST)(req, { params: Promise.resolve({ op }) })
  const ct = res.headers.get('content-type') ?? ''
  return { status: res.status, location: res.headers.get('location'), body: ct.includes('json') ? await res.json() as Record<string, unknown> : null }
}

beforeEach(() => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
  tom = addPerson(A, 'construction_tech', 'Tom Tech', 'tom@gmail.com')
  off = addPerson(A, 'manager', 'Olga Off', 'olga@gmail.com', false)
  zed = addPerson(B, 'owner', 'Zed Other', 'zed@gmail.com')
  annBox = addBox(A, 'ann@gmail.com', 'personal', [ann])
  bobBox = addBox(A, 'bob@gmail.com', 'personal', [bob])
  pricing = addBox(A, 'invoices@gmail.com', 'shared', [ann, bob, tom])          // Tom's row is a leftover from before he became a tech
  crew = addBox(A, 'crew@gmail.com', 'shared', [ann, tom], { crew_reads: true })
  zedBox = addBox(B, 'zed@gmail.com', 'personal', [zed])
  annMsg = world.gmail.add('ann@gmail.com', { from: 'Customer <c@example.com>', subject: 'Private to Ann', files: [{ name: 'a.pdf', type: 'application/pdf', data: Buffer.from('pdf') }] }).id
  annDraft = world.gmail.addDraft('ann@gmail.com', { to: 'x@example.com', subject: 'Ann draft' }).id
  zedMsg = world.gmail.add('zed@gmail.com', { from: 'x@example.com', subject: 'Other company' }).id
  pricingMsg = world.gmail.add('invoices@gmail.com', { from: 'x@example.com', subject: 'Invoice 12 for $500' }).id
  world.gmail.add('bob@gmail.com', { from: 'x@example.com', subject: 'For Bob' })
  world.gmail.add('crew@gmail.com', { from: 'x@example.com', subject: 'Crew update' })
})

/** Every action that takes a mailbox, aimed at a mailbox + message that are not the caller's. */
const everyAction = (mailbox: string, id: string, draft = 'r' + id): [method: 'GET' | 'POST', op: string, data: Record<string, unknown>][] => [
  ['GET', 'messages', { mailbox }], ['GET', 'message', { mailbox, id }], ['GET', 'attachment', { mailbox, id, i: 0 }], ['GET', 'draft_prep', { mailbox, id }], ['GET', 'drafts', { mailbox }], ['GET', 'draft_open', { mailbox, draft }],
  ['POST', 'sync', { mailbox }], ['POST', 'search', { mailbox, q: 'private' }], ['POST', 'mark', { mailbox, id }], ['POST', 'file', { mailbox, id, dest: 'Trash' }],
  ['POST', 'done', { mailbox, id }], ['POST', 'star', { mailbox, id }], ['POST', 'bulk', { mailbox, ids: [id], action: 'Trash' }], ['POST', 'signature', { mailbox, text: 'x' }],
  ['POST', 'send', { mailbox, mode: 'new', to: 'x@example.com', subject: 'hi', body: 'hi', confirmed: true }],
  ['POST', 'send', { mailbox, mode: 'forward', id, to: 'x@example.com', confirmed: true }],
  ['GET', 'scheduled', { mailbox }], ['POST', 'schedule', { mailbox, mode: 'new', to: 'x@example.com', subject: 'later', body: 'later', confirmed: true, send_at: Date.now() + 3_600_000 }],
  ['GET', 'labels', { mailbox }], ['POST', 'label_save', { mailbox, name: 'Vendors' }], ['POST', 'label_apply', { mailbox, id, label: 'Label_1' }], ['POST', 'label_delete', { mailbox, label: 'Label_1' }],
  ['GET', 'blocks', { mailbox }], ['POST', 'block', { mailbox, addr: 'someone@example.com' }],
  ['GET', 'rules', { mailbox }], ['POST', 'rule_save', { mailbox, match: { from: 'someone@example.com' }, action: { archive: true } }], ['POST', 'rule_delete', { mailbox, id: '00000000-0000-4000-8000-000000000000' }],
  ['POST', 'snooze', { mailbox, id, until: Date.now() + 3_600_000 }],
  ['POST', 'plate_add', { mailbox, id }], ['POST', 'disconnect', { mailbox }],
]

describe('one person cannot reach another person\'s mailbox', () => {
  it('refuses every action on a mailbox that is not on the caller\'s login, and never uses its Google sign-in', async () => {
    signInAs(bob)
    for (const [method, op, data] of everyAction(annBox, annMsg)) {
      const r = await call(method, op, data)
      expect(r.status, `${op} on Ann's mailbox as Bob`).toBe(403)
    }
    expect(world.gmail.calls.filter(c => c.account === 'ann@gmail.com')).toEqual([])
    expect(world.gmail.sent).toEqual([])
    expect(world.gmail.get('ann@gmail.com', annMsg)!.labelIds).toEqual(['INBOX', 'UNREAD'])
    expect(world.db.vault.get(annBox)).toBe('refresh:ann@gmail.com')   // still signed in: Bob's "disconnect" did nothing
  })

  it('will not start a Google sign-in for someone else\'s mailbox', async () => {
    signInAs(bob)
    const r = await call('GET', 'connect', { mailbox: annBox })
    expect(r.location).toContain('/rpmail?connect_error=')
    expect(world.db.t('rpmail_oauth_states')).toEqual([])
  })

  it('will not send from a mailbox the caller does not have, even when the original is in their own', async () => {
    signInAs(bob)
    const mine = world.gmail.boxes.get('bob@gmail.com')![0].id
    const r = await call('POST', 'send', { mailbox: bobBox, from: annBox, mode: 'reply', id: mine, to: 'x@example.com', body: 'hi', confirmed: true })
    expect(r.status).toBe(403)
    expect(world.gmail.sent).toEqual([])
  })

  it('only shows the caller their own mailboxes, mail, contacts and Done list', async () => {
    signInAs(ann); await call('POST', 'sync', { mailbox: annBox }); await call('POST', 'done', { mailbox: annBox, id: annMsg })
    signInAs(bob); await call('POST', 'sync', { mailbox: bobBox })
    const st = await call('GET', 'state'), ov = await call('GET', 'overview')
    const ids = (st.body!.boxes as { id: string }[]).map(b => b.id).sort()
    expect(ids).toEqual([bobBox, pricing].sort())
    expect(JSON.stringify(ov.body)).not.toContain('Private to Ann')
    expect(JSON.stringify((await call('GET', 'contacts', { q: 'example' })).body)).not.toContain('c@example.com')
    expect(((await call('GET', 'done_list')).body!.items as unknown[]).length).toBe(0)
  })

  it('will not undo a move somebody else made', async () => {
    signInAs(ann); await call('POST', 'sync', { mailbox: annBox })
    const moved = await call('POST', 'file', { mailbox: annBox, id: annMsg, dest: 'Archive' })
    signInAs(bob)
    expect((await call('POST', 'undo', { move: moved.body!.move_id })).status).toBe(400)
    expect(world.gmail.get('ann@gmail.com', annMsg)!.labelIds).not.toContain('INBOX')
  })

  it('will not send a file another person attached', async () => {
    world.db.files.set(`${ann.id}/11111111-1111-4111-8111-111111111111/secret.pdf`, { data: Buffer.from('x'), type: 'application/pdf' })
    signInAs(bob)
    const r = await call('POST', 'send', { mailbox: bobBox, mode: 'new', to: 'x@example.com', subject: 'hi', body: 'hi', confirmed: true, files: [`${ann.id}/11111111-1111-4111-8111-111111111111/secret.pdf`] })
    expect(r.status).toBe(400)
    expect(world.gmail.sent).toEqual([])
    expect((await call('POST', 'attach_remove', { path: `${ann.id}/11111111-1111-4111-8111-111111111111/secret.pdf` })).status).toBe(400)
    expect(world.db.files.size).toBe(1)
  })

  it('refuses everything when nobody is signed in, and when RPMail is off for the person', async () => {
    signInAs(null)
    expect((await call('GET', 'overview')).status).toBe(403)
    expect((await call('GET', 'message', { mailbox: annBox, id: annMsg })).status).toBe(403)
    signInAs(off)
    world.db.t('rpmail_access').push({ mailbox_id: pricing, profile_id: off.id })
    expect((await call('GET', 'messages', { mailbox: pricing })).status).toBe(403)
  })

  it('only takes changes from the site\'s own pages', async () => {
    signInAs(ann)
    const req = new NextRequest('https://rpintelligence.app/api/rpmail/file', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ mailbox: annBox, id: annMsg, dest: 'Trash' }) })
    expect((await POST(req, { params: Promise.resolve({ op: 'file' }) })).status).toBe(403)
  })
})

describe('control: the same actions work for the person the mailbox belongs to', () => {
  it('lets Ann do all of it on her own mailbox (so the refusals above are real refusals, not a broken test)', async () => {
    signInAs(ann)
    for (const [method, op, data] of everyAction(annBox, annMsg, annDraft).filter(([, op]) => op !== 'disconnect' && op !== 'file' && op !== 'bulk')) {
      const r = await call(method, op, data)
      expect(r.status, `${op} on Ann's own mailbox`).toBe(200)
    }
    expect(world.gmail.sent.filter(s => !s.draft).length).toBe(2)          // the two sends; the scheduled one waits in Drafts
    expect(world.db.t('rpmail_scheduled').map(r => r.status)).toEqual(['waiting'])
    expect((await call('POST', 'file', { mailbox: annBox, id: annMsg, dest: 'Trash' })).status).toBe(200)
    expect((await call('POST', 'disconnect', { mailbox: annBox })).status).toBe(200)
    expect(world.db.vault.has(annBox)).toBe(false)
  })
})

describe('one company cannot reach another company\'s mail', () => {
  it('refuses every action across companies, even if an access row somehow exists', async () => {
    world.db.t('rpmail_access').push({ mailbox_id: annBox, profile_id: zed.id }, { mailbox_id: pricing, profile_id: zed.id })
    signInAs(zed)
    for (const [method, op, data] of [...everyAction(annBox, annMsg), ...everyAction(pricing, pricingMsg)]) {
      const r = await call(method, op, data)
      expect(r.status, `${op} across companies`).toBe(403)
    }
    expect(world.gmail.calls.filter(c => c.account !== 'zed@gmail.com')).toEqual([])
    const st = await call('GET', 'state')
    expect((st.body!.boxes as { id: string }[]).map(b => b.id)).toEqual([zedBox])
    signInAs(ann)
    expect((await call('GET', 'message', { mailbox: zedBox, id: zedMsg })).status).toBe(403)
  })

  it('keeps an owner inside their own company', async () => {
    signInAs(zed)
    const s = await call('GET', 'admin_state')
    expect(JSON.stringify(s.body)).not.toMatch(/Ann Owner|invoices@gmail\.com/)
    expect((await call('POST', 'admin_grant', { mailbox: pricing, profile: zed.id, on: true })).status).toBe(400)
    expect((await call('POST', 'admin_user', { profile: bob.id, enabled: false })).status).toBe(400)
    expect((await call('POST', 'admin_shared_delete', { id: pricing })).status).toBe(400)
    expect(world.db.t('rpmail_mailboxes').some(b => b.id === pricing)).toBe(true)
  })
})

describe('tech and shop logins never get a mailbox that carries pricing', () => {
  it('hides a pricing mailbox from a tech even with a leftover access row, but lets them use the crew mailbox', async () => {
    signInAs(tom)
    for (const [method, op, data] of everyAction(pricing, pricingMsg)) expect((await call(method, op, data)).status, op).toBe(403)
    expect(world.gmail.calls.filter(c => c.account === 'invoices@gmail.com')).toEqual([])
    expect(((await call('GET', 'state')).body!.boxes as { id: string }[]).map(b => b.id)).toContain(crew)
    expect((await call('GET', 'messages', { mailbox: crew })).status).toBe(200)
  })

  it('will not let an owner tick a pricing mailbox for a tech', async () => {
    world.db.tables.rpmail_access = world.db.t('rpmail_access').filter(a => !(a.profile_id === tom.id && a.mailbox_id === pricing))
    signInAs(ann)
    expect((await call('POST', 'admin_grant', { mailbox: pricing, profile: tom.id, on: true })).status).toBe(400)
    expect(world.db.t('rpmail_access').some(a => a.profile_id === tom.id && a.mailbox_id === pricing)).toBe(false)
  })

  it('only lets an owner change who has what', async () => {
    signInAs(bob)
    for (const [op, data] of [['admin_grant', { mailbox: pricing, profile: bob.id, on: true }], ['admin_user', { profile: tom.id, enabled: true }], ['admin_shared', { address: 'new@gmail.com', name: 'New' }], ['admin_shared_delete', { id: pricing }]] as const) {
      expect((await call('POST', op, data)).status, op).toBe(403)
    }
    expect((await call('GET', 'admin_state')).status).toBe(403)
  })
})
