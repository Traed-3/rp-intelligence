import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { listMessages, readMessage } from '@/lib/rpmail/mail-ops'

// Needs you covers the last 30 days; opening a message asks for its parts at the same time.

const A = 'aaaaaaaa-0000-4000-8000-000000000001', DAY = 86_400_000
let ann: Person, me: Me, box: string

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  box = addBox(A, 'ann@gmail.com', 'personal', [ann])
  world.user = ann.id
  me = await requireMe()
})

describe('Needs you', () => {
  it('leaves out questions older than 30 days, but keeps them in the inbox', async () => {
    const fresh = world.gmail.add('ann@gmail.com', { from: 'Pat <pat@vendor.com>', subject: 'New question', body: 'Can you confirm?', date: Date.now() - 2 * DAY }).id
    const old = world.gmail.add('ann@gmail.com', { from: 'Bo <bo@vendor.com>', subject: 'Old question', body: 'Can you confirm?', date: Date.now() - 40 * DAY }).id
    await syncMailbox(await mailboxFor(me, box))
    const needs = (await listMessages(me, { mailbox: box, view: 'needs' })).messages.map(m => m.id)
    expect(needs).toContain(fresh)
    expect(needs).not.toContain(old)
    expect((await listMessages(me, { mailbox: box, view: 'inbox' })).messages.map(m => m.id)).toContain(old)
  })

  it('keeps an old conversation the person snoozed and that has come back', async () => {
    const old = world.gmail.add('ann@gmail.com', { from: 'Bo <bo@vendor.com>', subject: 'Old question', body: 'Can you confirm?', date: Date.now() - 40 * DAY }).id
    await syncMailbox(await mailboxFor(me, box))
    const thread = world.db.t('rpmail_messages').find(m => m.gmail_id === old)!.thread_id
    world.db.t('rpmail_snoozes').push({ id: 1, profile_id: ann.id, mailbox_id: box, thread_id: thread, gmail_id: old, kind: 'snooze', until: new Date(Date.now() - 1000).toISOString(), woke_at: new Date().toISOString(), subject: 'Old question' })
    expect((await listMessages(me, { mailbox: box, view: 'needs' })).messages.map(m => m.id)).toContain(old)
  })
})

describe('opening a message', () => {
  it('still opens a message with everything in it now that its parts are fetched together', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const id = world.gmail.add('ann@gmail.com', { from: 'Pat <pat@vendor.com>', subject: 'Logo', body: 'hi', html: '<p>hi <img src="cid:a"> <img src="cid:b"></p>' }).id
    // Two inline pictures, the way a signature logo arrives.
    const gm = world.gmail.get('ann@gmail.com', id)!
    gm.files = [{ name: 'a.png', type: 'image/png', data: png }, { name: 'b.png', type: 'image/png', data: png }]
    gm.headers = {}
    await syncMailbox(await mailboxFor(me, box))
    const r = await readMessage(me, { mailbox: box, id })
    expect(r.text).toContain('hi')
    expect(r.done).toBe(false)
    expect(r.thread).toEqual([])
  })
})
