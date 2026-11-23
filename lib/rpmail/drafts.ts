import { gmail, pooled, headerMap, b64url, UserError, type GMessage } from './gmail'
import { mailboxFor, type Me, type Mailbox } from './access'
import { walkParts, bodyText } from './sync'
import { decodeWords, parseAddrs } from './parse'
import { cleanRich, hasFormatting, textToHtml } from './rich'
import type { OutFile } from './mime'

// RPMail: drafts saved to Gmail Drafts (from RPMail or from Gmail itself), listed and opened again to finish.
// A draft is read live from Gmail each time; nothing of it is stored here.

type GDraft = { id: string; message?: GMessage }
const DRAFT_ID = /^[\w-]{4,80}$/
export const draftId = (v: unknown): string => {
  const s = String(v ?? '')
  if (!DRAFT_ID.test(s)) throw new UserError('No such draft.')
  return s
}

/** The drafts in a mailbox, newest first: who it is to, the subject and the first words. */
export async function draftList(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  const d = await gmail<{ drafts?: GDraft[] }>(box.id, 'drafts', { params: { maxResults: '50' } })
  const got = await pooled(d?.drafts ?? [], 6, x => gmail<GDraft>(box.id, 'drafts/' + x.id, { params: { format: 'metadata', metadataHeaders: ['To', 'Cc', 'Subject'] } }).catch(() => null))
  const drafts = got.filter((x): x is GDraft => !!x?.message).map(x => {
    const h = headerMap(x.message!.payload)
    return { id: x.id, thread_id: x.message!.threadId, date: Number(x.message!.internalDate ?? 0), to: parseAddrs(decodeWords(h['to'] ?? '')).map(a => a.addr).join(', '),
      subject: decodeWords(h['subject'] ?? ''), snippet: (x.message!.snippet ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 200) }
  }).sort((a, b) => b.date - a.date)
  return { drafts }
}

async function getDraft(box: Mailbox, id: string): Promise<GMessage> {
  const d = await gmail<GDraft>(box.id, 'drafts/' + id, { params: { format: 'full' } })
  if (!d?.message) throw new UserError('That draft is no longer in Gmail. It may have been sent or deleted somewhere else.')
  return d.message
}

/** What the compose box starts with when a draft is opened again. */
export async function draftOpen(who: Me, p: Record<string, string>) {
  const box = await mailboxFor(who, p.mailbox)
  const m = await getDraft(box, draftId(p.draft))
  const h = headerMap(m.payload)
  const { plain, html, files } = walkParts(m.payload)
  // Formatting written in Gmail is kept as far as RPMail's own allows (bold, italic, underline, lists, links); the rest is plain words.
  const rich = html ? cleanRich(html) : null
  const startHtml = rich && hasFormatting(rich.html) ? rich.html : textToHtml(bodyText(plain, html).replace(/\s+$/, ''))
  return {
    draft: draftId(p.draft), to: parseAddrs(decodeWords(h['to'] ?? '')).map(a => a.addr).join(', '), cc: parseAddrs(decodeWords(h['cc'] ?? '')).map(a => a.addr).join(', '),
    subject: decodeWords(h['subject'] ?? ''), html: startHtml, reply: !!h['in-reply-to'],
    attachments: files.map((f, i) => ({ i, name: f.name, size: f.size, inline: f.inline, has: !!f.attachmentId })).filter(f => !f.inline && f.has).map(({ i, name, size }) => ({ i, name, size })),
  }
}

/**
 * For sending (or saving again) a draft that was opened in RPMail: the reply headers and conversation it belongs to,
 * and the files it already carried that the person kept.
 */
export async function draftCarry(box: Mailbox, id: string, keep: unknown): Promise<{ inReplyTo?: string; references?: string; threadId?: string; files: OutFile[] }> {
  const m = await getDraft(box, id)
  const h = headerMap(m.payload)
  const want = new Set(Array.isArray(keep) ? keep.map(Number).filter(n => Number.isInteger(n) && n >= 0) : [])
  const parts = walkParts(m.payload).files
  const files: OutFile[] = []
  let total = 0
  for (const [i, f] of parts.entries()) {
    if (!want.has(i) || f.inline || !f.attachmentId) continue
    total += f.size
    if (total > 20_000_000) throw new UserError('The files on that draft add up to more than 20 MB. Take one off.')
    const a = await gmail<{ data?: string }>(box.id, `messages/${m.id}/attachments/${f.attachmentId}`)
    if (!a?.data) throw new UserError(`Could not load ${f.name} from the draft. Take it off and attach it again.`)
    files.push({ name: f.name, type: f.type, data: b64url(a.data) })
  }
  const inReplyTo = (h['in-reply-to'] ?? '').trim() || undefined
  return { inReplyTo, references: (h['references'] ?? '').trim() || undefined, threadId: inReplyTo ? m.threadId : undefined, files }
}
