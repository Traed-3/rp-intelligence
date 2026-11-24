import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { sendMail } from '@/lib/rpmail/mail-ops'
import { draftList, draftOpen } from '@/lib/rpmail/drafts'
import { scheduleMail, scheduledList, scheduleCancel, scheduleNow, sendDue, whenOf } from '@/lib/rpmail/schedule'

// Schedule send. The message waits as a draft in the person's own mailbox; at its time the scheduler checks everything
// again and sends that draft. Nothing goes out early, nothing goes out twice, and only the person who scheduled a
// message can see it, send it early or stop it.

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const HOUR = 3_600_000
let ann: Person, bob: Person, me: Me, box: string, crew: string
const outgoing = () => world.gmail.sent.filter(s => !s.draft)
const rows = () => world.db.t('rpmail_scheduled')
const later = (extra: Record<string, unknown> = {}) => ({ mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Monday plan', body: 'See you Monday', confirmed: true, send_at: Date.now() + HOUR, ...extra })
const makeDue = () => { for (const r of rows()) r.send_at = new Date(Date.now() - 1000).toISOString() }

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com'); bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
  box = addBox(A, 'ann@gmail.com', 'personal', [ann]); addBox(A, 'bob@gmail.com', 'personal', [bob])
  crew = addBox(A, 'econstruction.rp@gmail.com', 'shared', [ann], { crew_reads: true })
  world.user = ann.id
  me = await requireMe()
  await syncMailbox(await mailboxFor(me, box))
})

describe('scheduling a message', () => {
  it('waits in Drafts, goes out once at its time, and never before', async () => {
    const r = await scheduleMail(me, later())
    expect(r).toMatchObject({ ok: true, scheduled: true, from: 'ann@gmail.com', to: 'pat@vendor.com' })
    expect(outgoing()).toEqual([])                                              // nothing has gone out
    const drafts = await draftList(me, { mailbox: box })
    expect(drafts.drafts).toHaveLength(1)
    expect(drafts.drafts[0].scheduled_at).toBe(r.send_at)                       // the draft says when it goes
    expect((await draftOpen(me, { mailbox: box, draft: drafts.drafts[0].id })).scheduled_at).toBe(r.send_at)
    expect((await scheduledList(me, { mailbox: box })).scheduled).toMatchObject([{ status: 'waiting', to: 'pat@vendor.com', subject: 'Monday plan' }])

    expect(await sendDue()).toEqual({ sent: 0, failed: 0, later: 0 })          // not its time yet
    expect(outgoing()).toEqual([])

    makeDue()
    expect((await sendDue()).sent).toBe(1)
    expect(outgoing()).toHaveLength(1)
    expect(outgoing()[0].raw).toContain('Subject: Monday plan')
    expect(rows()[0].status).toBe('sent')
    expect(world.gmail.drafts.get('ann@gmail.com')).toEqual([])                // Gmail took it out of Drafts as it went
    expect(world.db.t('rpmail_activity').map(a => a.kind)).toEqual(['schedule', 'send'])

    expect((await sendDue()).sent).toBe(0)                                      // and never again
    expect(outgoing()).toHaveLength(1)
  })

  it('runs every send check when it is scheduled: confirm, a sensible time, the addresses and the pricing rule', async () => {
    await expect(scheduleMail(me, later({ confirmed: false }))).rejects.toThrow(/Press Schedule, then confirm/)
    await expect(scheduleMail(me, later({ send_at: Date.now() - 1000 }))).rejects.toThrow(/at least a minute/)
    await expect(scheduleMail(me, later({ send_at: Date.now() + 400 * 24 * HOUR }))).rejects.toThrow(/six months/)
    await expect(scheduleMail(me, later({ send_at: 'soon' }))).rejects.toThrow(/Pick a day and time/)
    await expect(scheduleMail(me, later({ to: 'not an address' }))).rejects.toThrow(/does not look like an email address/)
    await expect(scheduleMail(me, later({ to: 'econstruction.rp@gmail.com', body: 'The quote is $4,500' }))).rejects.toThrow(/Blocked: this mentions pricing/)
    await expect(scheduleMail(me, later({ mailbox: crew, body: 'Invoice total $900' }))).rejects.toThrow(/Blocked/)
    expect(rows()).toEqual([])
    expect(world.gmail.sent).toEqual([])                                        // not even a draft was made
    expect(whenOf(Date.now() + 2 * 60_000)).toBeGreaterThan(Date.now())
  })

  it('checks again when it goes: pricing put into the draft afterwards is caught, nothing goes out, and the person is told', async () => {
    await scheduleMail(me, later())
    const d = world.gmail.drafts.get('ann@gmail.com')![0]
    const m = world.gmail.get('ann@gmail.com', d.msg)!
    m.to = 'econstruction.rp@gmail.com'; m.body = 'Your quote: $12,000'          // changed in Gmail before the time came
    makeDue()
    expect(await sendDue()).toMatchObject({ sent: 0, failed: 1 })
    expect(outgoing()).toEqual([])
    expect(rows()[0]).toMatchObject({ status: 'failed' })
    expect(String(rows()[0].error)).toMatch(/Blocked: this mentions pricing/)
    const n = world.db.t('notifications')
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ recipient_id: ann.id, type: 'rpmail_schedule_failed', title: 'A scheduled message was not sent' })
    expect(String(n[0].message)).toMatch(/Blocked: this mentions pricing.* It is still in Drafts in \S/)
    expect(world.gmail.drafts.get('ann@gmail.com')).toHaveLength(1)            // the draft is kept
  })

  it('does not send for someone who lost the mailbox, may no longer send from it, or turned RPMail off', async () => {
    const shared = addBox(A, 'office@gmail.com', 'shared', [ann])
    await scheduleMail(me, later({ mailbox: shared, from: shared }))
    await scheduleMail(me, later({ subject: 'Second' }))
    await scheduleMail(me, later({ subject: 'Third' }))
    // 1: the owner takes the shared mailbox away. 2 and 3: RPMail is turned off for Ann.
    world.db.tables['rpmail_access'] = world.db.t('rpmail_access').filter(a => a.mailbox_id !== shared)
    makeDue()
    world.db.t('rpmail_users').find(u => u.profile_id === ann.id)!.enabled = false
    expect(await sendDue()).toMatchObject({ sent: 0, failed: 3 })
    expect(outgoing()).toEqual([])
    expect(rows().map(r => r.status)).toEqual(['failed', 'failed', 'failed'])
  })

  it('a message that started sending and was never heard of again is never sent again by itself', async () => {
    await scheduleMail(me, later())
    Object.assign(rows()[0], { status: 'sending', claimed_at: new Date(Date.now() - 20 * 60_000).toISOString(), send_at: new Date(Date.now() - 21 * 60_000).toISOString() })
    expect(await sendDue()).toMatchObject({ sent: 0, failed: 1 })
    expect(outgoing()).toEqual([])
    expect(String(rows()[0].error)).toMatch(/may or may not have gone out. Look in Sent/)
  })

  it('two runs at once send it once', async () => {
    await scheduleMail(me, later())
    makeDue()
    const [a, b] = await Promise.all([sendDue(), sendDue()])
    expect(a.sent + b.sent).toBe(1)
    expect(outgoing()).toHaveLength(1)
  })
})

describe('the person\'s own list: send now, edit, stop', () => {
  it('only the person who scheduled it sees it or can touch it', async () => {
    const r = await scheduleMail(me, later())
    world.user = bob.id
    const bobMe = await requireMe()
    expect((await scheduledList(bobMe)).scheduled).toEqual([])
    await expect(scheduleCancel(bobMe, { id: r.id })).rejects.toThrow(/not on your list/)
    await expect(scheduleNow(bobMe, { id: r.id, confirmed: true })).rejects.toThrow(/not on your list/)
    await expect(scheduledList(bobMe, { mailbox: box })).rejects.toThrow()
    expect(rows()[0].status).toBe('waiting')
    expect(outgoing()).toEqual([])
  })

  it('Send now sends it straight away (after the confirm), once', async () => {
    const r = await scheduleMail(me, later())
    await expect(scheduleNow(me, { id: r.id })).rejects.toThrow(/confirm/)
    expect(await scheduleNow(me, { id: r.id, confirmed: true })).toMatchObject({ sent: true, to: 'pat@vendor.com' })
    expect(outgoing()).toHaveLength(1)
    await expect(scheduleNow(me, { id: r.id, confirmed: true })).rejects.toThrow(/already gone out/)
    makeDue()
    expect((await sendDue()).sent).toBe(0)
    expect(outgoing()).toHaveLength(1)
  })

  it('Stop it keeps the draft and nothing goes out', async () => {
    const r = await scheduleMail(me, later())
    expect(await scheduleCancel(me, { id: r.id })).toMatchObject({ cancelled: true })
    makeDue()
    expect((await sendDue()).sent).toBe(0)
    expect(outgoing()).toEqual([])
    expect(world.gmail.drafts.get('ann@gmail.com')).toHaveLength(1)
    expect((await draftList(me, { mailbox: box })).drafts[0].scheduled_at).toBeNull()
  })

  it('sending or saving the draft from the message box replaces the schedule', async () => {
    await scheduleMail(me, later())
    const draft = world.gmail.drafts.get('ann@gmail.com')![0].id
    await sendMail(me, { mailbox: box, mode: 'new', draft_id: draft, to: 'pat@vendor.com', subject: 'Monday plan', body: 'Changed my mind, today', confirmed: true })
    expect(outgoing()).toHaveLength(1)
    expect(rows()[0].status).toBe('cancelled')
    makeDue()
    expect((await sendDue()).sent).toBe(0)
    expect(outgoing()).toHaveLength(1)
  })

  it('scheduling a reopened draft again moves its time', async () => {
    await scheduleMail(me, later())
    const draft = world.gmail.drafts.get('ann@gmail.com')![0].id
    const at = Date.now() + 5 * HOUR
    await scheduleMail(me, { mailbox: box, mode: 'new', draft_id: draft, to: 'pat@vendor.com', subject: 'Monday plan', body: 'See you Monday', confirmed: true, send_at: at })
    expect(rows().map(r => r.status)).toEqual(['cancelled', 'waiting'])
    expect(Date.parse(String(rows()[1].send_at))).toBe(at)
    expect(world.gmail.drafts.get('ann@gmail.com')).toHaveLength(1)            // still one draft
  })

  it('caps how many can wait at once', async () => {
    for (let i = 0; i < 50; i++) world.db.t('rpmail_scheduled').push({ id: 1000 + i, company_id: A, profile_id: ann.id, mailbox_id: box, draft_id: 'rX' + i, to_addrs: '', subject: '', send_at: new Date(Date.now() + HOUR).toISOString(), status: 'waiting', tries: 0 })
    await expect(scheduleMail(me, later())).rejects.toThrow(/already have 50/)
  })
})

describe('a Proton mailbox when the Mac Studio is off', () => {
  it('is tried again each minute for two hours, then marked not sent and the person told', async () => {
    const proton = addBox(A, 'ann@proton.me', 'shared', [ann], { provider: 'proton', relay_seen_at: new Date(Date.now() - 3600_000).toISOString() })
    world.db.t('rpmail_scheduled').push({ id: 7, company_id: A, profile_id: ann.id, mailbox_id: proton, draft_id: '0000000100000002', to_addrs: 'pat@vendor.com', subject: 'Proton later',
      send_at: new Date(Date.now() - 60_000).toISOString(), status: 'waiting', tries: 0 })
    expect(await sendDue()).toMatchObject({ sent: 0, later: 1 })
    expect(rows()[0]).toMatchObject({ status: 'waiting' })
    expect(String(rows()[0].error)).toMatch(/Mac Studio is not answering/)
    rows()[0].send_at = new Date(Date.now() - 3 * HOUR).toISOString()
    expect(await sendDue()).toMatchObject({ failed: 1 })
    expect(rows()[0].status).toBe('failed')
    expect(world.db.t('notifications')).toHaveLength(1)
  })
})
