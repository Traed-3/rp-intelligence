import { escapeHtml, type SafeHtml } from '@/lib/email'

/**
 * Turns the daily shop summary (the small markdown written by app/api/daily-summary/route.ts) into email HTML.
 *
 * Handles only what that summary uses: `#`/`##`/`###` headings, `- ` list items, `**bold**`, `_italic_` and
 * plain lines. Every line is escaped FIRST, then our own tags are added, so text that came from emails or tickets
 * (subjects, notes, sender addresses) can never become HTML. The result goes to sendAlertEmail as `messageHtml`,
 * which does not escape it a second time.
 */
export function summaryMarkdownToHtml(md: string): SafeHtml {
  const out: string[] = []
  let list: string[] = []
  let para: string[] = []

  const flushList = () => {
    if (!list.length) return
    out.push(`<ul style="margin:4px 0 14px;padding-left:20px">${list.map(li => `<li style="margin:4px 0">${li}</li>`).join('')}</ul>`)
    list = []
  }
  const flushPara = () => {
    if (!para.length) return
    out.push(`<p style="margin:10px 0 2px;line-height:1.6">${para.join('<br>')}</p>`)
    para = []
  }

  for (const raw of (md ?? '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushList(); flushPara(); continue }

    const heading = /^(#{1,3}) +(.+)$/.exec(line)
    if (heading) {
      flushList(); flushPara()
      out.push(HEADINGS[heading[1].length](inline(heading[2])))
      continue
    }

    const item = /^[-*] +(.+)$/.exec(line)
    if (item) { flushPara(); list.push(inline(item[1])); continue }

    flushList()
    para.push(inline(line))
  }
  flushList(); flushPara()

  return out.join('\n') as SafeHtml
}

const HEADINGS: Record<number, (html: string) => string> = {
  1: h => `<h2 style="margin:24px 0 10px;font-size:18px">${h}</h2>`,
  2: h => `<h3 style="margin:22px 0 8px;font-size:16px;padding-bottom:4px;border-bottom:1px solid #e5e7eb">${h}</h3>`,
  3: h => `<h4 style="margin:18px 0 6px;font-size:14px">${h}</h4>`,
}

// Escape, then add bold and italics. Italics only when the underscores sit at word edges ("_(in progress)_"),
// so names like check_engine_light are left alone.
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\s)_(\S(?:[^_\n]*\S)?)_(?=$|\s|[.,;:!?])/g, '$1<em style="color:#6b7280">$2</em>')
}
