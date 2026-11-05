/**
 * DQF Manager — DOT audit rules (49 CFR Part 391). RPS runs non-CDL DOT trucks only (over 10,001 lb, no CDL), so Part 382 CDL testing is not checked. Pure functions over an EmployeeFile; no DB access.
 *
 * Severity:
 *   violation — an auditor would cite this (required item missing or expired).
 *   warning   — fix soon (expiring, no copy stored, date missing, done out of order / late).
 *   info      — housekeeping / something to confirm.
 */
import type { EmployeeFile, Row } from '@/lib/compliance-data'
import { addMonthsISO, daysBetween, fmtDate, todayET } from '@/lib/compliance'

export type Severity = 'violation' | 'warning' | 'info'
export type Finding = { severity: Severity; title: string; detail: string; rule: string | null; typeId: string | null }
export type DriverAudit = {
  file: EmployeeFile
  findings: Finding[]
  violations: number
  warnings: number
  ready: boolean          // no violations and no warnings
  scope: 'driver' | 'former_driver' | 'not_flagged'
}

const byName = (f: EmployeeFile, name: string): Row | undefined => f.rows.find(r => r.type.name === name)
const issued = (r: Row | undefined) => r?.item?.issued_date ?? null

export const SEVERITY_STYLE: Record<Severity, { label: string; cls: string }> = {
  violation: { label: 'Violation', cls: 'bg-red-100 text-red-800 border-red-200' },
  warning:   { label: 'Fix soon',  cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  info:      { label: 'Check',     cls: 'bg-blue-50 text-blue-700 border-blue-200' },
}

export function auditFile(file: EmployeeFile, today = todayET()): DriverAudit | null {
  const e = file.employee
  const out: Finding[] = []
  const add = (severity: Severity, title: string, detail: string, row?: Row | null, rule?: string | null) =>
    out.push({ severity, title, detail, rule: rule ?? row?.type.regulation ?? null, typeId: row?.type.id ?? null })

  // Former drivers: the file must be kept 3 years after they leave (391.51(c)).
  if (!e.is_active) {
    if (!e.is_dot_driver) return null
    if (!e.termination_date) {
      add('info', 'Add the termination date', 'Driver files must be kept for 3 years after the driver leaves. Enter the date they left so we know when the file can be destroyed.', null, '49 CFR 391.51(c)')
    } else {
      const keepUntil = addMonthsISO(e.termination_date, 36)
      add('info', daysBetween(today, keepUntil) < 0 ? 'File can now be destroyed' : `Keep this file until ${fmtDate(keepUntil)}`,
        `Left ${fmtDate(e.termination_date)}. Driver files are kept 3 years after employment ends.`, null, '49 CFR 391.51(c)')
    }
    return summarize(file, out, 'former_driver')
  }

  // Not flagged as a DOT driver but has driver paperwork → ask.
  if (!e.is_dot_driver) {
    const dotRows = file.rows.filter(r => r.type.category === 'dqf' && r.item && r.item.status !== 'not_required')
    if (!dotRows.length) return null
    add('info', 'Has DOT driver paperwork but is not marked a DOT driver',
      `On file: ${dotRows.map(r => r.type.name).slice(0, 4).join(', ')}${dotRows.length > 4 ? '…' : ''}. If they drive a company vehicle of 10,001 lb GVWR or more (or truck + trailer over that), turn on "DOT driver" so the full file is required.`, null, '49 CFR 390.5 / 391')
    return summarize(file, out, 'not_flagged')
  }

  // ── Every required DQF item ─────────────────────────────────────────────
  for (const r of file.rows) {
    if (r.type.category !== 'dqf' || !r.required) continue
    const fix = r.type.description ?? ''
    switch (r.health) {
      case 'missing':
        // Company-only paperwork (no federal rule behind it) is a fix-soon, not a citation.
        add(r.type.regulation ? 'violation' : 'warning', `Missing: ${r.type.name}`, fix, r); break
      case 'expired':
        add('violation', `Expired ${fmtDate(r.exp)}: ${r.type.name}`, fix, r); break
      case 'due_soon':
        add('warning', `Due ${fmtDate(r.exp)} (${r.daysLeft} days): ${r.type.name}`, fix, r); break
      case 'in_progress':
        add('warning', `In progress: ${r.type.name}`, 'Marked in progress — finish it and attach the copy.', r); break
      case 'no_date':
        if (r.type.expires) add('warning', `No date entered: ${r.type.name}`,
          `Marked on file, but with no ${r.type.renewal_months ? 'completed/issued' : 'expiration'} date we cannot warn you before it runs out. Enter the date from the document.`, r)
        break
    }
    if (r.item && r.item.status !== 'not_required' && r.item.status !== 'missing' && !r.item.document_path) {
      add('warning', `No copy stored: ${r.type.name}`, 'Marked as on file, but the actual document is not attached. An auditor needs to see the paper — upload the scan.', r)
    }
  }

  // ── Timing rules ───────────────────────────────────────────────────────
  if (!e.hire_date) {
    add('info', 'Add the hire date', 'The pre-hire MVR and prior-employer checks must be done within 30 days of hire — we need the hire date to check that.', null, '49 CFR 391.23')
  } else {
    for (const n of ['Request for Check of Driving Record (pre-hire MVR)', 'Safety Performance History (prior employers)']) {
      const r = byName(file, n), d = issued(r)
      if (r && d && daysBetween(e.hire_date, d) > 30) {
        add('warning', `Done late: ${r.type.name}`, `Dated ${fmtDate(d)}, more than 30 days after hire (${fmtDate(e.hire_date)}). Add a note to the file explaining the delay; it cannot be undone, but it should not be repeated.`, r)
      }
    }
  }

  const med = byName(file, "Medical Examiner's Certificate - DOT Card")
  const nrv = byName(file, 'Medical Examiner National Registry Verification')
  if (med?.item?.issued_date && med.item.expiration_date && daysBetween(med.item.issued_date, med.item.expiration_date) > 731) {
    add('warning', 'Medical card dates look wrong', `Issued ${fmtDate(med.item.issued_date)}, expires ${fmtDate(med.item.expiration_date)} — a DOT medical card is never good for more than 24 months. Re-check the card.`, med, '49 CFR 391.45')
  }
  if (issued(med) && issued(nrv) && issued(nrv)! < issued(med)!) {
    add('warning', 'Registry check is older than the current medical card', `The National Registry verification (${fmtDate(issued(nrv))}) is from before the current exam (${fmtDate(issued(med))}). Look the new examiner up and save a fresh verification.`, nrv)
  }

  const mvr = byName(file, 'Annual MVR'), review = byName(file, 'Annual Review of Driving Record')
  if (issued(mvr) && issued(review) && issued(review)! < issued(mvr)!) {
    add('warning', 'Annual review is older than the latest MVR', `The latest annual MVR is dated ${fmtDate(issued(mvr))} but the last review was ${fmtDate(issued(review))}. Review the new MVR and sign/date the review.`, review)
  }

  // ── Driver identity ────────────────────────────────────────────────────
  if (!e.license_number || !e.license_state) {
    add('info', 'Add license number and state', 'Needed to order MVRs and to match the medical card. Edit employee details.', null, '49 CFR 391.21(b)')
  }

  return summarize(file, out, 'driver')
}

function summarize(file: EmployeeFile, findings: Finding[], scope: DriverAudit['scope']): DriverAudit {
  const order: Severity[] = ['violation', 'warning', 'info']
  findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  const violations = findings.filter(f => f.severity === 'violation').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  return { file, findings, violations, warnings, ready: violations === 0 && warnings === 0, scope }
}

/** Audit everyone the DQF rules touch: active DOT drivers, former drivers still in the retention window, and anyone with driver paperwork who isn't flagged. */
export function auditAll(files: EmployeeFile[], today = todayET()): DriverAudit[] {
  return files.map(f => auditFile(f, today)).filter((a): a is DriverAudit => !!a)
}
