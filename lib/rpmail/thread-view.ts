import { htmlToText } from './parse'

// RPMail: how a conversation is laid out in the reader. Pure helpers, used by the page and checked by the tests.
//
// A conversation shows every message stacked, oldest first. The one that was picked is open; the others are folded to
// one line (who, when, the first words) until they are pressed, and only then is their text fetched from Gmail.
// Under a reply, the mail it was answering is folded away, since that mail is already in the stack above it.

export type StackItem = { id: string; date: number; from_name: string; from_addr: string; snippet: string; unread: boolean; sent: boolean }

/** The whole conversation, oldest first, with the opened message in its place among the others. */
export function buildStack(opened: StackItem, others: StackItem[]): StackItem[] {
  const seen = new Set([opened.id])
  const rest = others.filter(t => !seen.has(t.id) && !!seen.add(t.id))
  const pick = ({ id, date, from_name, from_addr, snippet, unread, sent }: StackItem): StackItem => ({ id, date, from_name, from_addr, snippet, unread, sent })
  return [...rest.map(pick), pick(opened)].sort((a, b) => a.date - b.date)
}

/** What starts open: the message that was picked, and the newest few others nobody has read yet. */
export const startOpen = (openedId: string, others: StackItem[], max = 3): string[] =>
  [openedId, ...others.filter(t => t.unread && t.id !== openedId).sort((a, b) => b.date - a.date).slice(0, max).map(t => t.id)]

/** A long conversation shows its newest messages (and anything open); the older ones wait behind "Show N earlier messages". */
export function shownOf(stack: StackItem[], open: Set<string>, all: boolean, keep = 8): { shown: StackItem[]; hidden: number } {
  if (all || stack.length <= keep) return { shown: stack, hidden: 0 }
  const shown = stack.filter((t, i) => i >= stack.length - keep || open.has(t.id))
  return { shown, hidden: stack.length - shown.length }
}

/** A forward carries the other message as its whole point, so nothing in it is folded away. */
export const isForward = (subject: string, text: string) =>
  /^\s*(fwd?|fw)\s*:/i.test(subject) || /-{3,}\s*Forwarded message\s*-{3,}|Begin forwarded message:/i.test(text.slice(0, 4000))

// The marks the common mail programs put on "the mail I am answering": Gmail, Apple Mail, Outlook on the web, Yahoo, Thunderbird.
const QUOTE_MARK = /class\s*=\s*["'][^"']*\bgmail_quote\b|<blockquote[^>]+type\s*=\s*["']?cite|id\s*=\s*["']?divRplyFwdMsg|class\s*=\s*["'][^"']*\byahoo_quoted\b|class\s*=\s*["'][^"']*\bmoz-cite-prefix\b/i
export const QUOTE_CSS = '.gmail_quote,.gmail_extra,blockquote[type=cite],.yahoo_quoted,.moz-cite-prefix,.moz-cite-prefix+blockquote,#divRplyFwdMsg,#divRplyFwdMsg~*,#appendonsend~*{display:none!important}'
export const htmlHasQuote = (html: string) => QUOTE_MARK.test(html)

/**
 * The words of an HTML message as they will show, for working out how tall its frame should be. With `withoutQuoted`
 * it stops where the quoted mail starts (that part is folded away, so it takes no room).
 */
export function shownText(html: string, withoutQuoted: boolean): string {
  const at = withoutQuoted ? html.search(QUOTE_MARK) : -1
  return htmlToText((at > 0 ? html.slice(0, html.lastIndexOf('<', at)) : html).slice(0, 400_000))
}
/** Pictures that are part of the message itself (a logo in a signature, a pasted screenshot). They always show, so they need room. */
export const ownPictures = (html: string) => (html.slice(0, 3_000_000).match(/<img[^>]+src\s*=\s*["']?data:/gi) ?? []).length

// Where the quoted mail starts in a plain-text message.
const PLAIN_QUOTE = /\n[ \t]*On [^\n]{0,200}(?:\n[^\n]{0,100})?wrote:[ \t]*\n|\n>|\n-{2,} ?Original Message ?-{2,}|\n_{10,}[ \t]*\n|\nFrom: [^\n]+\n(?:Sent|Date): /

/** A plain-text reply split into what the sender wrote and the mail quoted under it. Null when there is nothing to fold. */
export function splitPlainQuote(text: string): { top: string; rest: string } | null {
  const at = ('\n' + text).search(PLAIN_QUOTE)
  if (at < 0) return null
  const top = text.slice(0, at).replace(/\s+$/, '')
  return top ? { top, rest: text.slice(at).replace(/^\s+/, '') } : null
}

/**
 * How tall to make the frame a message is shown in. The frame is locked (nothing in it can run, so it cannot report its
 * own height); this is worked out from the words instead. Short notes get a short frame; long mail stops at `max`
 * and scrolls inside. With pictures showing, a designed mail (a newsletter) gets the full height.
 */
export function frameHeight(text: string, o: { narrow?: boolean; pictures?: boolean; max: number; ownPictures?: number }): { px: number; capped: boolean } {
  if (o.pictures) return { px: o.max, capped: true }
  const per = o.narrow ? 40 : 86
  let lines = 0
  for (const l of text.split('\n')) { lines += Math.max(1, Math.ceil(l.length / per)); if (lines > 400) break }
  const want = lines * 22 + 88 + Math.min(o.ownPictures ?? 0, 6) * 150     // room for the margins around lists and paragraphs: a little spare beats a scroll bar on a short note
  return { px: Math.max(110, Math.min(want, o.max)), capped: want > o.max }
}

/**
 * The page a message is shown as, inside its locked frame: no scripts, no forms, and nothing loads from the internet
 * unless the person asked for pictures. `html` has already been through the server's sanitizer.
 */
export function messageDoc(html: string, o: { pictures: boolean; hideQuoted: boolean }): string {
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${o.pictures ? ' https: http:' : ''}; font-src data:`
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{font:14px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1b2330;margin:12px;word-break:break-word}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #cfd6e0;color:#555}${o.hideQuoted ? QUOTE_CSS : ''}</style></head><body>${html}</body></html>`
}
