import { randomBytes } from 'crypto'
import { ADDR_RE, CTRL_RE, PRICE_RE, splitAddrList } from './parse'
import { UserError } from './gmail'

// RPMail: builds the outgoing message (plain text, an HTML copy when it has formatting, optional attachments) and holds the pricing guard.

export type OutFile = { name: string; type: string; data: Buffer }
export type OutMail = {
  fromName: string; fromAddr: string; to: string[]; cc: string[]; subject: string; body: string
  inReplyTo?: string; references?: string; files?: OutFile[]
  /** The same message with its formatting. Already cleaned (lib/rpmail/rich.ts); `body` must say the same thing in plain text. */
  html?: string
  /** Pictures that sit inside the HTML copy. Each is shown where the HTML says `cid:<its cid>`. */
  pictures?: (OutFile & { cid: string })[]
}

const encWord = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : s.match(/[\s\S]{1,40}/gu)!.map(c => `=?UTF-8?B?${Buffer.from(c, 'utf8').toString('base64')}?=`).join('\r\n ')
const quoteName = (s: string) => /^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/["\\]/g, '')}"` : encWord(s)
const wrap76 = (b64: string) => b64.match(/.{1,76}/g)?.join('\r\n') ?? ''

/** Check and tidy what the person typed. Throws a plain-words error for anything that cannot go out. */
export function cleanRecipients(to: string, cc: string, needTo: boolean): { to: string[]; cc: string[] } {
  const T = splitAddrList(to), C = splitAddrList(cc)
  const bad = [...T, ...C].filter(a => !ADDR_RE.test(a) || CTRL_RE.test(a))
  if (bad.length) throw new UserError(`This does not look like an email address: ${bad[0].slice(0, 80)}`)
  if (needTo && !T.length) throw new UserError('Add who it is going to.')
  return { to: T, cc: C }
}

/**
 * Customer pricing never goes to or from a mailbox the crew reads (its Sent mail is open to them too).
 * `text` is everything that would go out: subject, body, quoted mail and attachment names.
 */
export function pricingGuard(fromAddr: string, recipients: string[], text: string, noPricing: Set<string>) {
  if (!PRICE_RE.test(text)) return
  if (noPricing.has(fromAddr.toLowerCase())) {
    throw new UserError(`Blocked: this mentions pricing and would go out from ${fromAddr}, where the crew can read the Sent mail. Send it from your own email or take the pricing out (check the quoted text below your reply and the attachment names too).`)
  }
  const hit = recipients.filter(a => noPricing.has(a.toLowerCase()))
  if (hit.length) {
    throw new UserError(`Blocked: this mentions pricing and is addressed to ${hit.join(', ')}. Remove that address or take the pricing out (check the quoted text below your reply and the attachment names too).`)
  }
}

export function buildRaw(m: OutMail): string {
  if (CTRL_RE.test(m.subject)) throw new UserError('A line break is not allowed in the subject.')
  const head: string[] = [
    `From: ${m.fromName ? quoteName(m.fromName) + ' ' : ''}<${m.fromAddr}>`,
    ...(m.to.length ? [`To: ${m.to.join(', ')}`] : []),
    ...(m.cc.length ? [`Cc: ${m.cc.join(', ')}`] : []),
    `Subject: ${encWord(m.subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@rpmail.rpintelligence.app>`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    'MIME-Version: 1.0',
  ]
  const part = (type: string, content: string) => [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '',
    wrap76(Buffer.from(content.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))]
  const textPart = part('text/plain', m.body || '\n')
  // With formatting, both copies go: mail programs show the HTML one and fall back to the plain one.
  let body = textPart
  if (m.html) {
    const a = 'rpmail_alt_' + randomBytes(12).toString('hex')
    let htmlPart = part('text/html', m.html)
    if (m.pictures?.length) {
      // The HTML and the pictures inside it travel as one unit, so a mail program puts each picture where the text says.
      const r = 'rpmail_rel_' + randomBytes(12).toString('hex')
      htmlPart = [`Content-Type: multipart/related; boundary="${r}"`, '', `--${r}`, ...htmlPart]
      for (const f of m.pictures) {
        const name = f.name.replace(/[\r\n"\\]/g, '_').slice(0, 180)
        const type = /^image\/(png|jpeg|gif|webp)$/.test(f.type) ? f.type : 'application/octet-stream'
        htmlPart.push(`--${r}`, `Content-Type: ${type}; name="${encWord(name)}"`, `Content-ID: <${f.cid.replace(/[^\w.@-]/g, '')}>`, `Content-Disposition: inline; filename="${encWord(name)}"`,
          'Content-Transfer-Encoding: base64', '', wrap76(f.data.toString('base64')))
      }
      htmlPart.push(`--${r}--`)
    }
    body = [`Content-Type: multipart/alternative; boundary="${a}"`, '', `--${a}`, ...textPart, `--${a}`, ...htmlPart, `--${a}--`]
  }
  let lines: string[]
  if (!m.files?.length) lines = [...head, ...body]
  else {
    const b = 'rpmail_' + randomBytes(12).toString('hex')
    lines = [...head, `Content-Type: multipart/mixed; boundary="${b}"`, '', `--${b}`, ...body]
    for (const f of m.files) {
      const name = f.name.replace(/[\r\n"\\]/g, '_').slice(0, 180)
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(f.type) ? f.type : 'application/octet-stream'
      lines.push(`--${b}`, `Content-Type: ${type}; name="${encWord(name)}"`, `Content-Disposition: attachment; filename="${encWord(name)}"`,
        'Content-Transfer-Encoding: base64', '', wrap76(f.data.toString('base64')))
    }
    lines.push(`--${b}--`)
  }
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8').toString('base64url')
}
