import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { readMessage } from '@/lib/rpmail/mail-ops'
import { replyQuoteHtml } from '@/lib/rpmail/rich'
import { buildStack, startOpen, shownOf, isForward, htmlHasQuote, splitPlainQuote, shownText, ownPictures, frameHeight, messageDoc, QUOTE_CSS, type StackItem } from '@/lib/rpmail/thread-view'

// The conversation view: every message of a conversation stacked in the reader. Opening one message brings back who and
// when for all the others (from Gmail, live), but the text of the others is only fetched when each is pressed.

const item = (id: string, date: number, extra: Partial<StackItem> = {}): StackItem => ({ id, date, from_name: 'Pat', from_addr: 'pat@vendor.com', snippet: 's', unread: false, sent: false, ...extra })

describe('laying out a conversation', () => {
  it('stacks oldest first with the opened message in its place, and never twice', () => {
    const stack = buildStack(item('c', 300), [item('a', 100), item('d', 400), item('b', 200), item('c', 300)])
    expect(stack.map(t => t.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('starts with the picked message open, plus the newest three that are still unread', () => {
    const others = [item('a', 1, { unread: true }), item('b', 2, { unread: true }), item('c', 3), item('d', 4, { unread: true }), item('e', 5, { unread: true })]
    expect(startOpen('z', others)).toEqual(['z', 'e', 'd', 'b'])
    expect(startOpen('z', [item('a', 1)])).toEqual(['z'])
  })

  it('keeps a long conversation short until asked: the newest eight, and anything that is open', () => {
    const stack = Array.from({ length: 20 }, (_, i) => item('m' + i, i))
    const first = shownOf(stack, new Set(['m19', 'm2']), false)
    expect(first.shown.map(t => t.id)).toEqual(['m2', 'm12', 'm13', 'm14', 'm15', 'm16', 'm17', 'm18', 'm19'])
    expect(first.hidden).toBe(11)
    expect(shownOf(stack, new Set(), true)).toEqual({ shown: stack, hidden: 0 })
    expect(shownOf(stack.slice(0, 8), new Set(), false).hidden).toBe(0)
  })

  it('knows a forward, so the forwarded mail is never folded away', () => {
    expect(isForward('Fwd: Drawing', '')).toBe(true)
    expect(isForward('FW: Drawing', '')).toBe(true)
    expect(isForward('Drawing', 'FYI\n\n---------- Forwarded message ---------\nFrom: Pat')).toBe(true)
    expect(isForward('Re: Drawing', 'Thanks\n\nOn Mon, Pat wrote:\n> hi')).toBe(false)
    expect(isForward('Forward planning', 'see below')).toBe(false)
  })

  it('finds the quoted mail the common mail programs put under a reply', () => {
    expect(htmlHasQuote('<div>Thanks</div><div class="gmail_quote"><div class="gmail_attr">On Mon wrote:</div><blockquote class="gmail_quote">hi</blockquote></div>')).toBe(true)
    expect(htmlHasQuote('<div>Thanks</div><blockquote type="cite">hi</blockquote>')).toBe(true)
    expect(htmlHasQuote('<div>Thanks</div><div id="appendonsend"></div><hr><div id="divRplyFwdMsg">From: Pat</div><div>hi</div>')).toBe(true)
    expect(htmlHasQuote('<div class="moz-cite-prefix">On 1/2 Pat wrote:</div><blockquote>hi</blockquote>')).toBe(true)
    expect(htmlHasQuote(replyQuoteHtml('On Mon, Pat <pat@vendor.com> wrote:', 'hi'))).toBe(true)   // a reply written in RPMail
    expect(htmlHasQuote('<div>As the spec says:</div><blockquote>pipe shall be double wall</blockquote>')).toBe(false)
    expect(htmlHasQuote('<p>no quote here</p>')).toBe(false)
  })

  it('splits a plain-text reply into what was written and what was quoted', () => {
    expect(splitPlainQuote('Confirmed, see you Monday.\n\nOn Mon, Nov 23, 2026 at 10:00 AM Pat Vendor <pat@vendor.com> wrote:\n> Can you confirm?'))
      .toEqual({ top: 'Confirmed, see you Monday.', rest: 'On Mon, Nov 23, 2026 at 10:00 AM Pat Vendor <pat@vendor.com> wrote:\n> Can you confirm?' })
    // Gmail breaks the "On ... wrote:" line in two when it is long
    expect(splitPlainQuote('Yes.\n\nOn Mon, Nov 23, 2026 at 10:00 AM Pat Vendor <\npat@vendor.com> wrote:\n\n> Can you?')?.top).toBe('Yes.')
    expect(splitPlainQuote('Got it\n> earlier line')?.top).toBe('Got it')
    expect(splitPlainQuote('Thanks\n\n-----Original Message-----\nFrom: Pat')?.top).toBe('Thanks')
    expect(splitPlainQuote('Thanks\n\nFrom: Pat Vendor <pat@vendor.com>\nSent: Monday\nTo: Ann')?.top).toBe('Thanks')
    expect(splitPlainQuote('Just a note with no quote.\nSecond line.')).toBeNull()
    expect(splitPlainQuote('> only quoted text\n> and more')).toBeNull()          // nothing written above it: show it all
    expect(splitPlainQuote('Call me On Monday if he wrote: nothing')).toBeNull()
  })

  it('sizes the frame from the words: short notes short, long mail capped, pictures full height', () => {
    expect(frameHeight('Thanks!', { max: 500 })).toEqual({ px: 110, capped: false })
    const ten = frameHeight(Array(10).fill('a line of text').join('\n'), { max: 500 })
    expect(ten).toEqual({ px: 10 * 22 + 88, capped: false })
    expect(frameHeight(Array(200).fill('a line of text').join('\n'), { max: 500 })).toEqual({ px: 500, capped: true })
    expect(frameHeight('x'.repeat(860), { max: 900 }).px).toBe(10 * 22 + 88)                 // one long paragraph wraps to ten lines
    expect(frameHeight('x'.repeat(860), { max: 900, narrow: true }).px).toBeGreaterThan(10 * 22 + 88)   // more lines on a phone
    expect(frameHeight('short', { max: 500, pictures: true })).toEqual({ px: 500, capped: true })
    expect(frameHeight('short', { max: 900, ownPictures: 2 }).px).toBe(22 + 88 + 300)                   // a logo or a pasted screenshot needs room
    const t = Date.now(); frameHeight('\n'.repeat(400_000), { max: 500 }); expect(Date.now() - t).toBeLessThan(500)
  })

  it('sizes an HTML message from the words that will show, not from a plain copy that may say less', () => {
    const reply = '<div dir="ltr">Thanks. Shipping Tuesday.</div><br><div class="gmail_quote"><div class="gmail_attr">On Mon Ann wrote:</div><blockquote class="gmail_quote">' + '<div>an earlier line</div>'.repeat(40) + '</blockquote></div>'
    expect(shownText(reply, true)).toBe('Thanks. Shipping Tuesday.')
    expect(shownText(reply, false).split('\n').length).toBeGreaterThan(40)
    const news = '<table><tr><td><h1>Specials</h1>' + '<p>More text here.</p>'.repeat(30) + '</td></tr></table>'
    expect(frameHeight(shownText(news, false), { max: 400 })).toEqual({ px: 400, capped: true })   // long: stops at the cap and offers Taller
    expect(ownPictures('<img src="data:image/png;base64,AAAA"><img src="https://x.example/a.png"><IMG alt="" SRC=\'data:image/gif;base64,BBBB\'>')).toBe(2)
  })

  it('shows a message in a frame that can run nothing and loads nothing unless pictures are asked for', () => {
    const locked = messageDoc('<p>hi</p>', { pictures: false, hideQuoted: false })
    expect(locked).toContain(`default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:`)
    expect(locked).not.toMatch(/script-src|https:|allow-scripts/)
    expect(locked).not.toContain(QUOTE_CSS)
    expect(messageDoc('<p>hi</p>', { pictures: true, hideQuoted: false })).toContain('img-src data: https: http:;')
    expect(messageDoc('<p>hi</p>', { pictures: false, hideQuoted: true })).toContain(QUOTE_CSS)
  })
})

describe('opening a conversation', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001'
  let ann: Person, me: Me, box: string
  let first: string, reply: string, latest: string
  const day = 86_400_000, T = 'feedfeedfeed0001'
  const gmailCalls = () => world.gmail.calls.filter(c => c.account === 'ann@gmail.com').map(c => `${c.method} ${c.path}`)

  beforeEach(async () => {
    ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
    box = addBox(A, 'ann@gmail.com', 'personal', [ann])
    const now = Date.now()
    first = world.gmail.add('ann@gmail.com', { threadId: T, from: 'Pat Vendor <pat@vendor.com>', subject: 'Parts for 34006', body: 'Can you confirm the order?', date: now - 3 * day, labelIds: ['INBOX'] }).id
    reply = world.gmail.add('ann@gmail.com', { threadId: T, from: 'Ann Owner <ann@gmail.com>', to: 'pat@vendor.com', subject: 'Re: Parts for 34006', body: 'Confirmed.', date: now - 2 * day, labelIds: ['SENT'] }).id
    latest = world.gmail.add('ann@gmail.com', { threadId: T, from: 'Pat Vendor <pat@vendor.com>', subject: 'Re: Parts for 34006', body: 'Shipping Tuesday.', date: now - day, labelIds: ['INBOX', 'UNREAD'] }).id
    world.gmail.add('ann@gmail.com', { from: 'Someone Else <x@other.com>', subject: 'Unrelated', body: 'Not in the conversation' })
    world.user = ann.id
    me = await requireMe()
    await syncMailbox(await mailboxFor(me, box))
  })

  it('brings back everyone else in the conversation, oldest first, with who and when but not their text', async () => {
    world.gmail.calls.length = 0
    const r = await readMessage(me, { mailbox: box, id: latest })
    expect(r.text).toContain('Shipping Tuesday.')
    expect(r.thread.map(t => t.id)).toEqual([first, reply])
    expect(r.thread[0]).toMatchObject({ from_name: 'Pat Vendor', from_addr: 'pat@vendor.com', snippet: 'Can you confirm the order?', unread: false, sent: false })
    expect(r.thread[1]).toMatchObject({ from_name: 'Ann Owner', sent: true, to_addrs: 'pat@vendor.com' })
    expect(JSON.stringify(r.thread)).not.toContain('Unrelated')
    // one read of the opened message, one look at the conversation: the other messages were not fetched
    expect(gmailCalls()).toEqual([`GET messages/${latest}`, `GET threads/${T}`])
  })

  it('reads the conversation live, so mail that RPMail has not listed yet is in it', async () => {
    const late = world.gmail.add('ann@gmail.com', { threadId: T, from: 'Bo Vendor <bo@vendor.com>', subject: 'Re: Parts for 34006', body: 'Adding the tracking number.', date: Date.now() - 1000 }).id
    expect(world.db.t('rpmail_messages').some(m => m.gmail_id === late)).toBe(false)
    const r = await readMessage(me, { mailbox: box, id: latest })
    expect(r.thread.map(t => t.id)).toEqual([first, reply, late])
    expect(r.thread.at(-1)).toMatchObject({ from_name: 'Bo Vendor', unread: true })
    expect(world.db.t('rpmail_messages').some(m => m.gmail_id === late)).toBe(false)   // looking at the stack stores nothing
  })

  it('leaves out drafts and anything in Trash or Spam', async () => {
    world.gmail.add('ann@gmail.com', { threadId: T, from: 'Ann Owner <ann@gmail.com>', subject: 'Re: Parts for 34006', body: 'half written', labelIds: ['DRAFT'] })
    world.gmail.add('ann@gmail.com', { threadId: T, from: 'Pat Vendor <pat@vendor.com>', subject: 'Re: Parts for 34006', body: 'thrown away', labelIds: ['TRASH'] })
    world.gmail.add('ann@gmail.com', { threadId: T, from: 'Spammer <s@spam.com>', subject: 'Re: Parts for 34006', body: 'junk', labelIds: ['SPAM'] })
    const r = await readMessage(me, { mailbox: box, id: latest })
    expect(r.thread.map(t => t.id)).toEqual([first, reply])
  })

  it('a message on its own has an empty conversation', async () => {
    const alone = world.gmail.add('ann@gmail.com', { from: 'Solo <solo@x.com>', subject: 'One-off', body: 'hello' }).id
    expect((await readMessage(me, { mailbox: box, id: alone })).thread).toEqual([])
  })

  it('still opens the message when Gmail will not list the conversation: asks once, then uses the list RPMail holds', async () => {
    world.gmail.threadFails = true
    const r = await readMessage(me, { mailbox: box, id: latest })
    expect(r.text).toContain('Shipping Tuesday.')
    expect(world.gmail.threadReads).toBe(1)
    expect(r.thread.map(t => t.id)).toEqual([first, reply])
    expect(r.thread[1]).toMatchObject({ sent: true, from_name: 'Ann Owner' })
  })

  it('opens an older message of the conversation the same way, with the rest around it', async () => {
    const r = await readMessage(me, { mailbox: box, id: first })
    expect(r.thread.map(t => t.id)).toEqual([reply, latest])
    expect(r.thread[1].unread).toBe(true)
  })
})
