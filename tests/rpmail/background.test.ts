import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { world, addPerson, addBox, type Person } from './fakes'

// What happens with nobody looking at the page: the scheduled check, the "failing for over an hour" alert,
// new-mail notifications, and clearing out abandoned attachments.

const pushes: { to: string; title: string; message: string }[] = []
const emails: { to: string; subject: string }[] = []
vi.mock('@/lib/push', () => ({ sendPushNotification: async (sub: { endpoint: string }, p: { title: string; message: string }) => { pushes.push({ to: sub.endpoint, ...p }); return 'sent' } }))
vi.mock('@/lib/email', () => ({ sendAlertEmail: async (e: { to: string; subject: string }) => { emails.push(e) } }))

const { runBackground, notifyNewMail } = await import('@/lib/rpmail/background')
const { setPrefs, inQuietHours } = await import('@/lib/rpmail/extras')
const { GET } = await import('@/app/api/rpmail/cron/route')

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
let ann: Person, bob: Person, tom: Person, box: string
const row = (id: string) => world.db.t('rpmail_mailboxes').find(b => b.id === id)!
const device = (p: Person) => world.db.t('push_subscriptions').push({ profile_id: p.id, endpoint: 'device:' + p.full_name, p256dh: 'k', auth_key: 'a' })
const asMe = (p: Person) => ({ id: p.id, company_id: p.company_id, role: p.role, name: p.full_name, email: p.email, enabled: true, mailAddress: null })
const ON = { on: true, what: 'people', quiet_from: '', quiet_to: '', off: [] }

beforeEach(() => {
  pushes.length = 0; emails.length = 0
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
  tom = addPerson(A, 'construction_tech', 'Tom Tech', 'tom@gmail.com')
  box = addBox(A, 'office@gmail.com', 'shared', [ann, bob, tom])     // a pricing mailbox; Tom's access row is a leftover
  world.gmail.add('office@gmail.com', { from: 'Pat <pat@vendor.com>', subject: 'Old mail', body: 'Hello' })
  device(ann); device(bob); device(tom)
})

describe('the scheduled check', () => {
  it('is closed to everyone without the scheduler\'s token', async () => {
    const call = (auth?: string) => GET(new NextRequest('https://rpintelligence.app/api/rpmail/cron', auth ? { headers: { authorization: auth } } : {}))
    expect((await call()).status).toBe(401)
    expect((await call('Bearer guess')).status).toBe(401)
    const ok = await call('Bearer the-vault-token')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ checked: 1, failed: 0 })
  })

  it('loads a mailbox nobody has open, and reads newsletters by their headers only', async () => {
    for (let i = 0; i < 5; i++) world.gmail.add('office@gmail.com', { from: 'News <news@shop.com>', subject: 'Sale ' + i, headers: { 'List-Unsubscribe': '<x>' } })
    world.gmail.add('office@gmail.com', { from: 'robot@billing.com', subject: 'Statement', headers: { 'Auto-Submitted': 'auto-generated' }, files: [{ name: 'statement.pdf', type: 'application/pdf', data: Buffer.from('x') }] })
    const r = await runBackground()
    expect(r).toMatchObject({ checked: 1, failed: 0 })
    const rows = world.db.t('rpmail_messages')
    expect(rows.length).toBe(7)
    expect(world.gmail.metadataReads).toBe(7)
    const fullReads = world.gmail.calls.filter(c => /^messages\/[0-9a-f]+$/.test(c.path)).length - 7
    expect(fullReads).toBe(2)                                                  // the one from a person, and the one that carries a file
    expect(rows.find(m => m.subject === 'Statement')!.has_att).toBe(true)        // an automatic mail with a PDF still shows its paperclip
    expect(rows.find(m => m.subject === 'Old mail')!.asks).toBe(false)
    expect(row(box).last_sync_at).toBeTruthy()
  })

  it('tells the owners once when a mailbox has been failing for over an hour, and stops when it recovers', async () => {
    world.gmail.revoked.add('office@gmail.com')
    await runBackground()
    expect(row(box).failing_since).toBeTruthy()
    expect(emails).toEqual([])                                                 // not an hour yet
    const began = row(box).failing_since
    row(box).failing_since = new Date(Date.now() - 2 * 3_600_000).toISOString()
    await runBackground()
    expect(emails.map(e => e.to)).toEqual(['ann@gmail.com'])                    // owners only
    expect(emails[0].subject).toMatch(/office.*2 hours/)
    expect(world.db.t('notifications').map(n => n.recipient_id)).toEqual([ann.id])
    expect(JSON.stringify([emails, world.db.t('notifications')])).not.toMatch(/refresh:|access:/)   // never a token
    await runBackground()
    expect(emails.length).toBe(1)                                              // not again today
    expect(began).toBeTruthy()
    world.gmail.revoked.clear()
    await runBackground()
    expect(row(box).failing_since).toBeNull()
    expect(row(box).last_error).toBeNull()
  })

  it('clears out attachments that were uploaded for a message nobody sent', async () => {
    world.db.files.set(`${ann.id}/a/old.pdf`, { data: Buffer.from('x'), type: 'application/pdf' })
    world.db.files.set(`${ann.id}/b/new.pdf`, { data: Buffer.from('x'), type: 'application/pdf' })
    world.db.stale.add(`${ann.id}/a/old.pdf`)
    expect((await runBackground()).cleaned).toBe(1)
    expect([...world.db.files.keys()]).toEqual([`${ann.id}/b/new.pdf`])
  })
})

describe('new-mail notifications', () => {
  const arrive = async (m: Parameters<typeof world.gmail.add>[1]) => { world.gmail.add('office@gmail.com', { date: Date.now() + 1000, ...m }); world.db.t('rpmail_mailboxes').find(b => b.id === box)!.history_id = null; row(box).sync = {} }

  it('are off until a person turns them on, and never announce mail that was already there', async () => {
    await runBackground()                      // first look
    expect(pushes).toEqual([])
    await arrive({ from: 'Pat <pat@vendor.com>', subject: 'New question?' })
    await runBackground()
    expect(pushes).toEqual([])                 // nobody asked for notifications
  })

  it('go to the people who asked, one per check, and never to a tech for a pricing mailbox', async () => {
    await runBackground()
    for (const p of [ann, tom]) await setPrefs(asMe(p), { notify: ON })
    await arrive({ from: 'Pat <pat@vendor.com>', subject: 'Can you call me?' })
    await arrive({ from: 'News <news@shop.com>', subject: 'Sale', headers: { 'List-Unsubscribe': '<x>' } })
    await runBackground()
    expect(pushes).toEqual([{ to: 'device:Ann Owner', title: 'Pat (office)', message: 'Can you call me?', link: '/rpmail' }])
    await runBackground()
    expect(pushes.length).toBe(1)              // not announced twice
  })

  it('respect "which mailboxes", "what sets one off" and quiet hours', async () => {
    await runBackground()
    await setPrefs(asMe(ann), { notify: { ...ON, off: [box] } })
    await setPrefs(asMe(bob), { notify: { ...ON, what: 'needs' } })
    await arrive({ from: 'Pat <pat@vendor.com>', subject: 'FYI the truck is back', body: 'Just letting you know.' })
    await runBackground()
    expect(pushes).toEqual([])                 // Ann switched this mailbox off; Bob only wants mail that asks for something
    await arrive({ from: 'Pat <pat@vendor.com>', subject: 'Permit', body: 'Can you send the permit?', date: Date.now() + 5000 })
    await runBackground()
    expect(pushes.map(p => p.to)).toEqual(['device:Bob Manager'])

    pushes.length = 0
    await setPrefs(asMe(bob), { notify: { ...ON, quiet_from: '00:00', quiet_to: '23:59' } })
    await notifyNewMail({ id: box, name: 'office', kind: 'shared', crew_reads: false, company_id: A, notify_mark: new Date(Date.now() - 60_000).toISOString() })
    expect(pushes).toEqual([])
    expect(inQuietHours({ quiet_from: '21:00', quiet_to: '06:00' }, new Date('2026-11-20T03:30:00Z'))).toBe(true)    // 10:30 PM Eastern
    expect(inQuietHours({ quiet_from: '21:00', quiet_to: '06:00' }, new Date('2026-11-20T17:00:00Z'))).toBe(false)   // noon Eastern
    expect(inQuietHours({ quiet_from: '', quiet_to: '' }, new Date())).toBe(false)
  })
})

describe('the test notification button', () => {
  it('goes only to the devices of the person who pressed it, and says so when they have none', async () => {
    const { notifyTest } = await import('@/lib/rpmail/background')
    const sue = addPerson(A, 'manager', 'Sue NoPhone', 'sue@gmail.com')
    expect(await notifyTest(asMe(sue))).toMatchObject({ devices: 0, sent: 0 })
    expect(pushes).toEqual([])
    expect(await notifyTest(asMe(ann))).toMatchObject({ devices: 1, sent: 1, failed: 0, here: null })
    expect(pushes.map(p => p.to)).toEqual(['device:Ann Owner'])
    // Says whether the device in the person's hand is one of theirs; someone else's device address is never "here".
    expect(await notifyTest(asMe(ann), { endpoint: 'device:Ann Owner' })).toMatchObject({ sent: 1, here: true })
    expect(await notifyTest(asMe(ann), { endpoint: 'device:Bob Manager' })).toMatchObject({ sent: 1, here: false })
    expect(pushes.every(p => p.to === 'device:Ann Owner')).toBe(true)
  })

  it('can wait 15 seconds first, so the phone can be locked, and no other wait is accepted', async () => {
    const { notifyTest } = await import('@/lib/rpmail/background')
    vi.useFakeTimers()
    try {
      const later = notifyTest(asMe(ann), { delay: 15 })
      await vi.advanceTimersByTimeAsync(14_000)
      expect(pushes).toEqual([])
      await vi.advanceTimersByTimeAsync(1_500)
      expect(await later).toMatchObject({ sent: 1 })
      pushes.length = 0
      const now = notifyTest(asMe(ann), { delay: 100000 })     // ignored: sent straight away
      await vi.advanceTimersByTimeAsync(50)
      expect(await now).toMatchObject({ sent: 1 })
    } finally { vi.useRealTimers() }
  })
})

describe('snoozes and reminders coming due', () => {
  const HOUR = 3_600_000
  const due = (thread: string) => { const z = world.db.t('rpmail_snoozes').find(x => x.thread_id === thread)!; z.until = new Date(Date.now() - 1000).toISOString(); return z }
  it('brings a snoozed conversation back and tells the person who snoozed it, nobody else', async () => {
    const { setSnooze } = await import('@/lib/rpmail/snooze')
    const { wakeSnoozes, runBackground } = await import('@/lib/rpmail/background')
    const { listMessages } = await import('@/lib/rpmail/mail-ops')
    expect(await runBackground()).toMatchObject({ checked: 1 })      // loads the mailbox
    const m = world.db.t('rpmail_messages')[0]
    await setSnooze(asMe(bob), { mailbox: box, id: m.gmail_id as string, until: Date.now() + HOUR })
    expect(await wakeSnoozes()).toBe(0)                                // not time yet
    expect(pushes).toEqual([])
    due(m.thread_id as string)
    expect(await wakeSnoozes()).toBe(1)
    expect(pushes).toEqual([{ to: 'device:Bob Manager', title: 'Back in your inbox (office)', message: 'Old mail', link: '/rpmail' }])
    const back = (await listMessages(asMe(bob), { mailbox: box, view: 'inbox' })).messages
    expect(back.length).toBe(1)
    expect(back[0].snooze).toMatchObject({ kind: 'snooze', woke: true })
    expect(await wakeSnoozes()).toBe(0)                                // told once
    expect(pushes.length).toBe(1)
  })

  it('a reminder is only given if nobody has written back, and never to someone who has lost the mailbox', async () => {
    const { setSnooze } = await import('@/lib/rpmail/snooze')
    const { wakeSnoozes, runBackground } = await import('@/lib/rpmail/background')
    await runBackground()
    const m = world.db.t('rpmail_messages')[0]
    await setSnooze(asMe(ann), { mailbox: box, id: m.gmail_id as string, until: Date.now() + HOUR, kind: 'remind' })
    await setSnooze(asMe(bob), { mailbox: box, id: m.gmail_id as string, until: Date.now() + HOUR, kind: 'remind' })
    world.db.tables.rpmail_access = world.db.t('rpmail_access').filter(a => a.profile_id !== bob.id)     // Bob is taken off the mailbox
    for (const z of world.db.t('rpmail_snoozes')) z.until = new Date(Date.now() - 1000).toISOString()
    expect(await wakeSnoozes()).toBe(1)
    expect(pushes).toEqual([{ to: 'device:Ann Owner', title: 'No reply yet (office)', message: 'Old mail', link: '/rpmail' }])
    expect(world.db.t('rpmail_snoozes').map(z => z.profile_id)).toEqual([ann.id])                         // Bob's is gone without a word

    // Ann sets another; this time the other side writes back before it is due.
    pushes.length = 0
    world.db.tables.rpmail_snoozes = []
    await setSnooze(asMe(ann), { mailbox: box, id: m.gmail_id as string, until: Date.now() + HOUR, kind: 'remind' })
    world.gmail.add('office@gmail.com', { from: 'Pat <pat@vendor.com>', subject: 'Re: Old mail', threadId: m.thread_id as string, date: Date.now() + 5000 })
    await runBackground()
    due(m.thread_id as string)
    expect(await wakeSnoozes()).toBe(0)
    expect(pushes.filter(p => p.title.startsWith('No reply'))).toEqual([])
    expect(world.db.t('rpmail_snoozes')).toEqual([])
  })
})
