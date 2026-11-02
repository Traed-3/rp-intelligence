import { Resend } from 'resend'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rps-maintenance.vercel.app'

// Alert titles/messages can contain user-typed text (ticket titles, item names), so never inject them raw.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendAlertEmail({
  to,
  subject,
  title,
  message,
  link,
}: {
  to: string
  subject: string
  title: string
  message: string
  link?: string
}) {
  if (!process.env.RESEND_API_KEY) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_FROM_EMAIL ?? 'RP Intelligence <alerts@rpsmaintenance.com>'

  const actionHtml = link
    ? `<a href="${escapeHtml(APP_URL + link)}" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">View in RP Intelligence →</a>`
    : ''

  await resend.emails.send({
    from,
    to,
    subject: `[RPS] ${subject}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
        <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#6b7280;letter-spacing:.08em;text-transform:uppercase">RP Intelligence</p>
        <h2 style="margin:0 0 12px;font-size:20px;font-weight:700">${escapeHtml(title)}</h2>
        <p style="margin:0;font-size:15px;color:#374151;line-height:1.6">${escapeHtml(message)}</p>
        ${actionHtml}
        <hr style="margin:32px 0;border:none;border-top:1px solid #e5e7eb"/>
        <p style="margin:0;font-size:12px;color:#9ca3af">You're receiving this because you have email alerts enabled in RP Intelligence. <a href="${APP_URL}/settings/alerts" style="color:#6b7280">Manage alerts</a></p>
      </div>
    `,
  }).catch(() => {})
}
