import { describe, expect, it } from 'vitest'
import { parseAddrs, findSite, findPo, isBulk, subjectKey, asksForSomething } from '@/lib/rpmail/parse'
import { pricingGuard, cleanRecipients, buildRaw } from '@/lib/rpmail/mime'
import { sanitizeHtml, groupThreads } from '@/lib/rpmail/mail-ops'
import { mayGrant } from '@/lib/rpmail/access'

describe('reading headers', () => {
  it('splits names and addresses, commas inside quotes included', () => {
    expect(parseAddrs('"Smith, Jo" <Jo@X.com>, bob@y.com; nonsense')).toEqual([{ name: 'Smith, Jo', addr: 'jo@x.com' }, { name: '', addr: 'bob@y.com' }])
  })
  it('picks out site and PO numbers', () => {
    const known = new Set(['34006'])
    expect(findSite('SU-8001 sump survey', '', known)).toBe('SU-8001')
    expect(findSite('Update 34006', '', known)).toBe('34006')
    expect(findSite('Total 34006.50', '', known)).toBeNull()
    expect(findSite('Sheetz #259 canopy', '', known)).toBe('Sheetz 259')
    expect(findPo('Please use PO# 24275')).toBe('24275')
    expect(findPo('no number here')).toBeNull()
  })
  it('knows a newsletter from a person, and a question from a statement', () => {
    expect(isBulk({ 'list-unsubscribe': '<x>' }, 'a@b.com')).toBe(true)
    expect(isBulk({}, 'no-reply@b.com')).toBe(true)
    expect(isBulk({}, 'pat@vendor.com')).toBe(false)
    expect(asksForSomething('Can you send the permit?')).toBe(true)
    expect(asksForSomething('Thanks, got it.')).toBe(false)
    expect(subjectKey('RE: Fwd: [External] Parts  order')).toBe('parts order')
  })
})

describe('what may go out', () => {
  const none = new Set(['econstruction.rp@gmail.com'])
  it('pricing guard', () => {
    expect(() => pricingGuard('me@gmail.com', ['econstruction.rp@gmail.com'], 'the quote is ready', none)).toThrow(/Blocked/)
    expect(() => pricingGuard('econstruction.rp@gmail.com', ['x@y.com'], 'total $ 500', none)).toThrow(/Blocked/)
    expect(() => pricingGuard('me@gmail.com', ['customer@y.com'], 'the quote is $500', none)).not.toThrow()
    expect(() => pricingGuard('econstruction.rp@gmail.com', ['x@y.com'], 'crew on site at 7', none)).not.toThrow()
  })
  it('recipients are checked', () => {
    expect(cleanRecipients('a@b.com; c@d.com', '', true)).toEqual({ to: ['a@b.com', 'c@d.com'], cc: [] })
    expect(() => cleanRecipients('', '', true)).toThrow()
    expect(() => cleanRecipients('a@b', '', true)).toThrow()
  })
  it('builds a message nobody can add headers to', () => {
    const raw = Buffer.from(buildRaw({ fromName: 'A "B"', fromAddr: 'a@b.com', to: ['c@d.com'], cc: [], subject: 'Héllo', body: 'x', files: [{ name: 'a"\r\nBcc: z@z.com.pdf', type: 'bad type', data: Buffer.from('1') }] }), 'base64url').toString()
    expect(raw).not.toMatch(/^Bcc:/m)
    expect(raw).toContain('Content-Type: application/octet-stream')
    expect(raw).toContain('Subject: =?UTF-8?B?')
    expect(() => buildRaw({ fromName: '', fromAddr: 'a@b.com', to: ['c@d.com'], cc: [], subject: 'x\nBcc: z@z.com', body: 'x' })).toThrow()
  })
})

describe('showing mail safely', () => {
  it('removes scripts, frames, forms and inline handlers', () => {
    const out = sanitizeHtml('<p onclick="x()">hi</p><script>bad()</script><iframe src="x"></iframe><form action="/x"><a href="javascript:bad()">l</a></form><SCRIPT src=x></SCRIPT>')
    expect(out).not.toMatch(/<script|<iframe|<form|onclick|javascript:/i)
    expect(out).toContain('hi')
  })
  it('groups a conversation into one line, bold if anything in it is unread', () => {
    const row = (id: string, unread: boolean) => ({ mailbox_id: 'm', gmail_id: id, thread_id: 't', date: '2026-11-20T10:00:00Z', from_name: 'a', from_addr: 'a@b.com', to_addrs: '', subject: 's', snippet: '', unread, starred: false, has_att: false, in_inbox: true, sent: false, site: null, po: null })
    const g = groupThreads([row('2', false), row('1', true)])
    expect(g).toHaveLength(1); expect(g[0]).toMatchObject({ id: '2', count: 2, unread: true })
  })
})

describe('who may be given a shared mailbox', () => {
  it('techs and shop logins only get mailboxes the crew reads', () => {
    expect(mayGrant('construction_tech', { kind: 'shared', crew_reads: false })).toBe(false)
    expect(mayGrant('shop_employee', { kind: 'shared', crew_reads: true })).toBe(true)
    expect(mayGrant('manager', { kind: 'shared', crew_reads: false })).toBe(true)
    expect(mayGrant('owner', { kind: 'personal', crew_reads: false })).toBe(false)
  })
})

describe('push device addresses', () => {
  it('only the real push services are accepted', async () => {
    const { isPushEndpoint } = await import('@/lib/push')
    for (const ok of ['https://web.push.apple.com/abc', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-by3p.notify.windows.com/w/?token=x'])
      expect(isPushEndpoint(ok), ok).toBe(true)
    for (const bad of ['http://web.push.apple.com/abc', 'https://169.254.169.254/latest', 'https://localhost/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'https://a@push.apple.com/x', 'https://web.push.apple.com:8443/x', 'nope', null])
      expect(isPushEndpoint(bad), String(bad)).toBe(false)
  })
})
