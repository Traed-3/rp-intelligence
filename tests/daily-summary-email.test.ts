import { describe, expect, it } from 'vitest'
import { buildAlertEmailHtml } from '@/lib/email'
import { summaryMarkdownToHtml } from '@/lib/summary-email'

// Same shape app/api/daily-summary/route.ts renderSummary() writes (made-up wording).
const SAMPLE = [
  '## AR / RY',
  '',
  '**EE5** _(waiting on parts)_',
  '- flanges would not line up, ordered new converters',
  '',
  '**LL12** _(in progress)_',
  '- found a hole in the coolant pipe, part ordered',
  '- new pipe in, still need to torque the intake bolts',
  '',
  '## Still needs attention',
  '',
  '- Review queue (tech.rp@example.com): Water heater leaking',
  '- **N14** unassigned (open): Safety Recall',
].join('\n')

const email = (md: string) =>
  buildAlertEmailHtml({ title: 'Shop update: Mon → Tue', messageHtml: summaryMarkdownToHtml(md), link: '/maintenance' })

describe('daily shop summary email', () => {
  it('sends headings, bold and lists as real formatting, not as visible codes', () => {
    const html = email(SAMPLE)
    expect(html).toContain('>AR / RY</h3>')
    expect(html).toContain('<strong>EE5</strong>')
    expect(html).toContain('<em style="color:#6b7280">(waiting on parts)</em>')
    expect(html).toMatch(/<ul [^>]*><li [^>]*>flanges would not line up/)
    expect(html).toContain('<strong>N14</strong> unassigned (open): Safety Recall')
    // The bug: our own tags were escaped a second time and showed up as text.
    expect(html).not.toMatch(/&lt;\/?(h[2-4]|strong|em|ul|li|p)\b/)
    expect(html).not.toContain('&amp;lt;')
    expect(html).not.toMatch(/\*\*|^## /m)
  })

  it('keeps the two LL12 notes in one list and every list out of a <p>', () => {
    const html = summaryMarkdownToHtml(SAMPLE)
    expect(html).toMatch(/found a hole[^]*?<\/li><li [^>]*>new pipe in/)
    expect(html).not.toMatch(/<p[^>]*>(?:(?!<\/p>)[^])*<(ul|h[2-4])/)
  })

  it('keeps text from emails and tickets escaped', () => {
    const md = [
      '## <img src=x onerror=alert(1)>',
      '**<script>alert(1)</script>** _(open)_',
      '- Review queue (a"b\'c@example.com): <b>Fwd</b> & "quotes" <a href="https://evil.example">x</a>',
    ].join('\n')
    const html = summaryMarkdownToHtml(md)
    expect(html).not.toMatch(/<(img|script|b|a)[\s>]/i)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>')
    expect(html).toContain('a&quot;b&#39;c@example.com')
    expect(html).toContain('&lt;b&gt;Fwd&lt;/b&gt; &amp; &quot;quotes&quot;')
  })

  it('leaves snake_case words and plain lines alone', () => {
    const html = summaryMarkdownToHtml('check_engine_light came on\nsecond line')
    expect(html).toBe('<p style="margin:10px 0 2px;line-height:1.6">check_engine_light came on<br>second line</p>')
  })

  it('handles the quiet day', () => {
    expect(email('No changes since the last update.')).toContain('>No changes since the last update.</p>')
  })
})

describe('other alert emails', () => {
  it('still escape a plain-text message', () => {
    const html = buildAlertEmailHtml({ title: 'Asset <T1> down', message: 'Ticket "<b>brakes</b>" & more' })
    expect(html).toContain('Asset &lt;T1&gt; down')
    expect(html).toContain('Ticket &quot;&lt;b&gt;brakes&lt;/b&gt;&quot; &amp; more')
    expect(html).not.toContain('<b>')
  })
})
