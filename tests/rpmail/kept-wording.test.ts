import { beforeEach, describe, expect, it } from 'vitest'
import { world, addPerson, addBox, type Person } from './fakes'
import { requireMe, mailboxFor, type Me } from '@/lib/rpmail/access'
import { syncMailbox } from '@/lib/rpmail/sync'
import { setSignature, getSignature, draftPrep } from '@/lib/rpmail/mail-ops'
import { templateSave, templateList } from '@/lib/rpmail/compose-ops'
import { overview } from '@/lib/rpmail/overview'
import { keptWording, withoutEnding, pictureTag, textToHtml } from '@/lib/rpmail/rich'

// Signatures and templates that keep their formatting. Both are wording a person keeps and uses again, so both are
// cleaned on the way in exactly like a message, and neither may hold a picture (a picture only waits until its message is sent).

const PIC = pictureTag('11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/logo.png')

describe('wording that is kept', () => {
  it('keeps bold, lists and links, and makes the plain wording from the cleaned copy', () => {
    const k = keptWording('<div><b>Ann Owner</b></div><div>Rappahannock Petroleum LLC</div><div><a href="https://rpintelligence.app">rpintelligence.app</a></div>', 'ignored', 4000)
    expect(k.html).toBe('<div><b>Ann Owner</b></div><div>Rappahannock Petroleum LLC</div><div><a href="https://rpintelligence.app">rpintelligence.app</a></div>')
    expect(k.text).toBe('Ann Owner\nRappahannock Petroleum LLC\nrpintelligence.app')
  })

  it('stores no HTML when nothing is formatted, and takes plain text as it always did', () => {
    expect(keptWording('<div>Ann Owner</div><div>540-869-5033</div>', '', 4000)).toEqual({ text: 'Ann Owner\n540-869-5033', html: null })
    expect(keptWording(undefined, '  Ann Owner\n540-869-5033  ', 4000)).toEqual({ text: 'Ann Owner\n540-869-5033', html: null })
    expect(keptWording('   ', 'typed', 4000)).toEqual({ text: 'typed', html: null })
  })

  it('cleans what it is given, takes pictures out, and trims empty lines off both ends', () => {
    const k = keptWording(`<div><br></div><div><b onclick="x()">Ann</b><script>alert(1)</script></div>${PIC}<div><a href="javascript:alert(1)">site</a></div><div><br></div>`, '', 4000)
    expect(k.html).toBe('<div><b>Ann</b></div><div>site</div>')
    expect(k.text).toBe('Ann\nsite')
  })

  it('drops the formatting rather than keep something far too long', () => {
    const k = keptWording('<b>' + 'word '.repeat(2000) + '</b>', '', 4000)
    expect(k.html).toBeNull()
    expect(k.text.length).toBeLessThanOrEqual(4000)
  })
})

describe('a message without its signature', () => {
  const sig = 'Ann Owner\nRappahannock Petroleum'
  const under = '<div><br></div><div><br></div>' + textToHtml(sig)

  it('cuts the signature off the end and keeps the formatting above it', () => {
    expect(withoutEnding('<div>The <b>permit</b> is in hand.</div><ul><li>Start Monday</li><li>Call first</li></ul>' + under, sig)).toBe('<div>The <b>permit</b> is in hand.</div><ul><li>Start Monday</li><li>Call first</li></ul>')
  })

  it('works with a formatted signature, matching on its wording', () => {
    const fancy = '<div><br></div><div><b>Ann Owner</b></div><div><i>Rappahannock Petroleum</i></div>'
    expect(withoutEnding('<div>See you <u>Monday</u>.</div>' + fancy, sig)).toBe('<div>See you <u>Monday</u>.</div>')
  })

  it('leaves the message alone when it does not end with the signature', () => {
    const edited = '<div>Hello</div><div>Ann O.</div>'
    expect(withoutEnding(edited, sig)).toBe(edited)
    expect(withoutEnding(edited, '')).toBe(edited)
    expect(withoutEnding('<div>Rappahannock Petroleum</div><div>is the company</div>', sig)).toBe('<div>Rappahannock Petroleum</div><div>is the company</div>')
  })

  it('gives nothing back when the message is only the signature', () => {
    expect(withoutEnding(under, sig)).toBe('')
  })
})

describe('saving and using them', () => {
  const A = 'aaaaaaaa-0000-4000-8000-000000000001'
  let ann: Person, bob: Person, me: Me, box: string, m1: string

  beforeEach(async () => {
    ann = addPerson(A, 'owner', 'Ann Owner', 'ann@gmail.com'); bob = addPerson(A, 'manager', 'Bob Manager', 'bob@gmail.com')
    box = addBox(A, 'ann@gmail.com', 'personal', [ann]); addBox(A, 'bob@gmail.com', 'personal', [bob])
    m1 = world.gmail.add('ann@gmail.com', { from: 'Pat Vendor <pat@vendor.com>', subject: 'Parts', body: 'Can you confirm?' }).id
    world.user = ann.id
    me = await requireMe()
    await syncMailbox(await mailboxFor(me, box))
  })

  it('a formatted signature is cleaned, stored with its plain wording, and comes back everywhere a message starts', async () => {
    const r = await setSignature(me, { mailbox: box, text: 'not what is in the box', html: `<div><b>Ann Owner</b><img src="https://track.example/p.gif"></div><div>540-869-5033</div>${PIC}` })
    expect(r).toMatchObject({ text: 'Ann Owner\n540-869-5033', html: '<div><b>Ann Owner</b></div><div>540-869-5033</div>' })
    expect(await getSignature(me, box)).toEqual({ text: 'Ann Owner\n540-869-5033', html: '<div><b>Ann Owner</b></div><div>540-869-5033</div>' })
    const mine = (await overview(me)).boxes.find(b => b.id === box)!
    expect(mine).toMatchObject({ signature: 'Ann Owner\n540-869-5033', signature_html: '<div><b>Ann Owner</b></div><div>540-869-5033</div>' })
    expect(await draftPrep(me, { mailbox: box, id: m1 })).toMatchObject({ signature: 'Ann Owner\n540-869-5033', signature_html: '<div><b>Ann Owner</b></div><div>540-869-5033</div>' })
  })

  it('a plain signature still works, and saving a plain one over a formatted one clears the formatting', async () => {
    await setSignature(me, { mailbox: box, html: '<div><i>Ann</i></div>' })
    await setSignature(me, { mailbox: box, text: 'Ann Owner' })                       // an older page sends text only
    expect(await getSignature(me, box)).toEqual({ text: 'Ann Owner', html: null })
    expect(await getSignature(me, 'no-such-box')).toEqual({ text: '', html: null })
  })

  it('a signature belongs to the person who wrote it', async () => {
    await setSignature(me, { mailbox: box, html: '<div><b>Ann Owner</b></div>' })
    world.user = bob.id
    const him = await requireMe()
    await expect(setSignature(him, { mailbox: box, html: '<div>Bob was here</div>' })).rejects.toThrow()
    expect(await getSignature(him, box)).toEqual({ text: '', html: null })
    expect(await getSignature(me, box)).toMatchObject({ text: 'Ann Owner' })
  })

  it('a template keeps its formatting, is cleaned, and never keeps a picture', async () => {
    await templateSave(me, { name: 'Permit received', body: 'ignored', html: `<div>The <b>permit</b> is in hand.</div><ul><li>Start Monday</li></ul>${PIC}<script>x()</script>` })
    await templateSave(me, { name: 'Plain one', body: 'Thanks, got it.' })
    const t = (await templateList(me)).templates as { name: string; body: string; html: string | null }[]
    expect(t.find(x => x.name === 'Permit received')).toMatchObject({ body: 'The permit is in hand.\n- Start Monday', html: '<div>The <b>permit</b> is in hand.</div><ul><li>Start Monday</li></ul>' })
    expect(t.find(x => x.name === 'Plain one')).toMatchObject({ body: 'Thanks, got it.', html: null })
    await expect(templateSave(me, { name: 'Empty', html: '<div><br></div>' })).rejects.toThrow(/empty/)
  })
})
