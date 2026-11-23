import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, Forbidden, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { listMessages, undoMove, easternDayStart } from '@/lib/rpmail/mail-ops'
import { bulk } from '@/lib/rpmail/extras'
import { labelList, labelSave, labelDelete, labelApply, blockList, blockSender } from '@/lib/rpmail/organize'
import { crc32, makeZip, zipNames } from '@/lib/rpmail/zip'

// Keeping a mailbox tidy, run against the stand-in Gmail: labels, the date and sender filters, blocked senders,
// and the zip file for "Download all".

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
let ann: Person, bob: Person, me: Me, box: string, office: string
let m1: string, m2: string
const G = (id: string, account = 'ann@gmail.com') => world.gmail.get(account, id)!
const asMe = async (p: Person) => { world.user = p.id; return requireMe() }
const sync = async (who: Me, id: string) => syncMailbox(await mailboxFor(who, id))
const subjects = async (q: Record<string, string>) => (await listMessages(me, { mailbox: box, ...q })).messages.map(m => m.subject).sort()

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
  box = addBox(A, 'ann@gmail.com', 'personal', [ann])
  office = addBox(A, 'office@gmail.com', 'shared', [ann, bob])
  m1 = world.gmail.add('ann@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'Parts for 34006', body: 'Can you confirm the order?', date: Date.parse('2026-11-10T15:00:00Z') }).id
  m2 = world.gmail.add('ann@gmail.com', { from: 'Sam Seller <sam@spam.biz>', subject: 'Buy our stuff', body: 'Great deals.', date: Date.parse('2026-11-12T03:30:00Z') }).id
  world.gmail.add('office@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'Statement', body: 'Attached.' })
  me = await asMe(ann)
  await sync(me, box)
  await sync(me, office)
})

describe('labels', () => {
  it('makes a label in Gmail, puts it on a conversation, and finds the conversation by it', async () => {
    const { label } = await labelSave(me, { mailbox: box, name: '  Vendors  ' })
    expect(label.name).toBe('Vendors')
    expect((await labelList(me, { mailbox: box })).labels).toEqual([label])
    expect((await labelSave(me, { mailbox: box, name: 'vendors' })).label).toEqual(label)      // the same name again is the same label, not a second one
    expect(world.gmail.labels.get('ann@gmail.com')!.length).toBe(1)

    await labelApply(me, { mailbox: box, id: m1, label: label.id })
    expect(G(m1).labelIds).toContain(label.id)
    expect(G(m1).labelIds).toContain('INBOX')                                                    // a label alone does not move it
    expect(await subjects({ view: 'all', label: label.id })).toEqual(['Parts for 34006'])
    expect((await listMessages(me, { mailbox: box, view: 'inbox' })).messages.find(m => m.id === m1)!.labels).toEqual([label.id])

    await labelApply(me, { mailbox: box, id: m1, label: label.id, on: false })
    expect(G(m1).labelIds).not.toContain(label.id)
    expect(await subjects({ view: 'all', label: label.id })).toEqual([])
  })

  it('"move to a label" takes it out of the inbox, and Undo puts it back without the label', async () => {
    const { label } = await labelSave(me, { mailbox: box, name: 'Filed jobs' })
    const r = await labelApply(me, { mailbox: box, id: m1, label: label.id, move: true })
    expect(G(m1).labelIds).toEqual(expect.arrayContaining([label.id]))
    expect(G(m1).labelIds).not.toContain('INBOX')
    expect(await subjects({ view: 'inbox' })).toEqual(['Buy our stuff'])
    expect(await subjects({ view: 'filed' })).toEqual(['Parts for 34006'])

    const u = await undoMove(me, { move: r.move_id })
    expect(u.back_to).toBe('the inbox')
    expect(G(m1).labelIds).toContain('INBOX')
    expect(G(m1).labelIds).not.toContain(label.id)
    expect(await subjects({ view: 'inbox' })).toEqual(['Buy our stuff', 'Parts for 34006'])
    expect(await subjects({ view: 'all', label: label.id })).toEqual([])
  })

  it('renames and deletes a label; deleting never deletes mail', async () => {
    const { label } = await labelSave(me, { mailbox: box, name: 'Old name' })
    await labelSave(me, { mailbox: box, name: 'Other' })
    await labelApply(me, { mailbox: box, id: m1, label: label.id })
    await labelSave(me, { mailbox: box, id: label.id, name: 'New name' })
    expect((await labelList(me, { mailbox: box })).labels.map(l => l.name)).toEqual(['New name', 'Other'])
    await expect(labelSave(me, { mailbox: box, id: label.id, name: 'other' })).rejects.toThrow(/already a label/)
    await expect(labelSave(me, { mailbox: box, name: 'Inbox' })).rejects.toThrow(/Gmail keeps that name/)
    await expect(labelSave(me, { mailbox: box, name: '   ' })).rejects.toThrow(/Give the label a name/)

    await labelDelete(me, { mailbox: box, label: label.id })
    expect((await labelList(me, { mailbox: box })).labels.map(l => l.name)).toEqual(['Other'])
    expect(G(m1).labelIds).toContain('INBOX')                                                    // the message is still there
    expect((await listMessages(me, { mailbox: box, view: 'inbox' })).messages.find(m => m.id === m1)!.labels).toEqual([])
    await expect(labelApply(me, { mailbox: box, id: m1, label: label.id })).rejects.toThrow(/no longer in Gmail/)
    await expect(labelApply(me, { mailbox: box, id: m1, label: 'INBOX' })).rejects.toThrow(/No such label/)   // only labels people made, never Gmail's own
  })

  it('on a shared mailbox anyone with it can add and use a label, but only an owner renames, deletes or blocks', async () => {
    const asBob = await asMe(bob)
    const { label } = await labelSave(asBob, { mailbox: office, name: 'Statements' })
    expect((await labelList(asBob, { mailbox: office })).can_edit).toBe(false)
    await expect(labelSave(asBob, { mailbox: office, id: label.id, name: 'X' })).rejects.toBeInstanceOf(Forbidden)
    await expect(labelDelete(asBob, { mailbox: office, label: label.id })).rejects.toBeInstanceOf(Forbidden)
    await expect(blockSender(asBob, { mailbox: office, addr: 'pat@vendor.com' })).rejects.toBeInstanceOf(Forbidden)
    await expect(labelSave(asBob, { mailbox: box, name: 'Mine now' })).rejects.toBeInstanceOf(Forbidden)   // Ann's own mailbox is not on Bob's login at all
    expect(world.gmail.labels.get('ann@gmail.com')).toBeUndefined()
    const asAnn = await asMe(ann)
    expect((await labelList(asAnn, { mailbox: office })).can_edit).toBe(true)
    await labelDelete(asAnn, { mailbox: office, label: label.id })
    expect(world.gmail.labels.get('office@gmail.com')).toEqual([])
  })

  it('labels or moves every selected conversation in one go', async () => {
    const { label } = await labelSave(me, { mailbox: box, name: 'Batch' })
    const r = await bulk(me, { mailbox: box, ids: [m1, m2], action: 'label', label: label.id, move: true })
    expect(r).toMatchObject({ n: 2, failed: 0 })
    expect(r.moves.length).toBe(2)
    expect(await subjects({ view: 'inbox' })).toEqual([])
    expect(await subjects({ view: 'all', label: label.id })).toEqual(['Buy our stuff', 'Parts for 34006'])
    await expect(bulk(me, { mailbox: box, ids: [m1], action: 'label', label: 'nope' })).rejects.toThrow(/No such label/)
  })
})

describe('date and sender filters', () => {
  it('narrows the list by who it is from', async () => {
    expect(await subjects({ view: 'inbox', from: 'vendor.com' })).toEqual(['Parts for 34006'])
    expect(await subjects({ view: 'inbox', from: 'sam' })).toEqual(['Buy our stuff'])
    expect(await subjects({ view: 'inbox', from: 'nobody' })).toEqual([])
  })

  it('narrows the list by date, counting days the way the calendar on the wall does (Eastern)', async () => {
    // m2 arrived 3:30 AM UTC on the 12th, which is 10:30 PM on the 11th in Virginia.
    expect(await subjects({ view: 'inbox', after: '2026-11-11' })).toEqual(['Buy our stuff'])
    expect(await subjects({ view: 'inbox', after: '2026-11-12' })).toEqual([])
    expect(await subjects({ view: 'inbox', before: '2026-11-10' })).toEqual(['Parts for 34006'])
    expect(await subjects({ view: 'inbox', after: '2026-11-10', before: '2026-11-11' })).toEqual(['Buy our stuff', 'Parts for 34006'])
    expect(await subjects({ view: 'inbox', after: 'not a date' })).toEqual(['Buy our stuff', 'Parts for 34006'])
  })

  it('knows when a day starts in winter, in summer, and on the days the clocks change', () => {
    expect(easternDayStart('2026-11-23')).toBe('2026-11-23T05:00:00.000Z')
    expect(easternDayStart('2026-07-01')).toBe('2026-07-01T04:00:00.000Z')
    expect(easternDayStart('2026-03-08')).toBe('2026-03-08T05:00:00.000Z')      // clocks go forward later that morning
    expect(easternDayStart('2026-11-01')).toBe('2026-11-01T04:00:00.000Z')      // clocks go back later that morning
    expect(easternDayStart('2026-12-31', 1)).toBe('2027-01-01T05:00:00.000Z')
  })
})

describe('blocked senders', () => {
  it('blocking from a message sends that conversation to Trash, and Undo brings it back', async () => {
    const r = await blockSender(me, { mailbox: box, id: m2 })
    expect(r).toMatchObject({ blocked: true, addr: 'sam@spam.biz' })
    expect(G(m2).labelIds).toContain('TRASH')
    expect(await subjects({ view: 'inbox' })).toEqual(['Parts for 34006'])
    expect((await blockList(me, { mailbox: box })).blocked.map(b => b.addr)).toEqual(['sam@spam.biz'])
    await blockSender(me, { mailbox: box, addr: 'SAM@spam.biz', on: false })
    await undoMove(me, { move: r.move_id })
    expect(G(m2).labelIds).not.toContain('TRASH')
    expect((await blockList(me, { mailbox: box })).blocked).toEqual([])
  })

  it('new mail from a blocked sender goes straight to Gmail\'s Trash and never reaches the list; everyone else\'s arrives', async () => {
    await blockSender(me, { mailbox: box, addr: 'sam@spam.biz' })
    const again = world.gmail.add('ann@gmail.com', { from: 'Sam Seller <SAM@spam.biz>', subject: 'Buy more stuff' }).id
    const fine = world.gmail.add('ann@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'Order shipped' }).id
    await sync(me, box)
    expect(G(again).labelIds).toContain('TRASH')
    expect(G(again).labelIds).not.toContain('INBOX')
    expect(G(fine).labelIds).toContain('INBOX')
    expect(await subjects({ view: 'all' })).toEqual(['Buy our stuff', 'Order shipped', 'Parts for 34006'])   // the older one from Sam was not touched: only what arrives after the block
    expect(world.gmail.boxes.get('ann@gmail.com')!.length).toBe(4)                                              // nothing is ever deleted for good

    await blockSender(me, { mailbox: box, addr: 'sam@spam.biz', on: false })
    const later = world.gmail.add('ann@gmail.com', { from: 'sam@spam.biz', subject: 'Unblocked now' }).id
    await sync(me, box)
    expect(G(later).labelIds).toContain('INBOX')
  })

  it('a block on one mailbox does nothing to another mailbox', async () => {
    await blockSender(me, { mailbox: box, addr: 'pat@vendor.com' })
    const toOffice = world.gmail.add('office@gmail.com', { from: 'pat@vendor.com', subject: 'For the office' }).id
    await sync(me, office)
    expect(G(toOffice, 'office@gmail.com').labelIds).toContain('INBOX')
  })

  it('refuses nonsense: not an address, the mailbox\'s own address, a message it sent itself', async () => {
    await expect(blockSender(me, { mailbox: box, addr: 'not an address' })).rejects.toThrow(/does not look like/)
    await expect(blockSender(me, { mailbox: box, addr: 'Ann@gmail.com' })).rejects.toThrow(/own address/)
    const sent = world.gmail.add('ann@gmail.com', { from: 'ann@gmail.com', to: 'pat@vendor.com', subject: 'From me', labelIds: ['SENT'] }).id
    await sync(me, box)
    await expect(blockSender(me, { mailbox: box, id: sent })).rejects.toThrow(/sent from this mailbox/)
    expect((await blockList(me, { mailbox: box })).blocked).toEqual([])
  })
})

describe('download all as a zip', () => {
  const read = (z: Uint8Array) => {
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength), dec = new TextDecoder()
    const end = z.length - 22
    expect(v.getUint32(end, true)).toBe(0x06054b50)
    const n = v.getUint16(end + 10, true)
    let o = v.getUint32(end + 16, true)
    const out: { name: string; data: string; crc: number }[] = []
    for (let i = 0; i < n; i++) {
      expect(v.getUint32(o, true)).toBe(0x02014b50)
      const crc = v.getUint32(o + 16, true), size = v.getUint32(o + 24, true), nameLen = v.getUint16(o + 28, true), at = v.getUint32(o + 42, true)
      const name = dec.decode(z.subarray(o + 46, o + 46 + nameLen))
      expect(v.getUint32(at, true)).toBe(0x04034b50)
      const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true)
      out.push({ name, data: dec.decode(z.subarray(start, start + size)), crc })
      o += 46 + nameLen
    }
    return out
  }

  it('checks sums the way every unzip program expects', () => {
    const enc = new TextEncoder()
    expect(crc32(enc.encode('hello'))).toBe(0x3610a686)
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it('packs every file whole, and never lets two files share a name', () => {
    const enc = new TextEncoder()
    const z = makeZip([{ name: 'plan.pdf', data: enc.encode('first plan') }, { name: 'plan.pdf', data: enc.encode('second plan') }, { name: 'Büro/..\\notes.txt', data: enc.encode('') }])
    expect(read(z)).toEqual([
      { name: 'plan.pdf', data: 'first plan', crc: crc32(enc.encode('first plan')) },
      { name: 'plan (2).pdf', data: 'second plan', crc: crc32(enc.encode('second plan')) },
      { name: 'Büro_.._notes.txt', data: '', crc: 0 },
    ])
    expect(zipNames(['', '.hidden', 'a', 'A'])).toEqual(['attachment', '_hidden', 'a', 'A (2)'])
  })
})

describe('rules', () => {
  it('acts on mail as it arrives: label it, skip the inbox, mark it read, star it', async () => {
    const { ruleSave, ruleList } = await import('@/lib/rpmail/organize')
    const { label } = await labelSave(me, { mailbox: box, name: 'Statements' })
    await ruleSave(me, { mailbox: box, match: { from: 'VENDOR.com', subject: 'statement' }, action: { label: label.id, archive: true, read: true, star: true } })
    expect((await ruleList(me, { mailbox: box })).rules[0]).toMatchObject({ name: 'From VENDOR.com, Subject has statement', enabled: true })

    const hit = world.gmail.add('ann@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'November Statement' }).id
    const fromOnly = world.gmail.add('ann@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'Quote for the pumps' }).id   // right sender, wrong subject
    await sync(me, box)
    expect(G(hit).labelIds).toEqual(expect.arrayContaining([label.id, 'STARRED']))
    expect(G(hit).labelIds).not.toContain('INBOX')
    expect(G(hit).labelIds).not.toContain('UNREAD')
    expect(G(fromOnly).labelIds).toEqual(['INBOX', 'UNREAD'])
    expect(await subjects({ view: 'inbox' })).toEqual(['Buy our stuff', 'Parts for 34006', 'Quote for the pumps'])
    const filed = (await listMessages(me, { mailbox: box, view: 'filed' })).messages
    expect(filed.map(m => [m.subject, m.unread, m.starred, m.labels])).toEqual([['November Statement', false, true, [label.id]]])
  })

  it('never touches mail that was already here, and never fires twice on the same message', async () => {
    const { ruleSave } = await import('@/lib/rpmail/organize')
    await ruleSave(me, { mailbox: box, match: { from: 'pat@vendor.com' }, action: { archive: true } })
    await sync(me, box)
    expect(G(m1).labelIds).toContain('INBOX')                          // m1 is from Pat but arrived before the rule
    const later = world.gmail.add('ann@gmail.com', { from: 'pat@vendor.com', subject: 'New one' }).id
    await sync(me, box)
    expect(G(later).labelIds).not.toContain('INBOX')
    G(later).labelIds.push('INBOX')                                    // the person drags it back into the inbox in Gmail...
    world.gmail.fresh.set('ann@gmail.com', [later])                    // ...which Gmail reports as a change
    await sync(me, box)
    expect(G(later).labelIds).toContain('INBOX')                       // ...and the rule leaves it alone
  })

  it('a rule can send mail straight to Trash, and "never notify" keeps a notification from going out', async () => {
    const { ruleSave } = await import('@/lib/rpmail/organize')
    await ruleSave(me, { mailbox: box, match: { subject: 'webinar' }, action: { trash: true, star: true } })
    await ruleSave(me, { mailbox: box, match: { from: 'alerts@bank.com' }, action: { quiet: true } })
    const junk = world.gmail.add('ann@gmail.com', { from: 'x@events.com', subject: 'Join our WEBINAR' }).id
    const bank = world.gmail.add('ann@gmail.com', { from: 'alerts@bank.com', subject: 'Deposit received' }).id
    await sync(me, box)
    expect(G(junk).labelIds).toContain('TRASH')
    expect(G(junk).labelIds).not.toContain('STARRED')                  // Trash on its own: nothing else is done to it
    expect(G(bank).labelIds).toEqual(['INBOX', 'UNREAD'])              // still in the inbox, untouched in Gmail
    expect(world.db.t('rpmail_messages').find(m => m.gmail_id === bank)!.quiet).toBe(true)
    expect(world.db.t('rpmail_messages').find(m => m.gmail_id === m1)!.quiet).toBe(false)
  })

  it('refuses a rule that would catch everything or do nothing, and a rule change by someone who is not the owner', async () => {
    const { ruleSave, ruleDelete, ruleList } = await import('@/lib/rpmail/organize')
    await expect(ruleSave(me, { mailbox: box, match: {}, action: { archive: true } })).rejects.toThrow(/has to match/)
    await expect(ruleSave(me, { mailbox: box, match: { from: 'a' }, action: { archive: true } })).rejects.toThrow(/at least two characters/)
    await expect(ruleSave(me, { mailbox: box, match: { from: 'pat' }, action: {} })).rejects.toThrow(/what should happen/)
    await expect(ruleSave(me, { mailbox: box, match: { from: 'pat' }, action: { label: 'Label_99' } })).rejects.toThrow(/no longer in Gmail/)
    const asBob = await asMe(bob)
    await expect(ruleSave(asBob, { mailbox: office, match: { from: 'pat' }, action: { trash: true } })).rejects.toBeInstanceOf(Forbidden)
    expect((await ruleList(asBob, { mailbox: office })).can_edit).toBe(false)
    const asAnn = await asMe(ann)
    const { id } = await ruleSave(asAnn, { mailbox: office, match: { from: 'pat' }, action: { read: true } })
    await expect(ruleDelete(asBob, { mailbox: office, id })).rejects.toBeInstanceOf(Forbidden)
    await ruleSave(asAnn, { mailbox: office, id, match: { from: 'pat' }, action: { read: true }, enabled: false })
    const off = world.gmail.add('office@gmail.com', { from: 'pat@vendor.com', subject: 'Switched off' }).id
    await sync(asAnn, office)
    expect(G(off, 'office@gmail.com').labelIds).toContain('UNREAD')    // a rule that is switched off does nothing
    await ruleDelete(asAnn, { mailbox: office, id })
    expect((await ruleList(asAnn, { mailbox: office })).rules).toEqual([])
  })
})

describe('snooze and remind me', () => {
  const HOUR = 3_600_000
  it('a snoozed conversation leaves my Inbox and Needs you, but nobody else\'s, and nothing changes in Gmail', async () => {
    const { setSnooze } = await import('@/lib/rpmail/snooze')
    const om = world.db.t('rpmail_messages').find(m => m.mailbox_id === office)!.gmail_id as string
    const asBob = await asMe(bob)
    await setSnooze(asBob, { mailbox: office, id: om, until: Date.now() + 2 * HOUR })
    expect((await listMessages(asBob, { mailbox: office, view: 'inbox' })).messages).toEqual([])
    expect((await listMessages(asBob, { mailbox: office, view: 'needs' })).messages).toEqual([])
    const z = (await listMessages(asBob, { mailbox: office, view: 'snoozed' })).messages
    expect(z.map(m => m.subject)).toEqual(['Statement'])
    expect(z[0].snooze).toMatchObject({ kind: 'snooze', woke: false })
    expect((await listMessages(asBob, { mailbox: office, view: 'all' })).messages.length).toBe(1)      // still findable
    const asAnn = await asMe(ann)
    expect((await listMessages(asAnn, { mailbox: office, view: 'inbox' })).messages.map(m => m.subject)).toEqual(['Statement'])   // Ann sees no difference
    expect((await listMessages(asAnn, { mailbox: office, view: 'needs' })).messages.length).toBe(1)
    expect(G(om, 'office@gmail.com').labelIds).toEqual(['INBOX', 'UNREAD'])
    await setSnooze(await asMe(bob), { mailbox: office, id: om, on: false })
    expect((await listMessages(await asMe(bob), { mailbox: office, view: 'inbox' })).messages.length).toBe(1)
  })

  it('refuses a time that has passed or is more than a year off', async () => {
    const { setSnooze } = await import('@/lib/rpmail/snooze')
    await expect(setSnooze(me, { mailbox: box, id: m1, until: Date.now() - HOUR })).rejects.toThrow(/still to come/)
    await expect(setSnooze(me, { mailbox: box, id: m1, until: 'whenever' })).rejects.toThrow(/still to come/)
    await expect(setSnooze(me, { mailbox: box, id: m1, until: Date.now() + 400 * 24 * HOUR })).rejects.toThrow(/within the next year/)
  })
})
