import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { sendMail } from '@/lib/rpmail/mail-ops'
import { draftList, draftOpen } from '@/lib/rpmail/drafts'

// Drafts saved to Gmail Drafts, opened again in RPMail to finish. A reopened draft is updated or sent in place, so
// Gmail never ends up with a second copy, and it keeps the conversation and files it had.

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
let ann: Person, bob: Person, me: Me, box: string, bobBox: string, shared: string
const last = () => world.gmail.sent.at(-1)!

beforeEach(async () => {
  ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com'); bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
  box = addBox(A, 'ann@gmail.com', 'personal', [ann]); bobBox = addBox(A, 'bob@gmail.com', 'personal', [bob])
  shared = addBox(A, 'office@gmail.com', 'shared', [ann])
  world.user = ann.id
  me = await requireMe()
  await syncMailbox(await mailboxFor(me, box))
})

describe('listing and opening drafts', () => {
  it('lists the drafts in a mailbox, newest first, with who, subject and first words', async () => {
    world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Older draft', body: 'first words', date: Date.now() - 5000 })
    const d2 = world.gmail.addDraft('ann@gmail.com', { to: 'Bo <bo@vendor.com>', subject: 'Newer draft', body: 'more words', date: Date.now() - 1000 })
    const r = await draftList(me, { mailbox: box })
    expect(r.drafts.map(d => d.subject)).toEqual(['Newer draft', 'Older draft'])
    expect(r.drafts[0]).toMatchObject({ id: d2.id, to: 'bo@vendor.com', snippet: 'more words' })
  })

  it('opens a draft with its formatting (as far as RPMail allows) and the files on it', async () => {
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', cc: 'bo@vendor.com', subject: 'Plan', body: 'See the plan', html: '<div>See the <b>plan</b><script>x()</script></div>',
      files: [{ name: 'plan.pdf', type: 'application/pdf', data: Buffer.from('%PDF-plan') }] })
    const r = await draftOpen(me, { mailbox: box, draft: d.id })
    expect(r).toMatchObject({ to: 'pat@vendor.com', cc: 'bo@vendor.com', subject: 'Plan', html: '<div>See the <b>plan</b></div>', reply: false, attachments: [{ i: 0, name: 'plan.pdf', size: 9 }] })
  })

  it('brings a draft\'s pictures back into the text, as the person\'s own waiting pictures, so they go out again', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')])
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Pic', body: 'See [picture]', html: '<div>See <img src="cid:pic1@x"></div>',
      files: [{ name: 'check.png', type: 'image/png', data: png, cid: 'pic1@x' }, { name: 'fake.png', type: 'image/png', data: Buffer.from('<html>'), cid: 'pic2@x' }] })
    const r = await draftOpen(me, { mailbox: box, draft: d.id })
    const path = [...world.db.files.keys()].find(k => k.startsWith(ann.id + '/'))!
    expect(path).toMatch(/\/check\.png$/)
    expect(r.html).toBe(`<div>See <img src="/api/rpmail/attach_view?path=${encodeURIComponent(path)}"></div>`)
    expect(world.db.files.size).toBe(1)                     // the one that is not really a picture is not kept
    expect(r.attachments).toEqual([])
    // and it goes out again inside the mail
    await sendMail(me, { mailbox: box, mode: 'new', draft_id: d.id, to: 'pat@vendor.com', subject: 'Pic', html: r.html, confirmed: true })
    expect(world.gmail.sent.find(s => s.draft)!.raw).toContain('multipart/related')
  })

  it('opens a plain draft as lines', async () => {
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Plain', body: 'line one\nline two' })
    expect((await draftOpen(me, { mailbox: box, draft: d.id })).html).toBe('<div>line one</div><div>line two</div>')
  })

  it('only opens drafts in a mailbox the person has, and says so when a draft is gone', async () => {
    const theirs = world.gmail.addDraft('bob@gmail.com', { to: 'x@y.com', subject: 'Bob only' })
    await expect(draftOpen(me, { mailbox: bobBox, draft: theirs.id })).rejects.toThrow()
    await expect(draftList(me, { mailbox: bobBox })).rejects.toThrow()
    await expect(draftOpen(me, { mailbox: box, draft: theirs.id })).rejects.toThrow(/no longer in Gmail/)
    await expect(draftOpen(me, { mailbox: box, draft: '../x' })).rejects.toThrow(/No such draft/)
  })
})

describe('finishing a draft', () => {
  it('sends a reopened draft as itself: updated, then sent, and gone from Drafts', async () => {
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Plan', body: 'old words' })
    await sendMail(me, { mailbox: box, mode: 'new', draft_id: d.id, to: 'pat@vendor.com', subject: 'Plan', html: '<div>New <b>words</b></div>', confirmed: true })
    const calls = world.gmail.calls.filter(c => c.path.startsWith('drafts')).map(c => `${c.method} ${c.path}`)
    expect(calls).toEqual([`GET drafts/${d.id}`, `PUT drafts/${d.id}`, 'POST drafts/send'])
    expect(last()).toMatchObject({ draft: false })
    expect(last().raw).toContain('Subject: Plan')
    expect((await draftList(me, { mailbox: box })).drafts).toEqual([])
    expect(world.gmail.calls.some(c => c.path === 'messages/send')).toBe(false)
  })

  it('saving again updates the same draft instead of making a second one', async () => {
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Plan', body: 'old' })
    await sendMail(me, { mailbox: box, mode: 'new', draft_id: d.id, to: 'pat@vendor.com', subject: 'Plan v2', body: 'still going', draft: true })
    expect(world.gmail.calls.some(c => c.method === 'POST' && c.path === 'drafts')).toBe(false)
    expect(last()).toMatchObject({ draft: true })
    expect(last().raw).toContain('Subject: Plan v2')
    expect((await draftList(me, { mailbox: box })).drafts.length).toBe(1)
  })

  it('keeps the files the person kept, and drops the ones taken off', async () => {
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Files', body: 'x',
      files: [{ name: 'keep.pdf', type: 'application/pdf', data: Buffer.from('%PDF-keep') }, { name: 'drop.pdf', type: 'application/pdf', data: Buffer.from('%PDF-drop') }] })
    await sendMail(me, { mailbox: box, mode: 'new', draft_id: d.id, to: 'pat@vendor.com', subject: 'Files', body: 'x', confirmed: true, keep: [0] })
    expect(last().raw).toContain('filename="keep.pdf"')
    expect(last().raw).not.toContain('drop.pdf')
  })

  it('a reply draft stays in its conversation, with its reply headers', async () => {
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Re: Parts', body: 'reply', threadId: 'abcdef0123456789', headers: { 'In-Reply-To': '<orig@vendor.com>', References: '<orig@vendor.com>' } })
    expect((await draftOpen(me, { mailbox: box, draft: d.id })).reply).toBe(true)
    await sendMail(me, { mailbox: box, mode: 'new', draft_id: d.id, to: 'pat@vendor.com', subject: 'Re: Parts', body: 'reply', confirmed: true })
    const put = world.gmail.sent.find(s => s.draft)!
    expect(put.raw).toContain('In-Reply-To: <orig@vendor.com>')
    expect(put.threadId).toBe('abcdef0123456789')
  })

  it('goes out from the mailbox the draft is in, whatever the page asks', async () => {
    const d = world.gmail.addDraft('ann@gmail.com', { to: 'pat@vendor.com', subject: 'Here', body: 'x' })
    await sendMail(me, { mailbox: box, from: shared, mode: 'new', draft_id: d.id, to: 'pat@vendor.com', subject: 'Here', body: 'x', confirmed: true })
    expect(last().account).toBe('ann@gmail.com')
    expect(last().raw).toContain('From: "Ann Owner" <ann@gmail.com>')
  })

  it('still runs the pricing rule on a reopened draft and its files', async () => {
    const crew = addBox(A, 'econstruction.rp@gmail.com', 'shared', [ann], { crew_reads: true })
    const d = world.gmail.addDraft('econstruction.rp@gmail.com', { to: 'c@example.com', subject: 'Photos', body: 'x', files: [{ name: 'invoice 12.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }] })
    await expect(sendMail(me, { mailbox: crew, mode: 'new', draft_id: d.id, to: 'c@example.com', subject: 'Photos', body: 'See attached', confirmed: true, keep: [0] })).rejects.toThrow(/Blocked/)
    expect(world.gmail.sent).toEqual([])
  })
})
