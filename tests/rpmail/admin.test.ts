import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/rpmail/[op]/route'
import { world, addPerson, addBox, signInAs, type Person } from './fakes'

// What an owner controls: what each person may do in a shared mailbox, the company's own blocked-content rules,
// and the activity log. Every request goes through the real API route.

const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002'
let ann: Person, bob: Person, tom: Person, zed: Person
let office: string, crew: string, bobBox: string, officeMsg: string

const call = async (method: 'GET' | 'POST', op: string, data: Record<string, unknown> = {}) => {
  const url = new URL('https://rpintelligence.app/api/rpmail/' + op)
  if (method === 'GET') for (const [k, v] of Object.entries(data)) url.searchParams.set(k, String(v))
  const req = new NextRequest(url, method === 'GET' ? {} : { method, headers: { origin: 'https://rpintelligence.app', 'content-type': 'application/json' }, body: JSON.stringify(data) })
  const res = await (method === 'GET' ? GET : POST)(req, { params: Promise.resolve({ op }) })
  const ct = res.headers.get('content-type') ?? ''
  return { status: res.status, type: ct, body: ct.includes('json') ? await res.json() as Record<string, unknown> : null, text: ct.includes('csv') ? await res.text() : '' }
}
const send = (mailbox: string, extra: Record<string, unknown> = {}) => call('POST', 'send', { mailbox, mode: 'new', to: 'customer@example.com', subject: 'Hello', body: 'See you Tuesday.', confirmed: true, ...extra })
const level = async (person: Person, mailbox: string, lv: string) => { signInAs(ann); expect((await call('POST', 'admin_grant', { mailbox, profile: person.id, level: lv })).status).toBe(200) }
const log = () => world.db.t('rpmail_activity')

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
  tom = addPerson(A, 'construction_tech', 'Tom Tech', 'tom@gmail.com')
  zed = addPerson(B, 'owner', 'Zed Other', 'zed@gmail.com')
  office = addBox(A, 'office@gmail.com', 'shared', [ann, bob])
  crew = addBox(A, 'crew@gmail.com', 'shared', [ann, bob, tom], { crew_reads: true })
  bobBox = addBox(A, 'bob@gmail.com', 'personal', [bob])
  addBox(B, 'zed@gmail.com', 'personal', [zed])
  officeMsg = world.gmail.add('office@gmail.com', { from: 'Pat <pat@vendor.com>', subject: '=1+1 and a question', body: 'SECRETBODY do not log me' }).id
  world.gmail.add('bob@gmail.com', { from: 'x@example.com', subject: 'For Bob' })
  signInAs(bob)
  await call('POST', 'sync', { mailbox: office })
  await call('POST', 'sync', { mailbox: bobBox })
})

describe('what each person may do in a shared mailbox', () => {
  it('read only: can read and archive, cannot send or delete', async () => {
    await level(bob, office, 'read')
    signInAs(bob)
    expect((await call('GET', 'messages', { mailbox: office })).status).toBe(200)
    expect((await call('GET', 'message', { mailbox: office, id: officeMsg })).status).toBe(200)
    const s = await send(office)
    expect(s.status).toBe(403)
    expect(String(s.body!.error)).toMatch(/not send from it/)
    expect((await send(office, { draft: true })).status).toBe(403)                 // a draft in the shared mailbox is writing in it too
    expect((await call('POST', 'file', { mailbox: office, id: officeMsg, dest: 'Trash' })).status).toBe(403)
    expect((await call('POST', 'file', { mailbox: office, id: officeMsg, dest: 'Spam' })).status).toBe(403)
    expect((await call('POST', 'bulk', { mailbox: office, ids: [officeMsg], action: 'Trash' })).body).toMatchObject({ n: 0, failed: 1 })
    expect(world.gmail.sent).toEqual([])
    expect(world.gmail.get('office@gmail.com', officeMsg)!.labelIds).toEqual(['INBOX', 'UNREAD'])
    expect((await call('POST', 'file', { mailbox: office, id: officeMsg, dest: 'Archive' })).status).toBe(200)
    const boxes = (await call('GET', 'state')).body!.boxes as { id: string; can_send: boolean; can_delete: boolean }[]
    expect(boxes.find(b => b.id === office)).toMatchObject({ can_send: false, can_delete: false })
    expect(boxes.find(b => b.id === bobBox)).toMatchObject({ can_send: true, can_delete: true })
  })

  it('read and send: can send, still cannot delete; full: everything', async () => {
    await level(bob, office, 'send')
    signInAs(bob)
    expect((await send(office)).status).toBe(200)
    expect((await call('POST', 'file', { mailbox: office, id: officeMsg, dest: 'Trash' })).status).toBe(403)
    await level(bob, office, 'full')
    signInAs(bob)
    expect((await call('POST', 'file', { mailbox: office, id: officeMsg, dest: 'Trash' })).status).toBe(200)
  })

  it('the switches never bind an owner, or a person in their own mailbox', async () => {
    for (const a of world.db.t('rpmail_access')) Object.assign(a, { can_send: false, can_delete: false })     // even if the rows say no
    signInAs(ann)
    expect((await send(office)).status).toBe(200)
    signInAs(bob)
    expect((await send(bobBox)).status).toBe(200)
    expect((await send(office)).status).toBe(403)
  })

  it('only an owner can change them, and never for another company\'s person or mailbox', async () => {
    signInAs(bob)
    expect((await call('POST', 'admin_grant', { mailbox: office, profile: bob.id, level: 'full' })).status).toBe(403)
    signInAs(zed)
    expect((await call('POST', 'admin_grant', { mailbox: office, profile: bob.id, level: 'full' })).status).toBe(400)   // not Zed's person, not Zed's mailbox
    expect((await call('POST', 'admin_grant', { mailbox: office, profile: zed.id, level: 'full' })).status).toBe(400)
    expect(world.db.t('rpmail_access').some(a => a.profile_id === zed.id && a.mailbox_id === office)).toBe(false)
  })
})

describe('the company\'s own blocked-content rules', () => {
  const save = (rules: unknown) => call('POST', 'admin_content_save', { rules })
  it('a rule for all mail stops a send that mentions the phrase, in the text, the subject or a file name', async () => {
    signInAs(ann)
    expect((await save([{ name: 'Margins', words: 'margin, our cost', scope: 'all' }])).status).toBe(200)
    signInAs(bob)
    const r = await send(office, { body: 'The Margin on this job is thin.' })
    expect(r.status).toBe(400)
    expect(String(r.body!.error)).toMatch(/your company's rule "Margins".*"margin"/)
    expect((await send(office, { subject: 'About our   cost' })).status).toBe(400)
    expect((await send(office, { body: 'A marginal difference.' })).status).toBe(200)        // whole words only
    expect(world.gmail.sent.length).toBe(1)
    expect(log().filter(l => l.kind === 'blocked_send').length).toBe(2)
  })

  it('a rule for crew mailboxes only stops mail to or from a mailbox the crew reads', async () => {
    signInAs(ann)
    await save([{ name: 'Wages', words: ['hourly rate'], scope: 'crew' }])
    signInAs(bob)
    expect((await send(office, { body: 'His hourly rate went up.' })).status).toBe(200)                                   // office to a customer: fine
    expect((await send(office, { body: 'His hourly rate went up.', to: 'crew@gmail.com' })).status).toBe(400)             // to the crew mailbox
    expect((await send(crew, { body: 'His hourly rate went up.' })).status).toBe(400)                                     // from the crew mailbox
    expect((await send(crew, { body: 'Truck 12 is ready.' })).status).toBe(200)
  })

  it('a rule that is switched off does nothing; another company\'s rules never apply', async () => {
    signInAs(ann)
    await save([{ name: 'Margins', words: 'margin', scope: 'all', on: false }])
    signInAs(zed)
    await save([{ name: 'Theirs', words: 'tuesday', scope: 'all' }])
    signInAs(bob)
    expect((await send(office, { body: 'The margin is fine. See you Tuesday.' })).status).toBe(200)
  })

  it('only an owner can write them, and a rule has to be usable', async () => {
    signInAs(bob)
    expect((await save([{ name: 'X', words: 'margin' }])).status).toBe(403)
    signInAs(ann)
    expect(String((await save([{ name: '', words: 'margin' }])).body!.error)).toMatch(/Give each rule a name/)
    expect(String((await save([{ name: 'X', words: '' }])).body!.error)).toMatch(/at least one word/)
    expect(String((await save([{ name: 'X', words: 'to' }])).body!.error)).toMatch(/too short/)
    expect((await save([])).status).toBe(200)
    expect((await call('GET', 'admin_state')).body!.content).toEqual([])
  })
})

describe('the activity log', () => {
  it('records sign-outs, sends, deletes, blocked sends and access changes, with no message text', async () => {
    await level(bob, office, 'full')
    signInAs(bob)
    await send(office, { subject: 'Quote follow-up' })
    await call('POST', 'file', { mailbox: office, id: officeMsg, dest: 'Trash' })
    await send(crew, { body: 'The price is $4,500 for the job.' })                    // the built-in pricing rule refuses this
    signInAs(ann)
    await call('POST', 'admin_user', { profile: tom.id, enabled: false })
    await call('POST', 'admin_grant', { mailbox: office, profile: bob.id, on: false })
    const r = await call('GET', 'admin_activity')
    expect(r.status).toBe(200)
    const rows = r.body!.rows as { kind: string; who: string; mailbox: string; about: string; detail: string }[]
    expect(rows.map(x => x.kind)).toEqual(['access', 'rpmail_off', 'blocked_send', 'trash', 'send', 'access'])
    expect(rows[0]).toMatchObject({ who: 'Ann Owner', mailbox: 'office@gmail.com', about: 'Bob Manager', detail: 'taken away' })
    expect(rows[1]).toMatchObject({ who: 'Ann Owner', about: 'Tom Tech' })
    expect(rows[3]).toMatchObject({ who: 'Bob Manager', mailbox: 'office@gmail.com', detail: '=1+1 and a question' })
    expect(rows[4]).toMatchObject({ who: 'Bob Manager', detail: 'To customer@example.com: Quote follow-up' })
    expect(rows[5].detail).toBe('read, send and delete')
    expect(JSON.stringify(log())).not.toContain('SECRETBODY')
    expect(JSON.stringify(log())).not.toContain('See you Tuesday')

    expect(((await call('GET', 'admin_activity', { kind: 'mail' })).body!.rows as unknown[]).length).toBe(3)
    expect(((await call('GET', 'admin_activity', { person: bob.id })).body!.rows as unknown[]).length).toBe(3)
  })

  it('is for owners only, and one company never sees another company\'s lines', async () => {
    signInAs(bob)
    await send(bobBox)
    expect((await call('GET', 'admin_activity')).status).toBe(403)
    expect((await call('GET', 'admin_activity_export')).status).toBe(403)
    signInAs(zed)
    expect((await call('GET', 'admin_activity')).body!.rows).toEqual([])
    signInAs(null)
    expect((await call('GET', 'admin_activity')).status).toBe(403)
  })

  it('exports as a spreadsheet file, and a line that looks like a formula cannot run as one', async () => {
    signInAs(bob)
    await call('POST', 'file', { mailbox: office, id: officeMsg, dest: 'Trash' })
    signInAs(ann)
    const r = await call('GET', 'admin_activity_export')
    expect(r.status).toBe(200)
    expect(r.type).toContain('text/csv')
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n')
    expect(lines[0]).toBe('When (Eastern),Who,What,Mailbox,About,Detail')
    expect(lines[1]).toMatch(/,Bob Manager,Moved mail to Trash,office@gmail\.com,,'=1\+1 and a question$/)
  })
})
