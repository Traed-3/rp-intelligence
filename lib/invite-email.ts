// ============================================================
// "You're invited to RP Intelligence" email (Settings > Users > Invite).
// PURE module (no server-only imports): the server action builds the real email with it and the invite
// dialog builds its live preview with it, so what the admin sees is exactly what goes out.
// ============================================================

export const INVITE_LOGIN_URL_DEFAULT = 'https://rpintelligence.app/login'

export const DEFAULT_INVITE_SUBJECT = 'RP Intelligence has new features: here is your login'

export const DEFAULT_INVITE_INTRO =
  'RP Intelligence, our company app, has been updated with a lot of new features. ' +
  'Your account is set up and ready. Sign in with the login below and take a look around.'

export const DEFAULT_WHATS_NEW = [
  'My Plate: your own to-do list, the first screen you see, with Clock In / Out right at the top',
  'Forms on your phone: pre-trip inspections, accident reports, site surveys, ICON boot surveys, and spill bucket and hydrostatic tests',
  'Submit a receipt by snapping a photo; the app fills in the rest',
  'Site Lookup: find any store by number and get the address and site details',
  'Technical Help: how-to guides and videos for the field',
  'Works on your phone like an app (see the tip below)',
].join('\n')

export type InviteContent = {
  subject: string
  intro: string
  /** One feature per line. Blank lines are dropped; a leading "-", "*" or "•" is stripped. */
  whatsNew: string
}

export type InviteRecipient = {
  fullName: string
  email: string
  /** The temporary password, or null when this invite does not change their password. */
  password: string | null
}

export type InviteSender = {
  name: string
  title?: string | null
}

export const INVITE_LIMITS = { subject: 150, intro: 2000, whatsNew: 3000 }

/** A message the admin can act on, or null when the text is fine to send. */
export function validateInviteContent(c: InviteContent): string | null {
  if (!c.subject.trim()) return 'Enter a subject.'
  if (c.subject.length > INVITE_LIMITS.subject) return `Keep the subject under ${INVITE_LIMITS.subject} characters.`
  if (/[\r\n]/.test(c.subject)) return 'The subject has to be one line.'
  if (c.intro.length > INVITE_LIMITS.intro) return `Keep the message under ${INVITE_LIMITS.intro} characters.`
  if (c.whatsNew.length > INVITE_LIMITS.whatsNew) return `Keep the "What's new" list under ${INVITE_LIMITS.whatsNew} characters.`
  return null
}

export function whatsNewLines(whatsNew: string): string[] {
  return whatsNew
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

export function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? ''
  return first || 'there'
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paragraphs(text: string): string[] {
  return text.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean)
}

/** Strips the scheme so the address reads cleanly in the login box ("rpintelligence.app/login"). */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function buildInviteEmail({ content, recipient, sender, loginUrl = INVITE_LOGIN_URL_DEFAULT, logoUrl }: {
  content: InviteContent
  recipient: InviteRecipient
  sender: InviteSender
  loginUrl?: string
  logoUrl?: string | null
}): { subject: string; html: string; text: string } {
  const subject = content.subject.trim()
  const hi = `Hi ${firstName(recipient.fullName)},`
  const intro = paragraphs(content.intro)
  const items = whatsNewLines(content.whatsNew)
  const signer = [sender.name.trim(), sender.title?.trim()].filter(Boolean).join(', ')
  const pw = recipient.password

  // ── Plain text ──
  const text = [
    hi,
    '',
    ...intro.flatMap(p => [p, '']),
    ...(items.length ? ["WHAT'S NEW", ...items.map(i => `  - ${i}`), ''] : []),
    'YOUR LOGIN',
    `  Website:  ${loginUrl}`,
    `  Email:    ${recipient.email}`,
    pw ? `  Temporary password:  ${pw}` : '  Password: use the one you already have. Forgot it? Ask the office to reset it.',
    ...(pw ? ['', 'The first time you sign in, you will be asked to choose your own password.'] : []),
    '',
    'ON YOUR PHONE: open the link in Safari (iPhone) or Chrome (Android), then tap Share > Add to Home Screen. It opens like an app after that.',
    '',
    signer ? `- ${signer}` : '',
    'Rappahannock Petroleum',
    'Questions? Just reply to this email.',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim()

  // ── HTML (inline styles only; email clients drop <style> blocks) ──
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="RP Intelligence" width="200" style="display:block;width:200px;max-width:60%;height:auto;margin:0 0 24px;border:0" />`
    : `<p style="margin:0 0 20px;font-size:13px;font-weight:700;color:#1e3a5f;letter-spacing:.08em;text-transform:uppercase">RP Intelligence</p>`

  const introHtml = intro.map(p =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151">${esc(p).replace(/\r?\n/g, '<br/>')}</p>`,
  ).join('')

  const listHtml = items.length
    ? `<p style="margin:22px 0 8px;font-size:12px;font-weight:700;color:#6b7280;letter-spacing:.08em;text-transform:uppercase">What&#39;s new</p>
       <ul style="margin:0 0 8px;padding:0 0 0 20px;font-size:15px;line-height:1.6;color:#374151">${items.map(i => `<li style="margin:0 0 6px">${esc(i)}</li>`).join('')}</ul>`
    : ''

  const row = (label: string, value: string, mono = false) =>
    `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#6b7280;white-space:nowrap;vertical-align:top">${label}</td>` +
    `<td style="padding:6px 0;font-size:15px;color:#111827;${mono ? "font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;font-weight:700;letter-spacing:.04em;" : 'font-weight:600;'}word-break:break-all">${value}</td></tr>`

  const loginBox = `
    <div style="margin:24px 0;padding:18px 20px;border:1px solid #c7d2fe;background:#eef2ff;border-radius:10px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#3730a3;letter-spacing:.08em;text-transform:uppercase">Your login</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        ${row('Website', `<a href="${esc(loginUrl)}" style="color:#1d4ed8;text-decoration:none">${esc(displayUrl(loginUrl))}</a>`)}
        ${row('Email', esc(recipient.email))}
        ${pw ? row('Temporary password', esc(pw), true) : row('Password', '<span style="font-weight:400">Use the one you already have. Forgot it? Ask the office to reset it.</span>')}
      </table>
      ${pw ? '<p style="margin:10px 0 0;font-size:13px;color:#4b5563">The first time you sign in, you will be asked to choose your own password.</p>' : ''}
    </div>`

  const button = `<a href="${esc(loginUrl)}" style="display:inline-block;padding:12px 22px;background:#1e3a5f;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600">Sign in to RP Intelligence &rarr;</a>`

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6">
  <div style="font-family:${font};max-width:560px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px;color:#111827">
      ${logo}
      <p style="margin:0 0 14px;font-size:16px;font-weight:600;color:#111827">${esc(hi)}</p>
      ${introHtml}
      ${listHtml}
      ${loginBox}
      ${button}
      <p style="margin:24px 0 0;padding:12px 14px;background:#f9fafb;border-radius:8px;font-size:13px;line-height:1.5;color:#4b5563"><b>On your phone:</b> open the link in Safari (iPhone) or Chrome (Android), then tap <b>Share &rsaquo; Add to Home Screen</b>. It opens like an app after that.</p>
      ${signer ? `<p style="margin:24px 0 0;font-size:15px;color:#374151">&mdash; ${esc(signer)}</p>` : ''}
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#9ca3af">Rappahannock Petroleum &middot; Questions? Just reply to this email.</p>
  </div>
</body></html>`

  return { subject, html, text }
}
