import { beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/rpmail/[op]/route'
import { world, addPerson, addBox, signInAs, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { sendMail } from '@/lib/rpmail/mail-ops'
import { buildRaw } from '@/lib/rpmail/mime'
import { cleanRich, hasFormatting, pictureFromSrc, pictureSrc, pictureTag } from '@/lib/rpmail/rich'

// Pictures inside the text of a message. A picture is a file the person uploaded for this message; it waits in their own
// private folder and travels inside the mail itself. No other picture address is ever kept, and nobody can see or send
// another person's waiting picture.

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-bytes-here')])
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-bytes-here')])
const P1 = '11111111-1111-4111-8111-111111111111', F1 = '22222222-2222-4222-8222-222222222222'
const path = (who: string, name = 'site photo.png', folder = F1) => `${who}/${folder}/${name}`

describe('the cleaner and pictures', () => {
  it('keeps a picture that points at a waiting file, and writes it one fixed way', () => {
    const p = path(P1)
    const { html, text, pictures } = cleanRich(`<div>See:</div><img src="${pictureSrc(p)}" onerror="x()" style="width:9000px" width="9000"><div>Thanks</div>`)
    expect(html).toBe(`<div>See:</div>${pictureTag(p)}<div>Thanks</div>`)
    expect(html).toContain('<img src="/api/rpmail/attach_view?path=11111111-1111-4111-8111-111111111111%2F22222222-2222-4222-8222-222222222222%2Fsite%20photo.png">')
    expect(text).toBe('See:\n[picture]\nThanks\n')
    expect(pictures).toEqual([p])
    expect(hasFormatting(cleanRich(pictureTag(p)).html)).toBe(true)        // a picture alone still needs the HTML copy
  })

  it('takes a picture copied from another message on this site (the browser writes the address out in full)', () => {
    const p = path(P1, 'a.jpg')
    expect(cleanRich(`<img src="https://rpintelligence.app${pictureSrc(p)}">`)).toMatchObject({ html: pictureTag(p), pictures: [p] })
  })

  it('drops every other picture: from the web, built into the page, or pointing anywhere else', () => {
    const p = path(P1)
    for (const src of [
      'https://track.example/pixel.gif', 'http://example.com/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'cid:abc@x', 'blob:https://rpintelligence.app/1',
      '/api/rpmail/attachment?mailbox=x&id=y&i=0', '/api/rpmail/attach_view?path=' + encodeURIComponent(p) + '&x=1', '/api/rpmail/attach_view?path=' + encodeURIComponent(p) + '#x',
      '/api/rpmail/attach_view?path=' + encodeURIComponent(`${P1}/../${P1}/${F1}/a.png`), '/api/rpmail/attach_view?path=' + encodeURIComponent(`${P1}/a.png`),
      '/api/rpmail/attach_view?path=' + encodeURIComponent(path(P1, 'a.svg')), '/api/rpmail/attach_view?path=' + encodeURIComponent(path(P1, 'a.html')),
      '/api/rpmail/attach_view?path=' + encodeURIComponent(path(P1, 'a.png.exe')), '/api/rpmail/attach_view?path=' + encodeURIComponent(path('not-an-id', 'a.png')),
      '/api/rpmail/attach_view?path=%E0%A4%A', '/api/other?path=' + encodeURIComponent(p), '//evil.example/api/rpmail/attach_view?path=' + encodeURIComponent(p),
    ]) {
      expect(pictureFromSrc(src), src).toBeNull()
      expect(cleanRich(`<div>a</div><img src="${src}"><div>b</div>`)).toMatchObject({ html: '<div>a</div><div>b</div>', pictures: [] })
    }
    expect(cleanRich('<img>').html).toBe('')
  })

  it('stops at twenty pictures', () => {
    const many = Array.from({ length: 25 }, (_, i) => pictureTag(path(P1, `p${i}.png`))).join('')
    expect(cleanRich(many).pictures.length).toBe(20)
  })
})

describe('the outgoing message with pictures', () => {
  const raw = (m: Parameters<typeof buildRaw>[0]) => Buffer.from(buildRaw(m), 'base64url').toString()
  const base = { fromName: 'Ann', fromAddr: 'a@b.com', to: ['c@d.com'], cc: [], subject: 'Hi', body: 'See [picture]' }

  it('carries the picture inside the HTML copy, where the text points at it', () => {
    const r = raw({ ...base, html: '<div>See <img src="cid:abc@rpmail"></div>', pictures: [{ name: 'photo "1".png', type: 'image/png', data: PNG, cid: 'abc@rpmail' }] })
    const alt = r.indexOf('multipart/alternative'), rel = r.indexOf('multipart/related'), html = r.indexOf('text/html'), pic = r.indexOf('Content-ID: <abc@rpmail>')
    expect(alt).toBeGreaterThan(-1)
    expect(rel).toBeGreaterThan(r.indexOf('text/plain'))      // the plain copy comes first, on its own
    expect(html).toBeGreaterThan(rel)
    expect(pic).toBeGreaterThan(html)
    expect(r).toContain('Content-Type: image/png; name="photo _1_.png"')
    expect(r).toContain('Content-Disposition: inline; filename="photo _1_.png"')
    expect(r).toContain(PNG.toString('base64'))
    expect(r).not.toContain('multipart/mixed')
    const rb = /multipart\/related; boundary="([^"]+)"/.exec(r)![1], ab = /multipart\/alternative; boundary="([^"]+)"/.exec(r)![1]
    expect(r.indexOf(`--${rb}--`)).toBeLessThan(r.indexOf(`--${ab}--`))
  })

  it('puts attached files after the message and its pictures', () => {
    const r = raw({ ...base, html: '<div><img src="cid:abc@rpmail"></div>', pictures: [{ name: 'p.jpg', type: 'image/jpeg', data: JPG, cid: 'abc@rpmail' }], files: [{ name: 'plan.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }] })
    expect(r.indexOf('multipart/mixed')).toBeLessThan(r.indexOf('multipart/alternative'))
    expect(r.indexOf('Content-Disposition: attachment; filename="plan.pdf"')).toBeGreaterThan(r.indexOf('Content-ID: <abc@rpmail>'))
  })

  it('never lets a picture name or id break out of its header', () => {
    const r = raw({ ...base, html: '<div><img src="cid:x"></div>', pictures: [{ name: 'a.png"\r\nBcc: z@z.com', type: 'text/html', data: PNG, cid: 'x>\r\nBcc: z@z.com' }] })
    expect(r).not.toMatch(/^Bcc:/m)
    expect(r).toContain('Content-Type: application/octet-stream;')
  })
})

describe('sending pictures', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001'
  let ann: Person, bob: Person, me: Me, box: string, crew: string
  const last = () => world.gmail.sent.at(-1)!
  const put = (p: string, data = PNG, type = 'image/png') => { world.db.files.set(p, { data, type }); return p }
  const htmlOf = (raw: string) => Buffer.from(/Content-Type: text\/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(raw)![1].replace(/\r\n/g, ''), 'base64').toString('utf8')
  const textOf = (raw: string) => Buffer.from(/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(raw)![1].replace(/\r\n/g, ''), 'base64').toString('utf8')

  beforeEach(async () => {
    ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com')
    bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
    box = addBox(A, 'ann@gmail.com', 'personal', [ann])
    crew = addBox(A, 'econstruction.rp@gmail.com', 'shared', [ann], { crew_reads: true })
    world.user = ann.id
    me = await requireMe()
    await syncMailbox(await mailboxFor(me, box))
  })

  it('sends the picture inside the mail, points the text at it, and clears the waiting file', async () => {
    const p = put(path(ann.id, 'sump.png'))
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Sump photo', confirmed: true, html: `<div>Here it is:</div>${pictureTag(p)}<div>Call me.</div>` })
    const raw = last().raw, html = htmlOf(raw)
    const cid = /<img src="cid:([0-9a-f]+@rpmail)" alt="sump\.png" style="max-width:100%;height:auto">/.exec(html)?.[1]
    expect(cid).toBeTruthy()
    expect(html).not.toContain('attach_view')
    expect(raw).toContain(`Content-ID: <${cid}>`)
    expect(raw).toContain(PNG.toString('base64'))
    expect(raw).toContain('Content-Type: image/png; name="sump.png"')
    expect(textOf(raw).replace(/\r\n/g, '\n')).toBe('Here it is:\n[picture]\nCall me.')
    expect(world.db.files.size).toBe(0)
  })

  it('sends a picture once even when it is in the text twice, and keeps attached files apart from it', async () => {
    const p = put(path(ann.id, 'sump.jpg'), JPG, 'image/jpeg'), f = put(`${ann.id}/33333333-3333-4333-8333-333333333333/plan.pdf`, Buffer.from('%PDF-plan'), 'application/pdf')
    await sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Twice', confirmed: true, html: pictureTag(p) + '<div>and again</div>' + pictureTag(p), files: [f] })
    const raw = last().raw
    expect(raw.match(/Content-ID: </g)?.length).toBe(1)
    expect(htmlOf(raw).match(/<img src="cid:/g)?.length).toBe(2)
    expect(raw).toContain('Content-Type: image/jpeg; name="sump.jpg"')        // the kind comes from the bytes
    expect(raw).toContain('Content-Disposition: attachment; filename="plan.pdf"')
    expect(world.db.files.size).toBe(0)
  })

  it('will not send a picture that is waiting in someone else\'s folder', async () => {
    const theirs = put(path(bob.id, 'private.png'))
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'x', confirmed: true, html: pictureTag(theirs) })).rejects.toThrow(/not yours/)
    expect(world.gmail.sent).toEqual([])
    expect(world.db.files.has(theirs)).toBe(true)
  })

  it('says so when a picture is gone, or is not really a picture', async () => {
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'x', confirmed: true, html: pictureTag(path(ann.id, 'gone.png')) })).rejects.toThrow(/no longer waiting/)
    const fake = put(path(ann.id, 'page.png'), Buffer.from('<html><script>alert(1)</script></html>'), 'image/png')
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'x', confirmed: true, html: pictureTag(fake) })).rejects.toThrow(/not a picture/)
    expect(world.gmail.sent).toEqual([])
  })

  it('counts pictures toward the 20 MB a mail can carry', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(11_000_000)])
    const a = put(path(ann.id, 'a.png'), big), b = put(path(ann.id, 'b.png', '44444444-4444-4444-8444-444444444444'), big)
    await expect(sendMail(me, { mailbox: box, mode: 'new', to: 'pat@vendor.com', subject: 'Big', confirmed: true, html: pictureTag(a) + pictureTag(b) })).rejects.toThrow(/20 MB/)
    expect(world.gmail.sent).toEqual([])
  })

  it('reads a picture\'s name for the pricing rule, like an attachment\'s', async () => {
    const p = put(path(ann.id, 'invoice 771.png'))
    await expect(sendMail(me, { mailbox: crew, mode: 'new', to: 'customer@example.com', subject: 'Photo', confirmed: true, html: '<div>See below</div>' + pictureTag(p) })).rejects.toThrow(/Blocked/)
    expect(world.gmail.sent).toEqual([])
  })

  it('keeps pictures in a draft saved to Gmail, and sends nothing', async () => {
    const p = put(path(ann.id, 'later.png'))
    const r = await sendMail(me, { mailbox: box, mode: 'new', to: '', subject: 'Later', draft: true, html: '<div>unfinished</div>' + pictureTag(p) })
    expect(r).toMatchObject({ draft: true })
    expect(last().draft).toBe(true)
    expect(last().raw).toContain('multipart/related')
    expect(world.db.files.size).toBe(0)
  })
})

describe('looking at a waiting picture', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001', B = 'bbbbbbbb-0000-4000-8000-000000000002'
  let ann: Person, bob: Person, zed: Person
  const view = async (p: string) => {
    const url = new URL('https://rpintelligence.app/api/rpmail/attach_view'); url.searchParams.set('path', p)
    const res = await GET(new NextRequest(url), { params: Promise.resolve({ op: 'attach_view' }) })
    return { status: res.status, type: res.headers.get('content-type') ?? '', nosniff: res.headers.get('x-content-type-options'), bytes: Buffer.from(await res.arrayBuffer()) }
  }

  beforeEach(() => {
    ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com'); bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com'); zed = addPerson(B, 'owner', 'Zed Other', 'zed@gmail.com')
    addBox(A, 'ann@gmail.com', 'personal', [ann]); addBox(A, 'bob@gmail.com', 'personal', [bob]); addBox(B, 'zed@gmail.com', 'personal', [zed])
    world.db.files.set(path(ann.id, 'mine.png'), { data: PNG, type: 'image/png' })
  })

  it('shows a person their own picture, as a picture and nothing else', async () => {
    signInAs(ann)
    const r = await view(path(ann.id, 'mine.png'))
    expect(r).toMatchObject({ status: 200, type: 'image/png', nosniff: 'nosniff' })
    expect(r.bytes.equals(PNG)).toBe(true)
  })

  it('refuses everyone else: a workmate, an owner of another company, and nobody signed in', async () => {
    for (const who of [bob, zed]) {
      signInAs(who)
      const r = await view(path(ann.id, 'mine.png'))
      expect(r.status).toBe(403)
      expect(r.bytes.includes(PNG)).toBe(false)
    }
    world.user = null
    expect((await view(path(ann.id, 'mine.png'))).status).toBe(403)
  })

  it('does not hand back a waiting file that is not a picture, whatever it is called', async () => {
    signInAs(ann)
    world.db.files.set(`${ann.id}/${F1}/plan.pdf`, { data: Buffer.from('%PDF-plan'), type: 'application/pdf' })
    world.db.files.set(path(ann.id, 'page.png'), { data: Buffer.from('<html><script>alert(1)</script>'), type: 'image/png' })
    for (const p of [`${ann.id}/${F1}/plan.pdf`, path(ann.id, 'page.png'), path(ann.id, 'missing.png'), `${ann.id}/../${bob.id}/${F1}/x.png`]) {
      const r = await view(p)
      expect(r.status, p).toBeGreaterThanOrEqual(400)
      expect(r.type).toContain('json')
    }
  })
})
