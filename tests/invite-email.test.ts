import { describe, expect, it } from 'vitest'
import {
  buildInviteEmail, validateInviteContent, whatsNewLines, firstName,
  DEFAULT_INVITE_SUBJECT, DEFAULT_INVITE_INTRO, DEFAULT_WHATS_NEW,
} from '@/lib/invite-email'

const content = { subject: DEFAULT_INVITE_SUBJECT, intro: DEFAULT_INVITE_INTRO, whatsNew: DEFAULT_WHATS_NEW }
const sender = { name: 'Trae Dodson', title: 'Construction' }

describe('invite email', () => {
  it('greets by first name and puts the login, email and temporary password in both versions', () => {
    const m = buildInviteEmail({ content, sender, recipient: { fullName: 'Jesse Franks', email: 'jesse@example.com', password: 'Abc23DefGhk' }, loginUrl: 'https://rpintelligence.app/login' })
    expect(m.subject).toBe(DEFAULT_INVITE_SUBJECT)
    for (const body of [m.html, m.text]) {
      expect(body).toContain('Hi Jesse,')
      expect(body).toContain('jesse@example.com')
      expect(body).toContain('Abc23DefGhk')
      expect(body).toContain('choose your own password')
      expect(body).toContain('Trae Dodson, Construction')
    }
    expect(m.html).toContain('href="https://rpintelligence.app/login"')
    expect(m.html).toContain('rpintelligence.app/login<')   // shown without https://
    expect(m.html.match(/<li /g)?.length).toBe(whatsNewLines(DEFAULT_WHATS_NEW).length)
  })

  it('says to use their current password when the invite does not change it', () => {
    const m = buildInviteEmail({ content, sender, recipient: { fullName: 'Dave Smith', email: 'd@example.com', password: null } })
    expect(m.text).toContain('use the one you already have')
    expect(m.html).not.toContain('Temporary password')
    expect(m.text).not.toContain('choose your own password')
  })

  it('escapes everything the admin types, and the name', () => {
    const m = buildInviteEmail({
      content: { subject: 'Hi', intro: '<script>alert(1)</script>', whatsNew: '- <b>bold</b> & more' },
      sender: { name: '<img src=x>' },
      recipient: { fullName: '"><svg onload=1>', email: 'a@b.co', password: 'p<w>"&\'' },
    })
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('<b>bold')
    expect(m.html).not.toContain('<img src=x>')
    expect(m.html).not.toContain('<svg')
    expect(m.html).toContain('&lt;script&gt;')
    expect(m.html).toContain('p&lt;w&gt;&quot;&amp;&#39;')
  })

  it('turns the What\'s new box into clean list items and skips the section when empty', () => {
    expect(whatsNewLines('- one\n\n* two\n• three\n1. four\n   ')).toEqual(['one', 'two', 'three', 'four'])
    const m = buildInviteEmail({ content: { ...content, whatsNew: '  \n ' }, sender, recipient: { fullName: 'A B', email: 'a@b.co', password: 'x' } })
    expect(m.html).not.toContain('What&#39;s new')
    expect(m.text).not.toContain("WHAT'S NEW")
  })

  it('checks the subject and lengths', () => {
    expect(validateInviteContent(content)).toBeNull()
    expect(validateInviteContent({ ...content, subject: '  ' })).toMatch(/subject/i)
    expect(validateInviteContent({ ...content, subject: 'a\nBcc: x@y.z' })).toMatch(/one line/i)
    expect(validateInviteContent({ ...content, intro: 'x'.repeat(5000) })).toMatch(/message/i)
  })

  it('falls back to "there" when there is no name', () => {
    expect(firstName('  ')).toBe('there')
    expect(firstName('Chevy Swartz')).toBe('Chevy')
  })
})
