import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { departmentLabel, fmtDate, noticeDaysFor, noticeStage, stageLabel, todayET, daysBetween } from '@/lib/compliance'
import { loadFiles, type EmployeeFile, type Row } from '@/lib/compliance-data'
import { auditAll } from '@/lib/compliance-audit'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://rpintelligence.app'

export type Notice = { file: EmployeeFile; row: Row; stage: string }
export type OutgoingEmail = { to: string; subject: string; html: string; kind: 'employee' | 'management' | 'digest'; notices: Notice[] }
export type CheckResult = {
  today: string
  emailsEnabled: boolean
  notices: number
  emails: { to: string; subject: string; kind: string; items: number }[]
  sent: number
  failed: string[]
  digest: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function shell(title: string, intro: string, body: string): string {
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:28px 20px;color:#1a1a1a">
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#6b7280;letter-spacing:.08em;text-transform:uppercase">RP Intelligence · DQF &amp; Certifications</p>
    <h2 style="margin:0 0 10px;font-size:20px;font-weight:700">${esc(title)}</h2>
    <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.6">${intro}</p>
    ${body}
    <hr style="margin:28px 0;border:none;border-top:1px solid #e5e7eb"/>
    <p style="margin:0;font-size:12px;color:#9ca3af">Rappahannock Petroleum · 540-869-5033. Questions about this notice? Call the office.</p>
  </div>`
}

function table(rows: { who?: string; what: string; when: string; status: string; tone: 'red' | 'amber' | 'gray' }[], showWho: boolean): string {
  const tone = { red: '#b91c1c', amber: '#b45309', gray: '#4b5563' }
  const th = 'text-align:left;padding:6px 8px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb'
  const td = 'padding:8px;font-size:14px;border-bottom:1px solid #f3f4f6;vertical-align:top'
  return `<table style="width:100%;border-collapse:collapse">
    <tr>${showWho ? `<th style="${th}">Employee</th>` : ''}<th style="${th}">Item</th><th style="${th}">Expires</th><th style="${th}">Status</th></tr>
    ${rows.map(r => `<tr>${showWho ? `<td style="${td}">${esc(r.who ?? '')}</td>` : ''}<td style="${td}">${esc(r.what)}</td><td style="${td}">${esc(r.when)}</td><td style="${td};color:${tone[r.tone]};font-weight:600">${esc(r.status)}</td></tr>`).join('')}
  </table>`
}

function noticeRow(n: Notice) {
  const d = n.row.daysLeft ?? 0
  return {
    who: n.file.employee.full_name,
    what: n.row.type.name,
    when: fmtDate(n.row.exp),
    status: stageLabel(n.stage, d),
    tone: (n.stage === 'expired' ? 'red' : d <= 14 ? 'amber' : 'gray') as 'red' | 'amber' | 'gray',
  }
}

/** Find every notice that is due today and hasn't been sent yet. */
export async function findDueNotices(admin: SupabaseClient, companyId: string) {
  const { files, settings } = await loadFiles(admin, companyId)
  const today = todayET()
  const candidates: Notice[] = []
  for (const file of files) {
    for (const row of file.rows) {
      if (!row.type.expires || !row.exp || row.daysLeft == null || !row.item) continue
      if (row.item.status === 'not_required') continue
      if (row.type.notify === false) continue   // tracked on the dashboard only, no emails
      const stage = noticeStage(row.daysLeft, noticeDaysFor(row.type, settings))
      if (stage) candidates.push({ file, row, stage })
    }
  }
  if (!candidates.length) return { settings, files, due: [] as Notice[], today }

  const { data: logs } = await admin.from('hr_notice_log')
    .select('item_id, stage, expiration_date, sent_at')
    .in('item_id', candidates.map(c => c.row.item!.id))
  const due = candidates.filter(c => {
    const mine = (logs ?? []).filter(l => l.item_id === c.row.item!.id && l.stage === c.stage && l.expiration_date === c.row.exp)
    if (!mine.length) return true
    if (c.stage !== 'expired') return false
    const last = mine.map(l => l.sent_at as string).sort().at(-1)!
    return daysBetween(last.slice(0, 10), today) >= Math.max(1, settings.overdue_repeat_days)
  })
  return { settings, files, due, today }
}

/** Plan the emails for today's notices (+ the weekly digest when it's digest day). */
export async function planEmails(admin: SupabaseClient, companyId: string, opts: { forceDigest?: boolean } = {}) {
  const { settings, files, due, today } = await findDueNotices(admin, companyId)
  const emails: OutgoingEmail[] = []

  // 1) Each employee gets their own list.
  if (settings.notify_employee) {
    const byEmp = new Map<string, Notice[]>()
    for (const n of due) {
      const e = n.file.employee
      if (!e.notify_employee || !e.email) continue
      byEmp.set(e.id, [...(byEmp.get(e.id) ?? []), n])
    }
    for (const list of byEmp.values()) {
      const e = list[0].file.employee
      const expired = list.some(n => n.stage === 'expired')
      const first = e.full_name.split(/[ ,]+/).filter(Boolean)[e.full_name.includes(',') ? 1 : 0] ?? e.full_name
      emails.push({
        to: e.email!, kind: 'employee', notices: list,
        subject: list.length === 1
          ? (expired ? `Action needed: your ${list[0].row.type.name} has expired` : `Reminder: your ${list[0].row.type.name} expires ${fmtDate(list[0].row.exp)}`)
          : `${expired ? 'Action needed' : 'Reminder'}: ${list.length} cards/certifications need renewal`,
        html: shell(
          expired ? 'Your card or certification has expired' : 'Your card or certification is expiring soon',
          `Hi ${esc(first)}, the following ${list.length === 1 ? 'item on file for you needs' : 'items on file for you need'} to be renewed. Please get the renewal done and send a photo or copy of the new card to the office so your file stays current.`,
          table(list.map(noticeRow), false),
        ),
      })
    }
  }

  // 2) Management: everyone on the "all notices" list, plus the DQF-only and certification-only lists.
  const mgmt = new Map<string, Notice[]>()
  const add = (to: string, n: Notice) => mgmt.set(to, [...(mgmt.get(to) ?? []), n])
  for (const n of due) {
    for (const to of settings.management_emails) add(to, n)
    if (n.row.type.category === 'dqf') for (const to of settings.dqf_management_emails) add(to, n)
    else for (const to of settings.cert_management_emails) add(to, n)
  }
  for (const [to, list0] of mgmt) {
    const list = [...new Map(list0.map(n => [n.row.item!.id, n])).values()]
      .sort((a, b) => (a.row.daysLeft ?? 0) - (b.row.daysLeft ?? 0))
    const expired = list.filter(n => n.stage === 'expired').length
    emails.push({
      to, kind: 'management', notices: list,
      subject: `DQF & certifications: ${expired ? `${expired} expired, ` : ''}${list.length - expired} expiring soon`,
      html: shell(
        'Expiring cards & certifications',
        `${list.length} new notice${list.length === 1 ? '' : 's'} today. Employees with an email on file were sent their own reminder.`,
        table(list.map(noticeRow), true) +
        `<a href="${APP_URL}/compliance" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">Open the tracker →</a>`,
      ),
    })
  }

  // 3) Weekly digest to management: the whole picture, including missing DQF paperwork.
  let digest = false
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const digestTo = [...new Set([...settings.management_emails, ...settings.dqf_management_emails, ...settings.cert_management_emails])]
  if ((settings.weekly_digest && weekday === settings.digest_weekday) || opts.forceDigest) {
    const { data: already } = await admin.from('hr_notice_log').select('id').eq('company_id', companyId).eq('stage', 'digest').eq('expiration_date', today).limit(1)
    if ((!already?.length || opts.forceDigest) && digestTo.length) {
      digest = true
      const windowMax = Math.max(...settings.dqf_notice_days, ...settings.cert_notice_days, 0)
      const expiring: { who: string; what: string; when: string; status: string; tone: 'red' | 'amber' | 'gray' }[] = []
      const missingDqf: string[] = []
      let quietExpired = 0
      for (const f of files) {
        for (const r of f.rows) {
          if (r.type.notify === false) { if (r.health === 'expired') quietExpired++; continue }
          if ((r.health === 'expired' || r.health === 'due_soon') && r.daysLeft != null) {
            expiring.push({ who: f.employee.full_name, what: r.type.name, when: fmtDate(r.exp), status: stageLabel(r.health === 'expired' ? 'expired' : String(windowMax), r.daysLeft), tone: r.health === 'expired' ? 'red' : r.daysLeft <= 14 ? 'amber' : 'gray' })
          }
        }
        const gaps = f.rows.filter(r => r.required && r.health === 'missing' && r.type.category === 'dqf')
        if (gaps.length) missingDqf.push(`<li style="margin:0 0 6px"><b>${esc(f.employee.full_name)}</b> <span style="color:#6b7280">(${esc(departmentLabel(f.employee.department))})</span> — ${gaps.map(g => esc(g.type.name)).join(', ')}</li>`)
      }
      expiring.sort((a, b) => a.when.localeCompare(b.when))
      const audits = auditAll(files).filter(a => a.scope === 'driver')
      const auditLine = audits.length
        ? `<p style="font-size:14px;margin:18px 0 0"><b>DOT file audit:</b> ${audits.filter(a => a.ready).length} of ${audits.length} driver files audit-ready · ${audits.reduce((n, a) => n + a.violations, 0)} violations · ${audits.reduce((n, a) => n + a.warnings, 0)} items to fix. <a href="${APP_URL}/compliance/audit">See the audit →</a></p>`
        : ''
      const html = shell(
        'Weekly DQF & certification roll-up',
        `${files.length} active employees tracked · ${expiring.filter(e => e.tone === 'red').length} expired · ${expiring.filter(e => e.tone !== 'red').length} expiring within ${windowMax} days · ${missingDqf.length} driver file${missingDqf.length === 1 ? '' : 's'} incomplete.`,
        (expiring.length ? `<h3 style="font-size:15px;margin:8px 0">Expired / expiring</h3>${table(expiring, true)}` : '<p>Nothing expired or expiring. 👍</p>') +
        (missingDqf.length ? `<h3 style="font-size:15px;margin:22px 0 8px">Driver files missing paperwork</h3><ul style="padding-left:18px;font-size:14px;line-height:1.5">${missingDqf.join('')}</ul>` : '') +
        auditLine +
        (quietExpired ? `<p style="font-size:13px;color:#6b7280;margin:14px 0 0">${quietExpired} certification${quietExpired === 1 ? ' is' : 's are'} expired with notices turned off — listed on the tracker, no action emailed.</p>` : '') +
        `<a href="${APP_URL}/compliance" style="display:inline-block;margin-top:20px;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600">Open the tracker →</a>`,
      )
      for (const to of digestTo) emails.push({ to, kind: 'digest', notices: [], subject: `Weekly DQF & certification roll-up — ${fmtDate(today)}`, html })
    }
  }

  return { settings, due, emails, digest, today }
}

/**
 * The daily check. Sends nothing unless Settings → "Send emails" is on (or `send` is forced for a test);
 * otherwise returns what it *would* send. Every sent notice is logged so it is never repeated.
 */
export async function runComplianceCheck(admin: SupabaseClient, companyId: string, opts: { dryRun?: boolean; forceDigest?: boolean; onlyTo?: string } = {}): Promise<CheckResult> {
  const { settings, due, emails: planned, digest, today } = await planEmails(admin, companyId, { forceDigest: opts.forceDigest })
  const emails = opts.onlyTo ? planned.filter(e => e.to === opts.onlyTo) : planned
  const result: CheckResult = {
    today, emailsEnabled: settings.emails_enabled, notices: due.length, digest,
    emails: emails.map(e => ({ to: e.to, subject: e.subject, kind: e.kind, items: e.notices.length })),
    sent: 0, failed: [],
  }
  if (opts.dryRun || !settings.emails_enabled) return result
  if (!process.env.RESEND_API_KEY) { result.failed.push('RESEND_API_KEY is not set'); return result }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_COMPLIANCE_FROM ?? process.env.RESEND_FROM_EMAIL ?? 'RP Intelligence <alerts@rpsmaintenance.com>'
  const replyTo = process.env.RESEND_REPLY_TO
  const logs: { company_id: string; item_id: string | null; stage: string; expiration_date: string | null; recipient: string }[] = []

  for (const e of emails) {
    try {
      const { error } = await resend.emails.send({ from, to: e.to, subject: `[RPS] ${e.subject}`, html: e.html, ...(replyTo ? { replyTo } : {}) })
      if (error) { result.failed.push(`${e.to}: ${error.message}`); continue }
      result.sent++
      if (e.kind === 'digest') logs.push({ company_id: companyId, item_id: null, stage: 'digest', expiration_date: today, recipient: e.to })
      for (const n of e.notices) logs.push({ company_id: companyId, item_id: n.row.item!.id, stage: n.stage, expiration_date: n.row.exp, recipient: e.to })
    } catch (err) {
      result.failed.push(`${e.to}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // A notice nobody could be emailed (no employee email, no management list) is still logged once,
  // so it doesn't stay "new" forever; it shows on the dashboard regardless.
  const logged = new Set(logs.map(l => `${l.item_id}|${l.stage}`))
  for (const n of due) if (!logged.has(`${n.row.item!.id}|${n.stage}`) && !opts.onlyTo) logs.push({ company_id: companyId, item_id: n.row.item!.id, stage: n.stage, expiration_date: n.row.exp, recipient: '(no recipient)' })
  if (logs.length) await admin.from('hr_notice_log').insert(logs)
  return result
}

/** One test email to a single address so a manager can see what notices look like. */
export async function sendTestEmail(to: string): Promise<string | null> {
  if (!process.env.RESEND_API_KEY) return 'RESEND_API_KEY is not set in Vercel, so the app cannot send email yet.'
  const resend = new Resend(process.env.RESEND_API_KEY)
  const from = process.env.RESEND_COMPLIANCE_FROM ?? process.env.RESEND_FROM_EMAIL ?? 'RP Intelligence <alerts@rpsmaintenance.com>'
  const { error } = await resend.emails.send({
    from, to, subject: '[RPS] Test — DQF & certification notices',
    html: shell('Test notice', 'This is what expiry notices from RP Intelligence look like.', table([
      { who: 'Sample Driver', what: "Medical Examiner's Certificate - DOT Card", when: '12/01/26', status: 'expires in 30 days', tone: 'gray' },
      { who: 'Sample Tech', what: 'OPW Certification', when: '10/01/26', status: 'EXPIRED 22 days ago', tone: 'red' },
    ], true)),
  })
  return error ? error.message : null
}
