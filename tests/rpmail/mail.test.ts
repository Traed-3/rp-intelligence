import { beforeEach, describe, expect, it, vi } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { mailboxFor } from '@/lib/rpmail/access'
import { listMessages, readMessage, fileMessage, undoMove, markRead, markDone, sendMail, searchGmail } from '@/lib/rpmail/mail-ops'
import { setStar, bulk, doneList, setPrefs, getPrefs } from '@/lib/rpmail/extras'
import { contacts, templateSave, templateList, templateDelete } from '@/lib/rpmail/compose-ops'
import { overview } from '@/lib/rpmail/overview'
import { NotConnected } from '@/lib/rpmail/gmail'

// Everyday mail, run against the stand-in Gmail: loading, reading, filing with Undo, and sending.

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
let ann: Person, me: Me, box: string, crew: string, other: string
let m1: string, m2: string, withFile: string
const G = (id: string, account = 'ann@gmail.com') => world.gmail.get(account, id)!
const lastRaw = () => world.gmail.sent.at(-1)!.raw
const textOf = (raw: string) => Buffer.from(raw.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8')

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
  box = addBox(A, 'ann@gmail.com', 'personal', [ann])
  crew = addBox(A, 'econstruction.rp@gmail.com', 'shared', [ann], { crew_reads: true })
  other = addBox(A, 'office@gmail.com', 'shared', [ann])
  m1 = world.gmail.add('ann@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'Parts for 34006', body: 'Can you confirm the order? PO# 24275', html: '<p>Can you confirm?</p><script>alert(1)</script><img src=x onerror="steal()">' }).id
  m2 = world.gmail.add('ann@gmail.com', { from: 'News <newsletter@shop.com>', subject: 'Sale', body: 'Buy now', headers: { 'List-Unsubscribe': '<x>' } }).id
  withFile = world.gmail.add('ann@gmail.com', { from: 'pat@vendor.com', subject: 'Drawing', body: 'Attached.', files: [{ name: 'plan.pdf', type: 'application/pdf', data: Buffer.from('%PDF-plan') }] }).id
  world.user = ann.id
  me = await requireMe()
  await syncMailbox(await mailboxFor(me, box))
})

describe('loading and reading', () => {
  it('loads the mailbox into the list, with unread, attachment, PO and bulk worked out', async () => {
    const { messages } = await listMessages(me, { mailbox: box, view: 'inbox' })
    expect(messages.map(m => m.subject).sort()).toEqual(['Drawing', 'Parts for 34006', 'Sale'])
    expect(messages.find(m => m.id === m1)).toMatchObject({ unread: true, po: '24275', from_addr: 'pat@vendor.com' })
    expect(messages.find(m => m.id === withFile)!.has_att).toBe(true)
    const needs = await listMessages(me, { mailbox: box, view: 'needs' })
    expect(needs.messages.map(m => m.id)).not.toContain(m2)      // a newsletter never "needs you"
    expect(needs.messages.map(m => m.id)).toContain(m1)
  })

  it('treats mail Gmail filed under Promotions as a newsletter, even without the usual newsletter headers', async () => {
    const promo = world.gmail.add('ann@gmail.com', { from: 'Deals <deals@shop.com>', subject: 'Can you believe these prices?', body: 'Can you believe it?', labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'] }).id
    const notice = world.gmail.add('ann@gmail.com', { from: 'Accounts <accounts@bank.com>', subject: 'Please confirm you believe this', body: 'Please confirm.', labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'] }).id
    await searchGmail(me, { mailbox: box, q: 'believe' })
    expect((await listMessages(me, { mailbox: box, view: 'needs' })).messages.map(m => m.id)).not.toContain(notice)
    expect((await listMessages(me, { mailbox: box, view: 'needs' })).messages.map(m => m.id)).not.toContain(promo)
    expect((await listMessages(me, { mailbox: box, view: 'inbox' })).messages.map(m => m.id)).toContain(promo)
  })

  it('stores no message text: only the short list', async () => {
    const stored = JSON.stringify(world.db.t('rpmail_messages'))
    expect(stored).not.toContain('%PDF-plan')
    expect(Object.keys(world.db.t('rpmail_messages')[0])).not.toContain('body')
  })

  it('opening a message does not mark it read, and strips anything that could run', async () => {
    const m = await readMessage(me, { mailbox: box, id: m1 })
    expect(G(m1).labelIds).toContain('UNREAD')
    expect(m.html).not.toMatch(/<script|onerror|alert\(1\)/i)
    expect(m.text).toContain('Can you confirm')
  })

  it('searches all of Gmail and filters the list', async () => {
    expect((await searchGmail(me, { mailbox: box, q: 'drawing' })).messages.map(m => m.id)).toEqual([withFile])
    expect((await listMessages(me, { mailbox: box, view: 'inbox', att: '1' })).messages.map(m => m.id)).toEqual([withFile])
    expect((await listMessages(me, { mailbox: box, view: 'inbox', q: 'vendor parts' })).messages.map(m => m.id)).toEqual([m1])
  })

  it('says the sign-in has ended when Google has revoked it', async () => {
    const b = addBox(A, 'gone@gmail.com', 'shared', [ann])
    world.gmail.revoked.add('gone@gmail.com')
    await expect(syncMailbox(await mailboxFor(me, b))).rejects.toBeInstanceOf(NotConnected)
    expect(String(world.db.t('rpmail_mailboxes').find(x => x.id === b)!.last_error)).toMatch(/sign-in/i)
  })
})

describe('when Google says slow down', () => {
  it('says Gmail is busy (not that the sign-in is wrong) and loads a big mailbox without bursting past the limit', async () => {
    const { Busy, pace } = await import('@/lib/rpmail/gmail')
    const real = world.gmail.fetch
    vi.stubGlobal('fetch', async (u: string | URL | Request, i?: RequestInit) => String(u).includes('/messages/') ? new Response(JSON.stringify({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }), { status: 403 }) : real(u, i))
    vi.useFakeTimers()
    const p = readMessage(me, { mailbox: box, id: m1 }).catch(e => e)
    await vi.runAllTimersAsync()
    expect(await p).toBeInstanceOf(Busy)
    vi.useRealTimers(); vi.stubGlobal('fetch', real)
    const t = Date.now()
    await Promise.all(Array.from({ length: 10 }, () => pace('pace-test', 50)))
    expect(Date.now() - t).toBeGreaterThanOrEqual(150)     // 10 calls at 50 a second cannot finish in under ~180 ms
  })
})

describe('filing, with Undo', () => {
  it('archives and puts back', async () => {
    const r = await fileMessage(me, { mailbox: box, id: m1, dest: 'Archive' })
    expect(G(m1).labelIds).not.toContain('INBOX')
    expect((await listMessages(me, { mailbox: box, view: 'inbox' })).messages.map(m => m.id)).not.toContain(m1)
    await undoMove(me, { move: r.move_id })
    expect(G(m1).labelIds).toContain('INBOX')
    expect((await listMessages(me, { mailbox: box, view: 'inbox' })).messages.map(m => m.id)).toContain(m1)
    await expect(undoMove(me, { move: r.move_id })).rejects.toThrow(/already/)
  })

  it('delete goes to Gmail Trash (never a permanent delete) and can be undone', async () => {
    const r = await fileMessage(me, { mailbox: box, id: m1, dest: 'Trash' })
    expect(G(m1).labelIds).toContain('TRASH')
    expect(world.gmail.calls.some(c => c.method === 'DELETE')).toBe(false)
    await undoMove(me, { move: r.move_id })
    expect(G(m1).labelIds).not.toContain('TRASH')
    expect(G(m1).labelIds).toContain('INBOX')
  })

  it('marks read and unread, stars, and acts on a selection', async () => {
    await markRead(me, { mailbox: box, id: m1 }); expect(G(m1).labelIds).not.toContain('UNREAD')
    await markRead(me, { mailbox: box, id: m1, unread: true }); expect(G(m1).labelIds).toContain('UNREAD')
    await setStar(me, { mailbox: box, id: m1 }); expect(G(m1).labelIds).toContain('STARRED')
    expect((await listMessages(me, { mailbox: box, view: 'inbox', starred: '1' })).messages.map(m => m.id)).toEqual([m1])
    const r = await bulk(me, { mailbox: box, ids: [m1, m2], action: 'Archive' })
    expect(r).toMatchObject({ n: 2, failed: 0 }); expect(r.moves.length).toBe(2)
    expect(G(m2).labelIds).not.toContain('INBOX')
    await expect(bulk(me, { mailbox: box, ids: [m1], action: 'delete forever' })).rejects.toThrow()
  })

  it('Done takes mail off the person\'s lists without touching Gmail, and can be put back', async () => {
    await markDone(me, { mailbox: box, id: m1 })
    expect((await listMessages(me, { mailbox: box, view: 'needs' })).messages.map(m => m.id)).not.toContain(m1)
    expect(G(m1).labelIds).toEqual(['INBOX', 'UNREAD'])
    expect((await doneList(me)).items.map(i => i.id)).toEqual([m1])
    await markDone(me, { mailbox: box, id: m1, on: false })
    expect((await listMessages(me, { mailbox: box, view: 'needs' })).messages.map(m => m.id)).toContain(m1)
  })
})

describe('sending', () => {
  it('sends nothing without the person\'s confirm', async () => {
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Hi', body: 'Hello' })).rejects.toThrow(/confirm/i)
    expect(world.gmail.sent).toEqual([])
  })

  it('sends a new message from the chosen mailbox and records who sent it', async () => {
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com, bo@vendor.com', cc: 'cc@vendor.com', subject: 'Schedule', body: 'See you Monday', confirmed: true })
    const s = world.gmail.sent.at(-1)!
    expect(s).toMatchObject({ account: 'ann@gmail.com', draft: false })
    expect(s.raw).toContain('From: "Ann Owner" <ann@gmail.com>')
    expect(s.raw).toContain('To: pat@vendor.com, bo@vendor.com')
    expect(s.raw).toContain('Cc: cc@vendor.com')
    expect(textOf(s.raw)).toBe('See you Monday')
    expect(world.db.t('rpmail_sent').at(-1)).toMatchObject({ profile_id: ann.id, mailbox_id: box, kind: 'send' })
  })

  it('a reply stays in the conversation and quotes the original', async () => {
    await sendMail(me, { mailbox: box, mode: 'reply', id: m1, to: 'pat@vendor.com', body: 'Confirmed.', confirmed: true })
    const s = world.gmail.sent.at(-1)!
    expect(s.threadId).toBe(G(m1).threadId)
    expect(s.raw).toContain(`In-Reply-To: <${m1}@fake>`)
    expect(s.raw).toContain('Subject: Re: Parts for 34006')
    expect(textOf(s.raw)).toMatch(/^Confirmed\.\r\n\r\nOn .*Pat Vendor <pat@vendor\.com> wrote:\r\n> Can you confirm/)
  })

  it('a reply can go out from another of the person\'s mailboxes', async () => {
    await sendMail(me, { mailbox: box, from: other, mode: 'reply', id: m1, to: 'pat@vendor.com', body: 'From the office.', confirmed: true })
    const s = world.gmail.sent.at(-1)!
    expect(s.account).toBe('office@gmail.com')
    expect(s.raw).toContain('<office@gmail.com>')
    expect(s.threadId).toBeUndefined()
    expect(s.raw).toContain(`In-Reply-To: <${m1}@fake>`)
  })

  it('a forward carries the original attachments, plus files the person attached, then clears the waiting files', async () => {
    const path = `${ann.id}/22222222-2222-4222-8222-222222222222/photo.jpg`
    world.db.files.set(path, { data: Buffer.from('JPEGDATA'), type: 'image/jpeg' })
    await sendMail(me, { mailbox: box, mode: 'forward', id: withFile, to: 'bo@vendor.com', body: 'FYI', confirmed: true, files: [path] })
    const raw = lastRaw()
    expect(raw).toContain('filename="plan.pdf"'); expect(raw).toContain(Buffer.from('%PDF-plan').toString('base64'))
    expect(raw).toContain('filename="photo.jpg"'); expect(raw).toContain(Buffer.from('JPEGDATA').toString('base64'))
    expect(raw).toContain('Subject: Fwd: Drawing')
    expect(world.db.files.size).toBe(0)
  })

  it('refuses attachments that add up to more than 20 MB', async () => {
    const p1 = `${ann.id}/33333333-3333-4333-8333-333333333333/a.bin`, p2 = `${ann.id}/44444444-4444-4444-8444-444444444444/b.bin`
    world.db.files.set(p1, { data: Buffer.alloc(11_000_000), type: 'application/octet-stream' }); world.db.files.set(p2, { data: Buffer.alloc(11_000_000), type: 'application/octet-stream' })
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Big', body: 'x', confirmed: true, files: [p1, p2] })).rejects.toThrow(/20 MB/)
    expect(world.gmail.sent).toEqual([])
  })

  it('save to drafts sends nothing', async () => {
    const r = await sendMail(me, { mailbox: box, mode: 'new', to: '', subject: 'Later', body: 'unfinished', draft: true })
    expect(r).toMatchObject({ draft: true })
    expect(world.gmail.sent.map(s => s.draft)).toEqual([true])
  })

  it('rejects a bad address and a line break smuggled into the subject', async () => {
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'not an address', subject: 'x', body: 'x', confirmed: true })).rejects.toThrow(/does not look like/)
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'a@b.com', subject: 'x\r\nBcc: evil@x.com', body: 'x', confirmed: true })).rejects.toThrow()
    expect(world.gmail.sent).toEqual([])
  })
})

describe('customer pricing never goes to or from a mailbox the crew reads', () => {
  const tries: [string, Record<string, unknown>][] = [
    ['from the crew mailbox', { mailbox: 'CREW', mode: 'new', to: 'customer@example.com', subject: 'Quote', body: 'The price is $4,500' }],
    ['to econstruction.rp', { mailbox: 'BOX', mode: 'new', to: 'econstruction.rp@gmail.com', subject: 'FYI', body: 'Invoice total $900' }],
    ['cc to econstruction.rp', { mailbox: 'BOX', mode: 'new', to: 'customer@example.com', cc: 'Econstruction.RP@gmail.com', subject: 'Estimate attached', body: 'see below' }],
    ['pricing only in an attachment name', { mailbox: 'CREW', mode: 'new', to: 'customer@example.com', subject: 'Paperwork', body: 'Attached.', files: ['FILE'] }],
  ]
  for (const [name, p] of tries) it('blocks pricing ' + name, async () => {
    const path = `${ann.id}/55555555-5555-4555-8555-555555555555/Quote 34006.pdf`
    world.db.files.set(path, { data: Buffer.from('x'), type: 'application/pdf' })
    const args = { ...p, mailbox: p.mailbox === 'CREW' ? crew : box, files: p.files ? [path] : undefined, confirmed: true }
    await expect(sendMail(me, args)).rejects.toThrow(/Blocked/)
    expect(world.gmail.sent).toEqual([])
  })

  it('blocks pricing hidden in the quoted mail under a reply sent from the crew mailbox', async () => {
    const q = world.gmail.add('ann@gmail.com', { from: 'pat@vendor.com', subject: 'Numbers', body: 'Our quote is $12,000' }).id
    await expect(sendMail(me, { mailbox: box, from: crew, mode: 'reply', id: q, to: 'pat@vendor.com', body: 'Thanks', confirmed: true })).rejects.toThrow(/Blocked/)
    expect(world.gmail.sent).toEqual([])
  })

  it('lets ordinary mail through the crew mailbox', async () => {
    await sendMail(me, { mailbox: crew, mode: 'new', to: 'customer@example.com', subject: 'Crew arrives Monday', body: 'See you at 7.', confirmed: true })
    expect(world.gmail.sent.length).toBe(1)
  })
})

describe('the person\'s own settings and helpers', () => {
  it('keeps box order, closed boxes and the undo time, and ignores junk', async () => {
    await setPrefs(me, { hidden: [crew, 'not-an-id'], order: [other, box], undo_secs: 20 })
    expect(await getPrefs(me)).toMatchObject({ hidden: [crew], order: [other, box], undo_secs: 20, notify: { on: false } })
    await setPrefs(me, { undo_secs: 999 })
    expect((await getPrefs(me)).undo_secs).toBe(10)
  })

  it('offers people from the person\'s own mail as they type', async () => {
    const r = await contacts(me, { q: 'pat' })
    expect(r.contacts[0]).toEqual({ name: 'Pat Vendor', addr: 'pat@vendor.com' })
    expect((await contacts(me, { q: 'p' })).contacts).toEqual([])
  })

  it('saves, lists and deletes templates', async () => {
    await templateSave(me, { name: 'Permit received', body: 'Attached is the permit.' })
    const t = (await templateList(me)).templates as { id: string; name: string }[]
    expect(t.map(x => x.name)).toEqual(['Permit received'])
    await templateDelete(me, { id: t[0].id })
    expect((await templateList(me)).templates).toEqual([])
  })

  it('builds the dashboard', async () => {
    const o = await overview(me)
    expect(o.boxes.find(b => b.id === box)).toMatchObject({ connected: true, inbox: 3, unread: 3 })
    expect(o.needs.map(n => n.id)).toContain(m1)
  })
})

describe('settings a person makes for themselves', () => {
  it('uses the name they chose on mail they send, and falls back to their RP Intelligence name', async () => {
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'One', body: 'Hi', confirmed: true })
    expect(lastRaw()).toContain('From: "Ann Owner" <ann@gmail.com>')
    await setPrefs(me, { sender_name: '  Ann <the> "Boss"\r\nBcc: x@evil.com  ' })                  // nothing that could start a new header line gets through
    expect((await getPrefs(me)).sender_name).toBe('Ann the Boss Bcc: x@evil.com')
    await setPrefs(me, { sender_name: 'Ann at RP' })
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Two', body: 'Hi', confirmed: true })
    expect(lastRaw()).toContain('From: "Ann at RP" <ann@gmail.com>')
    expect(lastRaw()).not.toContain('Bcc:')
  })

  it('keeps only settings that make sense, and never loses the ones that were not named', async () => {
    await setPrefs(me, { undo_secs: 20, tz: 'America/Chicago', density: 'compact', default_from: box, start: other })
    await setPrefs(me, { tz: 'Mars/Olympus', density: 'tiny', default_from: 'not-an-id' })
    expect(await getPrefs(me)).toMatchObject({ undo_secs: 20, tz: 'America/New_York', density: 'comfortable', default_from: '', start: other })
    await setPrefs(me, { groups: [{ name: ' Estimating  team ', addrs: 'Pat@Vendor.com, pat@vendor.com; not-an-address, sam@x.io' }, { name: '', addrs: ['a@b.co'] }, { name: 'Empty', addrs: [] }] })
    expect((await getPrefs(me)).groups).toEqual([{ name: 'Estimating team', addrs: ['pat@vendor.com', 'sam@x.io'] }])
  })

  it('leaves the mailboxes a person unticked out of their own lists, and only their lists', async () => {
    const office = world.gmail.add('office@gmail.com', { from: 'Sam Store <sam@store.com>', subject: 'Can someone call me about 34006?', body: 'Please call back.' }).id
    await syncMailbox(await mailboxFor(me, other))
    expect((await overview(me)).needs.map(n => n.id)).toContain(office)

    await setPrefs(me, { lists_off: [other, 'not-an-id'] })
    expect((await getPrefs(me)).lists_off).toEqual([other])                     // only real ids are kept
    const o = await overview(me)
    expect(o.needs.map(n => n.id)).not.toContain(office)                       // gone from Needs you
    expect(o.needs.map(n => n.id)).toContain(m1)                               // the other mailboxes still count
    expect(o.boxes.map(b => b.id)).toContain(other)                            // the mailbox itself is still there
    expect((await listMessages(me, { mailbox: other, view: 'needs' })).messages.map(m => m.id)).toContain(office)   // and its own Needs you view

    await setPrefs(me, { undo_secs: 5 })                                       // saving something else keeps the choice
    expect((await getPrefs(me)).lists_off).toEqual([other])
    await setPrefs(me, { lists_off: [] })
    expect((await overview(me)).needs.map(n => n.id)).toContain(office)
  })

  it('counts the days of a date filter by the person\'s own clock', async () => {
    const late = world.gmail.add('ann@gmail.com', { from: 'pat@vendor.com', subject: 'Late night', date: Date.parse('2026-11-12T06:00:00Z') }).id   // 1 AM Eastern on the 12th, 10 PM Pacific on the 11th
    await syncMailbox(await mailboxFor(me, box))
    const has = async () => (await listMessages(me, { mailbox: box, view: 'all', after: '2026-11-12', before: '2026-11-12' })).messages.some(m => m.id === late)
    expect(await has()).toBe(true)
    await setPrefs(me, { tz: 'America/Los_Angeles' })
    expect(await has()).toBe(false)
  })
})
