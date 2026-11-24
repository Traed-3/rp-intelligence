// ============================================================
// Site-number normalizer — the same rules used to clean con_sites /
// con_jobs. Given a raw site string (from a dispatched work order, a
// quote, etc.) it returns the bare site number plus the brand it implies.
//   5-digit            → 7-Eleven
//   3–4 digit + Sheetz/Wawa text → Sheetz / Wawa
//   SU-#### (+ trailing (800…) dropped) → Sunoco
//   Global 4-digit     → Global
//   CP#### / CPG####    → Capital Petroleum  ("<n>-CPG")
//   IP…                → Independent
// When it can't be classified confidently, the trimmed original is
// returned with brand null (never guessed).
// ============================================================

export type SiteBrand = '7-Eleven' | 'Sheetz' | 'Wawa' | 'Sheetz/Wawa' | 'Sunoco' | 'Global' | 'Capital Petroleum' | 'Independent'

export function classifySite(raw: string | null | undefined): { siteNumber: string; brand: SiteBrand | null } {
  const s = (raw ?? '').replace(/^\s*United States\s+/i, '').replace(/\s+/g, ' ').trim()
  if (!s) return { siteNumber: '', brand: null }
  const up = s.toUpperCase()

  if (up.includes('CPG') || up.includes('CAPITAL') || /^CP[\s-]?\d/.test(up)) {
    const m = up.match(/(\d{3,5})/)
    return m ? { siteNumber: `${m[1]}-CPG`, brand: 'Capital Petroleum' } : { siteNumber: s, brand: 'Capital Petroleum' }
  }
  if (/^SU[\s-]?\d/.test(up) || up.includes('SUNOCO')) {
    const m = up.match(/SU[\s-]?(\d+)/) ?? up.match(/(\d{3,5})/)
    return m ? { siteNumber: `SU-${m[1]}`, brand: 'Sunoco' } : { siteNumber: s, brand: 'Sunoco' }
  }
  if (up.includes('GLOBAL')) {
    const m = up.match(/(\d{3,5})/)
    return m ? { siteNumber: m[1], brand: 'Global' } : { siteNumber: s, brand: 'Global' }
  }
  if (/^IP[\s-]?\d/.test(up)) {
    const m = up.match(/^(IP[\w-]*)/)
    return { siteNumber: m ? m[1] : s, brand: 'Independent' }
  }
  const tb: SiteBrand | null = up.includes('SHEETZ') ? 'Sheetz' : up.includes('WAWA') ? 'Wawa'
    : (up.includes('7-ELEVEN') || up.includes('7 ELEVEN')) ? '7-Eleven' : null
  const nums = s.match(/\d+/g) ?? []
  if (nums.length === 1) {
    const n = nums[0]
    if (n.length === 5) {
      return (tb && tb !== '7-Eleven') ? { siteNumber: s, brand: tb } : { siteNumber: n, brand: '7-Eleven' }
    }
    if ((n.length === 3 || n.length === 4) && (tb === 'Sheetz' || tb === 'Wawa')) return { siteNumber: n, brand: tb }
    if (n.length === 3) return { siteNumber: n, brand: 'Sheetz/Wawa' }
  }
  return { siteNumber: s, brand: tb }
}
