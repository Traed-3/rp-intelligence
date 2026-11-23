import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { sendMail } from '@/lib/rpmail/mail-ops'
import { buildRaw } from '@/lib/rpmail/mime'
import { cleanRich, hasFormatting, linkFromTyped, safeHref, sameWords, textToHtml } from '@/lib/rpmail/rich'

// Writing with formatting. The message box sends HTML; the server rebuilds it from scratch and makes the plain copy from
// that same rebuilt HTML, so nothing can ride along unseen and the pricing rule reads exactly what goes out.

const parts = (raw: string) => [...raw.matchAll(/Content-Type: (text\/(?:plain|html)); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)]
  .map(m => ({ type: m[1], text: Buffer.from(m[2].replace(/\r\n/g, ''), 'base64').toString('utf8') }))

describe('the cleaner', () => {
  it('keeps bold, italic, underline, lists and links, and nothing else', () => {
    const { html, text } = cleanRich('<div>Hi <b>Pat</b>, <i>please</i> <u>read</u>:</div><ul><li>one</li><li>two</li></ul><div>See <a href="https://example.com/plan">the plan</a>.</div>')
    expect(html).toBe('<div>Hi <b>Pat</b>, <i>please</i> <u>read</u>:</div><ul><li>one</li><li>two</li></ul><div>See <a href="https://example.com/plan">the plan</a>.</div>')
    expect(text).toBe('Hi Pat, please read:\n- one\n- two\nSee the plan (https://example.com/plan).\n')
  })

  it('numbers a numbered list and indents a list inside a list', () => {
    expect(cleanRich('<ol><li>first</li><li>second<ul><li>inner</li></ul></li><li>third</li></ol>').text).toBe('1. first\n2. second\n  - inner\n3. third\n')
  })

  it('drops anything that could run, load or hide', () => {
    const dirty = [
      '<script>alert(1)</script>', '<img src=x onerror="steal()">', '<a href="javascript:alert(1)">click</a>', '<a href="JaVa&#115;cript:alert(1)">x</a>',
      '<a href=" data:text/html,<script>1</script>">d</a>', '<iframe src="https://evil.example"></iframe>', '<style>*{display:none}</style>',
      '<div style="display:none" onclick="x()">hidden</div>', '<svg onload="x()"><circle/></svg>', '<form action="https://evil.example"><input name=q></form>',
      '<b onmouseover="x()">bold</b>', '<meta http-equiv="refresh" content="0;url=https://evil.example">', '<object data="x"></object>', '<!-- <script>x</script> -->',
      '<a href="https://ok.example" onclick="x()" target="_blank" style="color:white">ok</a>', '<link rel=stylesheet href="https://evil.example/x.css">',
    ].join('')
    const { html } = cleanRich(dirty)
    expect(html).not.toMatch(/<(?!\/?(b|i|u|ul|ol|li|div|br|a)\b)/)                 // only the allowed tags
    expect(html).not.toMatch(/\son\w+=|style=|javascript:|data:|src=|target=|evil\.example/i)
    expect(html.match(/<a [^>]*>/g)).toEqual(['<a href="https://ok.example">'])  // the one real link, with nothing but its address
    expect(html).toContain('<b>bold</b>')
    expect(html).toContain('hidden')                                             // the words stay, the hiding does not
  })

  it('never lets typed angle brackets or a half-finished tag become markup', () => {
    expect(cleanRich('2 < 3 and 5 > 4 &lt;script&gt;alert(1)&lt;/script&gt;').html).toBe('2 &lt; 3 and 5 &gt; 4 &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(cleanRich('hello <a href="https://x.example').html).toBe('hello ')
    expect(cleanRich('<b>open and never closed').html).toBe('<b>open and never closed</b>')
    expect(cleanRich('<b><div>crossed</b></div> after').html).toBe('<b><div>crossed</div></b> after')
    expect(cleanRich('a < b <c').html).toBe('a &lt; b ')
  })

  it('reads the plain copy the way the page shows it: line by line, blank lines kept', () => {
    expect(cleanRich('<div>one</div><div><br></div><div>two<br></div><div>three</div>').text).toBe('one\n\ntwo\nthree\n')
    expect(cleanRich('one<br>two').text).toBe('one\ntwo')
    expect(cleanRich('<p>one</p>\n<p>two</p>').text).toBe('one\ntwo\n')
    expect(cleanRich('<h2>Title</h2><div>words</div>').html).toBe('<div><b>Title</b></div><div>words</div>')
    expect(cleanRich('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>').text).toBe('a b\nc\n')
    expect(cleanRich('a &amp; b&nbsp;&nbsp;c &#36;5 &copy;').text).toBe('a & b  c $5 ©')
  })

  it('keeps bold and italic that came as a style (a paste from Word or Google Docs)', () => {
    expect(cleanRich('<b style="font-weight:normal"><span style="font-weight:700">bold</span> <span style="font-style:italic">slanted</span> plain</b>').html)
      .toBe('<b>bold</b> <i>slanted</i> plain')
  })

  it('has no place to hide a word from the rules: what shows is what the plain copy says', () => {
    // split by empty tags, by invisible characters and by character codes: the plain copy still reads as the page does
    expect(cleanRich('pri<b></b>ce is &#36;<i></i>5,000').text).toBe('price is $5,000')
    expect(cleanRich('pri​ce q­uote &#8203;$&#x200d;5').text).toBe('price quote $5')
    expect(cleanRich('pri​ce').html).toBe('price')
    // a link's address is part of the plain copy too
    expect(cleanRich('<a href="https://x.example/price-list">here</a>').text).toBe('here (https://x.example/price-list)')
    expect(cleanRich('<a href="https://x.example/a">https://x.example/a</a> <a href="mailto:jo@x.example">jo@x.example</a>').text).toBe('https://x.example/a jo@x.example')
  })

  it('only links to web pages and email addresses', () => {
    expect(safeHref('https://example.com/a?b=1&amp;c=2')).toBe('https://example.com/a?b=1&c=2')
    expect(safeHref('mailto:jo@example.com')).toBe('mailto:jo@example.com')
    for (const bad of ['javascript:alert(1)', ' java\tscript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', '//evil.example', 'https://', 'ftp://x.example', ''])
      expect(safeHref(bad)).toBeNull()
    expect(linkFromTyped('example.com/page')).toBe('https://example.com/page')
    expect(linkFromTyped('jo@example.com')).toBe('mailto:jo@example.com')
    expect(linkFromTyped('http://example.com')).toBe('http://example.com')
    expect(linkFromTyped('javascript:alert(1)')).toBe('')
    expect(linkFromTyped('just words')).toBe('')
  })

  it('stays quick on input built to slow it down', () => {
    const t = Date.now()
    cleanRich('<a "'.repeat(100_000)); cleanRich('<'.repeat(300_000)); cleanRich('<div>'.repeat(50_000)); cleanRich('&#'.repeat(150_000)); cleanRich('<b a="'.repeat(60_000))
    expect(Date.now() - t).toBeLessThan(2500)
  })

  it('turns plain text (a signature, a template) into lines and back', () => {
    const sig = 'Ann Owner\nRappahannock Petroleum  LLC\n<540> 869-5033 & more'
    expect(cleanRich(textToHtml('\n\n' + sig)).text).toBe('\n\n' + sig + '\n')
    expect(sameWords(cleanRich(textToHtml('\n\n' + sig)).text, sig)).toBe(true)
    expect(hasFormatting(textToHtml(sig))).toBe(false)
    expect(hasFormatting('<div>a <b>b</b></div>')).toBe(true)
    expect(hasFormatting('<div>a<br>b</div>')).toBe(false)
  })
})

describe('the outgoing message', () => {
  const base = { fromName: 'Ann', fromAddr: 'a@b.com', to: ['c@d.com'], cc: [], subject: 'Hi' }
  const raw = (m: Parameters<typeof buildRaw>[0]) => Buffer.from(buildRaw(m), 'base64url').toString()

  it('stays one plain part when there is no formatting', () => {
    const r = raw({ ...base, body: 'plain' })
    expect(r).not.toContain('multipart')
    expect(parts(r)).toEqual([{ type: 'text/plain', text: 'plain' }])
  })

  it('carries a plain copy and an HTML copy when there is formatting', () => {
    const r = raw({ ...base, body: 'Hello Pat', html: '<div>Hello <b>Pat</b></div>' })
    expect(r).toMatch(/Content-Type: multipart\/alternative; boundary="rpmail_alt_[0-9a-f]+"/)
    expect(parts(r)).toEqual([{ type: 'text/plain', text: 'Hello Pat' }, { type: 'text/html', text: '<div>Hello <b>Pat</b></div>' }])
  })

  it('puts both copies first and the attachments after them', () => {
    const r = raw({ ...base, body: 'See attached', html: '<div><i>See attached</i></div>', files: [{ name: 'a.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }] })
    const mixed = r.indexOf('multipart/mixed'), alt = r.indexOf('multipart/alternative'), file = r.indexOf('Content-Disposition: attachment')
    expect(mixed).toBeGreaterThan(-1)
    expect(alt).toBeGreaterThan(mixed)
    expect(file).toBeGreaterThan(r.indexOf('text/html'))
    const outer = /multipart\/mixed; boundary="([^"]+)"/.exec(r)![1], inner = /multipart\/alternative; boundary="([^"]+)"/.exec(r)![1]
    expect(r.trimEnd().endsWith(`--${outer}--`)).toBe(true)
    expect(r.indexOf(`--${inner}--`)).toBeLessThan(file)
  })
})

describe('sending with formatting', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001'
  let ann: Person, me: Me, box: string, crew: string, m1: string
  const last = () => world.gmail.sent.at(-1)!

  beforeEach(async () => {
    ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
    box = addBox(A, 'ann@gmail.com', 'personal', [ann])
    crew = addBox(A, 'econstruction.rp@gmail.com', 'shared', [ann], { crew_reads: true })
    m1 = world.gmail.add('ann@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'Parts for 34006', body: 'Can you confirm the order?\n<b>not bold</b> & done' }).id
    world.user = ann.id
    me = await requireMe()
    await syncMailbox(await mailboxFor(me, box))
  })

  it('sends both copies, and the plain one is made from the HTML, never taken from the page', async () => {
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Monday', confirmed: true,
      body: 'this is not what the box holds', html: '<div>See you <b>Monday</b>:</div><ul><li>7 AM</li><li>bring the <a href="https://example.com/plan">plan</a></li></ul>' })
    const p = parts(last().raw)
    expect(p.map(x => x.type)).toEqual(['text/plain', 'text/html'])
    expect(p[0].text.replace(/\r\n/g, '\n')).toBe('See you Monday:\n- 7 AM\n- bring the plan (https://example.com/plan)')
    expect(p[1].text).toBe('<div dir="ltr"><div>See you <b>Monday</b>:</div><ul><li>7 AM</li><li>bring the <a href="https://example.com/plan">plan</a></li></ul></div>')
  })

  it('sends plain text only, as before, when nothing is formatted', async () => {
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Plain', confirmed: true, body: 'ignored', html: '<div>Line one</div><div><br></div><div>Line two</div>' })
    expect(last().raw).not.toContain('multipart')
    expect(parts(last().raw)).toEqual([{ type: 'text/plain', text: 'Line one\r\n\r\nLine two' }])
    // an older page that sends no HTML at all still works
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Old page', confirmed: true, body: 'Typed in the old box' })
    expect(parts(last().raw)).toEqual([{ type: 'text/plain', text: 'Typed in the old box' }])
  })

  it('cleans what the page sends before it goes out', async () => {
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Hi', confirmed: true,
      html: '<div><b>Hello</b><script>alert(1)</script><img src="https://track.example/p.gif"><a href="javascript:alert(1)">x</a></div><div style="display:none">unseen</div>' })
    const html = parts(last().raw)[1].text
    expect(html).toBe('<div dir="ltr"><div><b>Hello</b>x</div><div>unseen</div></div>')
    expect(parts(last().raw)[0].text.replace(/\r\n/g, '\n')).toBe('Hellox\nunseen')
  })

  it('quotes the original under a formatted reply in both copies, as words only', async () => {
    await sendMail(me, { mailbox: box, mode: 'reply', id: m1, to: 'pat@vendor.com', confirmed: true, html: '<div><b>Confirmed.</b></div>' })
    const [plain, html] = parts(last().raw)
    expect(plain.text).toMatch(/^Confirmed\.\r\n\r\nOn .* wrote:\r\n> Can you confirm the order\?/)
    expect(html.text).toMatch(/^<div dir="ltr"><div><b>Confirmed\.<\/b><\/div><div><br><\/div><div>On [^<]*Pat Vendor &lt;pat@vendor\.com&gt; wrote:<\/div><blockquote style="[^"]*">Can you confirm the order\?<br>&lt;b&gt;not bold&lt;\/b&gt; &amp; done<\/blockquote><\/div>$/)
    expect(last().threadId).toBeTruthy()
    // "do not include the original" leaves it out of both
    await sendMail(me, { mailbox: box, mode: 'reply', id: m1, to: 'pat@vendor.com', confirmed: true, quote: false, html: '<div><i>Thanks</i></div>' })
    expect(parts(last().raw).map(x => x.text)).toEqual(['Thanks', '<div dir="ltr"><div><i>Thanks</i></div></div>'])
  })

  it('carries the forwarded message in both copies', async () => {
    await sendMail(me, { mailbox: box, mode: 'forward', id: m1, to: 'bo@vendor.com', confirmed: true, html: '<div><u>FYI</u></div>' })
    const [plain, html] = parts(last().raw)
    expect(plain.text).toContain('---------- Forwarded message ----------')
    expect(html.text).toContain('---------- Forwarded message ----------<br>From: Pat Vendor &lt;pat@vendor.com&gt;')
    expect(html.text).toContain('Can you confirm the order?<br>&lt;b&gt;not bold&lt;/b&gt; &amp; done')
  })

  it('saves a formatted draft without sending', async () => {
    const before = world.gmail.sent.length
    const r = await sendMail(me, { mailbox: box, mode: 'new', to: '', subject: 'Later', draft: true, html: '<div>unfinished <b>idea</b></div>' })
    expect(r).toMatchObject({ draft: true })
    expect(world.gmail.sent.length).toBe(before + 1)
    expect(last().draft).toBe(true)
    expect(parts(last().raw).map(x => x.type)).toEqual(['text/plain', 'text/html'])
  })

  it('still blocks pricing when it is only in the formatted copy, in a link address, or split up to hide it', async () => {
    const send = (html: string) => sendMail(me, { mailbox: crew, mode: 'new', to: 'customer@example.com', subject: 'Schedule', confirmed: true, body: 'See you at 7.', html })
    const n = world.gmail.sent.length
    await expect(send('<div>The job is <b>$4,200</b></div>')).rejects.toThrow(/Blocked/)
    await expect(send('<div>The pri<b></b>ce went up</div>')).rejects.toThrow(/Blocked/)
    await expect(send('<div>Total &#36;<i></i>4,200</div>')).rejects.toThrow(/Blocked/)
    await expect(send('<div>Our quo​te is ready</div>')).rejects.toThrow(/Blocked/)
    await expect(send('<div>See <a href="https://files.example/invoice-771.pdf">this file</a></div>')).rejects.toThrow(/Blocked/)
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'econstruction.rp@gmail.com', subject: 'FYI', confirmed: true, html: '<ul><li>estimate attached</li></ul>' })).rejects.toThrow(/Blocked/)
    expect(world.gmail.sent.length).toBe(n)
    // and the same mailbox still sends ordinary formatted mail
    await send('<div>Crew arrives <b>Monday</b> at 7.</div>')
    expect(world.gmail.sent.length).toBe(n + 1)
  })

  it('refuses an empty formatted reply and a message that is far too long', async () => {
    await expect(sendMail(me, { mailbox: box, mode: 'reply', id: m1, to: 'pat@vendor.com', confirmed: true, html: '<div><b></b><br></div><ul><li></li></ul>' })).rejects.toThrow(/empty/)
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Long', confirmed: true, html: '<b>x</b>'.repeat(90_000) })).rejects.toThrow(/too long/)
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Long', confirmed: true, html: '<div>' + 'word '.repeat(50_000) + '</div>' })).rejects.toThrow(/too long/)
  })
})
