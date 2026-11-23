import { describe, expect, it } from 'vitest'
import { cardStyleOf, DEFAULT_CARD_STYLE, parsePrefs } from '@/lib/ui-prefs'

describe('dashboard square style in Personalize', () => {
  it('keeps a known style and drops anything else', () => {
    expect(parsePrefs({ cardStyle: 'navy-gold' }).cardStyle).toBe('navy-gold')
    expect(parsePrefs({ cardStyle: 'navy-header' }).cardStyle).toBe('navy-header')
    expect(parsePrefs({ cardStyle: 'hot-pink' }).cardStyle).toBeUndefined()
    expect(parsePrefs({ cardStyle: 42 }).cardStyle).toBeUndefined()
  })
  it('does not store the standard style, and falls back to it', () => {
    expect(parsePrefs({ cardStyle: DEFAULT_CARD_STYLE })).toEqual({})
    expect(cardStyleOf({})).toBe(DEFAULT_CARD_STYLE)
    expect(cardStyleOf(parsePrefs({ cardStyle: 'navy-gold' }))).toBe('navy-gold')
  })
})
