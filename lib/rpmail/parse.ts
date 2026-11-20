// RPMail: pure helpers for reading mail headers and sorting what a message is about. No server-only imports.

export const PRICE_RE = /\$\s?\d|\b(quote[ds]?|invoice[ds]?|pricing|price[ds]?|markup|estimate)\b/i
export const ADDR_RE = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/
export const CTRL_RE = /[\x00-\x1f\x7f]/
const WAIT_RE = /\?|please (advise|confirm|let|send|call)|let (me|us) know|can you|could you|waiting (on|for)|need(s|ed)? (you|this|an answer|a response)|asap|get back to/i
export const AUTO_RE = /no-?reply|do-?not-?reply|notifications?@|automation@|mailer|newsletter|exactix@|smartsheet/i
const QUOTE_RE = /\nOn .{0,90}wrote:|\n>|\nFrom: |-----Original|\n_{5,}/
const DEADLINE_RE = /\b(deadline|due (by|on|date)|no later than|expires? (on|in)|by end of (day|week)|by (monday|tuesday|wednesday|thursday|friday)|bid due|must be (received|submitted|completed) by)\b/i

export type Addr = { name: string; addr: string }

/** Split a header such as `"Smith, Jo" <jo@x.com>, bob@y.com` into names and addresses. */
export function parseAddrs(value: string | undefined | null): Addr[] {
  const out: Addr[] = []
  if (!value) return out
  let cur = '', inQ = false, depth = 0
  const parts: string[] = []
  for (const ch of value) {
    if (ch === '"') inQ = !inQ
    else if (ch === '<' && !inQ) depth++
    else if (ch === '>' && !inQ) depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && !inQ && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  for (const raw of parts) {
    const p = raw.trim()
    if (!p) continue
    const m = p.match(/^(.*)<([^<>]+)>\s*$/)
    const addr = (m ? m[2] : p).trim().toLowerCase()
    if (!ADDR_RE.test(addr)) continue
    const name = m ? decodeWords(m[1].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"')) : ''
    out.push({ name, addr })
  }
  return out
}

/** Decode =?utf-8?B?...?= style header words. Gmail usually hands headers over already decoded; this covers the rest. */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_all, cs: string, enc: string, text: string) => {
    try {
      const bytes = enc.toLowerCase() === 'b'
        ? Buffer.from(text, 'base64')
        : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1')
      return new TextDecoder(cs.toLowerCase() === 'utf8' ? 'utf-8' : cs).decode(bytes)
    } catch { return text }
  })
}

export function htmlToText(h: string): string {
  let t = h.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ')
  t = t.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ')
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_m, n: string) => { try { return String.fromCodePoint(+n) } catch { return ' ' } })
  return t.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim()
}

/** The part of a message its sender wrote, without the quoted mail underneath. */
export function topOf(text: string, max = 900): string {
  return ('\n' + (text || '').slice(0, max * 2)).split(QUOTE_RE)[0].replace(/<?https?:\/\/\S+/g, ' ').slice(0, max)
}

export const asksForSomething = (top: string) => WAIT_RE.test(top) && !/reacted via Gmail/i.test(top)

export function deadlineHint(subject: string, top: string): string | null {
  const text = `${subject} \n${top}`
  const m = DEADLINE_RE.exec(text)
  if (!m) return null
  return text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 70).replace(/\s+/g, ' ').trim().slice(0, 160)
}

/** Subject without Re: / Fwd: / [External], lower case: two mails with the same key are the same conversation. */
export function subjectKey(s: string | null | undefined): string {
  let t = (s || '').toLowerCase().replace(/\[external\]/g, ' ').trim()
  t = t.replace(/^(\s*(re|fwd?|fw)\s*:\s*)+/, '')
  return t.replace(/\s+/g, ' ').trim()
}

/** Site number a message is about: SU-1234, a known 5-digit store number, or "Sheetz 259". */
export function findSite(subject: string, top: string, known: Set<string>): string | null {
  for (const [text, strict] of [[subject, false], [top.slice(0, 1500), true]] as const) {
    let m = /\bSU[- ]?(\d{3,5}[A-C]?)\b/i.exec(text)
    if (m) return 'SU-' + m[1].toUpperCase()
    for (const n of text.match(/(?<![\d$.,/-])\d{5}(?![\d.,/-])/g) ?? []) if (known.has(n)) return n
    m = /\b(Sheetz|Wawa|Global|CPG)\s*#?\s*(\d{2,5})\b/i.exec(text)
    if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2]
    if (!strict) {
      m = /(?:store|site|7-?eleven|7-?11|sei)\s*#?\s*(\d{5})\b/i.exec(text)
      if (m) return m[1]
    }
  }
  return null
}

export function findPo(text: string): string | null {
  const m = /\bP\.?O\.?\s*(?:#|number|no\.?)?\s*:?\s*(\d{4,6})\b/i.exec(text)
  return m ? m[1] : null
}

/** Newsletters, receipts from machines and other mail nobody is waiting on an answer to. */
export function isBulk(headers: Record<string, string>, fromAddr: string): boolean {
  const h = (k: string) => headers[k] ?? ''
  return !!(h('list-unsubscribe') || h('list-id') || ['bulk', 'list', 'junk'].includes(h('precedence').toLowerCase())
    || (h('auto-submitted') || 'no').toLowerCase() !== 'no' || AUTO_RE.test(fromAddr))
}

export const splitAddrList = (s: string | null | undefined) => (s || '').split(/[,;]/).map(a => a.trim()).filter(Boolean)
