// RPMail: formatting in outgoing mail (bold, italic, underline, lists, links). Pure: used by the page and by the server.
//
// What the person typed arrives as HTML from the message box. NOTHING of it is passed through: `cleanRich` reads it tag by
// tag and writes a fresh copy that can only hold the few tags below, with no attributes except a checked link address.
// The plain-text copy is made in the same pass from the same pieces, so the two can never say different things. That
// matters for the pricing and blocked-content rules, which read the plain text: there is nowhere in the HTML to hide a word.

const INLINE: Record<string, string> = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', ins: 'u' }
const BLOCK = new Set(['div', 'p', 'pre', 'blockquote', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'address',
  'figure', 'figcaption', 'center', 'dl', 'dt', 'dd', 'tr', 'form', 'fieldset', 'details', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const CELL = new Set(['td', 'th'])
/** Dropped together with everything inside them. */
const SKIP = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'embed', 'noscript', 'svg', 'math', 'template', 'textarea', 'select', 'xml'])
/** Tags that never have a closing tag. Nothing of them is kept (a pasted picture goes along as an attachment instead). */
const VOID = new Set(['img', 'hr', 'input', 'meta', 'link', 'col', 'wbr', 'source', 'area', 'base', 'param', 'track'])
const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
  deg: '°', frac12: '½', frac14: '¼', frac34: '¾', times: '×', divide: '÷', laquo: '«', raquo: '»',
  cent: '¢', pound: '£', euro: '€', yen: '¥', sect: '§', para: '¶', dollar: '$', num: '#', percnt: '%',
  comma: ',', period: '.', colon: ':', semi: ';', excl: '!', quest: '?', lpar: '(', rpar: ')', sol: '/', commat: '@', plus: '+', equals: '=',
}
// Characters that take no room on the page. Left in, they could split a word so a rule reading the text would miss it.
const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g
const MAX_DEPTH = 60

export const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escAttr = (s: string) => escHtml(s).replace(/"/g, '&quot;')

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,30});?/gi, (all, body: string) => {
    if (body[0] === '#') {
      const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return ''
      // Control characters are never wanted; a tab or a line break counts as a space.
      if (n < 32 || n === 127) return n === 9 || n === 10 || n === 13 ? ' ' : ''
      try { return String.fromCodePoint(n) } catch { return '' }
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? all
  })
}

/** A link may only go to a web page or an email address. Anything else (javascript:, data:, file:) is not a link. */
export function safeHref(raw: string): string | null {
  const v = decodeEntities(raw).replace(INVISIBLE, '').replace(/[\x00-\x20\x7f]+/g, '')
  if (!v || v.length > 2000) return null
  return /^(https?:\/\/[^/]|mailto:[^@\s]+@)/i.test(v) ? v : null
}

/** What someone typed into the link box, made into a full address. Empty when it is not something that can be linked to. */
export function linkFromTyped(typed: string): string {
  const t = typed.trim()
  if (!t) return ''
  if (/^(https?:\/\/|mailto:)/i.test(t)) return safeHref(t) ?? ''
  if (/^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(t)) return safeHref('mailto:' + t) ?? ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return ''                       // some other kind of address (javascript:, file:, ...)
  return /^[^\s/]+\.[^\s/]+/.test(t) ? safeHref('https://' + t) ?? '' : ''
}

const attrOf = (attrs: string, name: string): string | null => {
  const re = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  for (let m = re.exec(attrs); m; m = re.exec(attrs)) if (m[1].toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? ''
  return null
}

type Open = { name: string; out: string[]; block: boolean; list?: boolean; item?: boolean; cell?: boolean; href?: string; said?: string }

/**
 * Read typed or pasted HTML and write it again from scratch.
 * `html` holds only b, i, u, ul, ol, li, a (web or email address only), div and br. `text` is the same message as plain text.
 */
export function cleanRich(input: string): { html: string; text: string } {
  const s = String(input ?? '')
  const n = s.length
  let html = '', text = ''
  const stack: Open[] = []
  const lists: { ordered: boolean; count: number }[] = []
  let bullet = ''                 // waiting to be written in front of the first words of a list item
  // The plain copy is only ever added to, never read back while it is being built (reading a long string that is still
  // growing is slow enough to matter on a huge paste). `tail` is its last character; open links keep their own words.
  let tail = ''
  const links: Open[] = []
  const put = (t: string) => { if (!t) return; text += t; tail = t[t.length - 1]; for (const a of links) a.said += t }
  const lineStart = () => tail === '' || tail === '\n'
  const newLine = () => { if (!lineStart()) put('\n') }

  const addText = (raw: string) => {
    const t = decodeEntities(raw).replace(INVISIBLE, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    if (!t) return
    html += escHtml(t)
    // On a page, any run of spaces and line breaks inside words shows as one space.
    let plain = t.replace(/[ \t\r\n\f]+/g, ' ')
    if (lineStart() && !bullet) plain = plain.replace(/^ /, '')
    plain = plain.replace(/ /g, ' ')
    if (!plain || (bullet && !plain.trim())) return
    if (bullet) { put(bullet); bullet = ''; plain = plain.replace(/^ +/, '') }
    put(plain)
  }

  const close = (o: Open) => {
    for (let k = o.out.length - 1; k >= 0; k--) html += `</${o.out[k]}>`
    if (o.href !== undefined) {
      // In the plain copy the address is written out after the words, unless the words already are the address.
      links.splice(links.lastIndexOf(o), 1)
      const said = (o.said ?? '').trim(), shown = o.href.replace(/^mailto:/i, '')
      const same = (a: string) => a.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase()
      if (said && same(said) !== same(shown)) put(` (${shown})`)
      else if (!said) { if (bullet) { put(bullet); bullet = '' } put(shown) }
    }
    if (o.list) { lists.pop(); newLine() }
    if (o.item) { bullet = ''; newLine() }
    if (o.cell) { html += ' '; if (!lineStart() && tail !== ' ') put(' ') }
    if (o.block) newLine()
  }

  const openTag = (name: string, attrs: string) => {
    if (name === 'br') { html += '<br>'; put('\n'); return }
    if (VOID.has(name) || stack.length >= MAX_DEPTH) return
    const o: Open = { name, out: [], block: false }
    const style = (attrOf(attrs, 'style') ?? '').toLowerCase()
    const weight = /font-weight\s*:\s*(bold|bolder|[6-9]00)/.test(style), plainWeight = /font-weight\s*:\s*(normal|[1-4]00)/.test(style)
    if (name === 'ul' || name === 'ol') {
      o.out.push(name); o.list = true; newLine(); lists.push({ ordered: name === 'ol', count: 0 })
    } else if (name === 'li') {
      o.out.push('li'); o.item = true; newLine()
      const l = lists[lists.length - 1]
      bullet = '  '.repeat(Math.max(0, lists.length - 1)) + (l?.ordered ? `${++l.count}. ` : '- ')
    } else if (name === 'a') {
      const href = safeHref(attrOf(attrs, 'href') ?? '')
      if (href && links.length < 4) { o.out.push('a'); o.href = href; o.said = ''; links.push(o) }   // a link inside a link inside a link is not a thing
    } else if (BLOCK.has(name)) {
      o.out.push('div'); o.block = true; newLine()
      if (/^h[1-6]$/.test(name)) o.out.push('b')
    } else if (CELL.has(name)) o.cell = true
    else if (INLINE[name] && !(INLINE[name] === 'b' && plainWeight)) o.out.push(INLINE[name])   // Google Docs wraps a paste in <b style="font-weight:normal">
    // Formatting that came as a style (a paste from Word or Docs) is kept as the plain tag.
    if (!o.list && !o.item) {
      if (weight && !o.out.includes('b')) o.out.push('b')
      if (/font-style\s*:\s*italic/.test(style) && !o.out.includes('i')) o.out.push('i')
      if (/text-decoration[^;]*underline/.test(style) && !o.out.includes('u') && name !== 'a') o.out.push('u')
    }
    for (const t of o.out) html += t === 'a' ? `<a href="${escAttr(o.href!)}">` : `<${t}>`
    stack.push(o)
  }

  const closeTag = (name: string) => {
    let at = -1
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) { at = k; break }
    if (at < 0) return
    while (stack.length > at) close(stack.pop()!)
  }

  const tagStart = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/y
  let i = 0
  while (i < n) {
    const lt = s.indexOf('<', i)
    if (lt < 0) { addText(s.slice(i)); break }
    if (lt > i) addText(s.slice(i, lt))
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue }
    if (s[lt + 1] === '!' || s[lt + 1] === '?') { const e = s.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue }
    tagStart.lastIndex = lt
    const m = tagStart.exec(s)
    if (!m) { addText('<'); i = lt + 1; continue }
    // The tag runs to the first > that is not inside quotes. One that never ends is dropped, as a browser would.
    let j = lt + m[0].length, quote = ''
    for (; j < n; j++) {
      const c = s[j]
      if (quote) { if (c === quote) quote = '' } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
    }
    if (j >= n) break
    const name = m[2].toLowerCase(), attrs = s.slice(lt + m[0].length, j).slice(0, 4000)
    i = j + 1
    if (SKIP.has(name)) {
      if (m[1] || ((name === 'svg' || name === 'math') && /\/\s*$/.test(attrs))) continue
      const end = new RegExp(`</${name}\\s*>`, 'gi')
      end.lastIndex = i
      const e = end.exec(s)
      i = e ? e.index + e[0].length : n
      continue
    }
    if (m[1]) closeTag(name)
    else openTag(name, attrs)
  }
  while (stack.length) close(stack.pop()!)
  return { html, text: text.replace(/[ \t]+\n/g, '\n') }
}

/** True when the message uses any formatting. A message with none goes out as plain text, exactly as it always did. */
export const hasFormatting = (html: string) => /<(b|i|u|ul|ol|li|a)[\s>]/.test(html)

/** Plain text (a signature, a template, an older draft) as lines for the message box. */
export const textToHtml = (t: string) => t ? t.replace(/\r\n?/g, '\n').split('\n').map(l => `<div>${escHtml(l).replace(/ {2}/g, ' &nbsp;') || '<br>'}</div>`).join('') : ''

/** Two pieces of text that read the same, whatever the spacing. Used to tell "only the signature is in the box". */
export const sameWords = (a: string, b: string) => {
  const tidy = (x: string) => x.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim()
  return tidy(a) === tidy(b)
}

const lines = (t: string) => t.replace(/\r\n?/g, '\n').split('\n').map(escHtml).join('<br>')

/**
 * The message being answered, for the HTML copy: the "On ... wrote:" line, then the original set off with a bar down the side.
 * It carries the same marks Gmail puts on quoted mail, so Gmail and RPMail both fold it away under the reply.
 */
export const replyQuoteHtml = (head: string, body: string) =>
  `<div class="gmail_quote"><div class="gmail_attr">${escHtml(head)}</div><blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${lines(body)}</blockquote></div>`

/** The message being forwarded, for the HTML copy. */
export const forwardQuoteHtml = (head: string, body: string) => `<div>${lines(head)}</div><div><br></div><div>${lines(body)}</div>`
