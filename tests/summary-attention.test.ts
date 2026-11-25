import { describe, expect, it } from 'vitest'
import { baseSubject, renderAttention, MAX_PER_GROUP } from '@/lib/summary-attention'
import { summaryMarkdownToHtml } from '@/lib/summary-email'

const opts = { initialsOf: (e: string) => e.slice(0, 2).toUpperCase(), statusLabel: (s: string | null) => s ?? '' }
const r = (subject: string, day: string, sender = 'ak@x.com') => ({ subject, sender, received_at: `2026-11-${day}T15:00:00Z` })

describe('still needs attention', () => {
  it('says nothing when nothing is open', () => {
    expect(renderAttention([], [], opts)).toEqual([])
  })

  it('strips reply and forward marks', () => {
    expect(baseSubject('Re: Fwd:  211 Water  Heater ')).toBe('211 Water Heater')
  })

  it('groups by place, folds replies into one line, newest first', () => {
    const md = renderAttention([
      r('211 Water Heater', '11', 'st@x.com'),
      r('Re: 211 Water Heater', '12'),
      r('861 driveway hole', '06', 'wl@x.com'),
      r('Office gutters', '19'),
      r('Chain stuck in breaker', '10', 'mb@x.com'),
      r('Cracked Mixer', '23', 'pw@x.com'),
    ], [{ asset: 'X24', title: 'brake control', status: 'open' }], opts).join('\n')

    expect(md).toContain('### New tickets with nobody assigned (1)')
    expect(md).toContain('- **X24** brake control _(open)_')
    expect(md).toContain('no truck matched (5)')
    expect(md).toContain('**211** (1)\n- 11/12: 211 Water Heater — ST, AK _(2 emails)_')
    expect(md).toContain('**861** (1)\n- 11/6: 861 driveway hole — WL')
    expect(md).toContain('**225 Ritter Rd / office** (1)')
    expect(md.indexOf('Cracked Mixer')).toBeLessThan(md.indexOf('Chain stuck'))
    expect(md).not.toContain('Review queue (')
    expect(md).not.toContain('@')
  })

  it('caps a long group and says how many are left', () => {
    const many = Array.from({ length: MAX_PER_GROUP + 3 }, (_, i) => r(`861 job ${i}`, String(10 + i)))
    const md = renderAttention(many, [], opts).join('\n')
    expect(md).toContain('- and 3 older')
    expect(md.match(/^- \d/gm)?.length).toBe(MAX_PER_GROUP)
  })

  it('comes out of the email renderer as headings and separate lists', () => {
    const html = summaryMarkdownToHtml(renderAttention([r('861 a', '10'), r('Mixer', '11')], [], opts).join('\n'))
    expect(html).toContain('</h4>')
    expect(html.match(/<ul /g)?.length).toBe(2)
    expect(html).toContain('<strong>861</strong> (1)')
  })
})
