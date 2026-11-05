import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompliance } from '@/lib/compliance-guard'
import { loadFiles } from '@/lib/compliance-data'
import { auditAll, SEVERITY_STYLE, type DriverAudit } from '@/lib/compliance-audit'
import { departmentLabel, fmtDate } from '@/lib/compliance'
import { ClipboardCheck, CheckCircle2, AlertTriangle, Clock, Info } from 'lucide-react'

export const metadata = { title: 'DOT file audit' }

function DriverCard({ a, open }: { a: DriverAudit; open: boolean }) {
  const e = a.file.employee
  const infos = a.findings.length - a.violations - a.warnings
  return (
    <details open={open} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-3 break-inside-avoid">
      <summary className="px-4 py-3 flex flex-wrap items-center gap-3 cursor-pointer hover:bg-gray-50">
        <span className="flex-1 min-w-48">
          <Link href={`/compliance/employees/${e.id}`} className="font-semibold text-gray-900 hover:text-blue-700">{e.full_name}</Link>
          <span className="block text-xs text-gray-500">
            {[e.job_title, departmentLabel(e.department), e.hire_date ? `hired ${fmtDate(e.hire_date)}` : null, e.is_cdl ? 'CDL' : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        {a.ready && a.scope === 'driver' && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3.5 h-3.5" />Audit-ready</span>}
        {a.violations > 0 && <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${SEVERITY_STYLE.violation.cls}`}>{a.violations} violation{a.violations === 1 ? '' : 's'}</span>}
        {a.warnings > 0 && <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${SEVERITY_STYLE.warning.cls}`}>{a.warnings} to fix</span>}
        {infos > 0 && <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${SEVERITY_STYLE.info.cls}`}>{infos} to check</span>}
      </summary>
      {a.findings.length > 0 && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {a.findings.map((f, i) => (
            <li key={i} className="px-4 py-2.5 flex gap-3">
              <span className={`shrink-0 h-fit mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${SEVERITY_STYLE[f.severity].cls}`}>{SEVERITY_STYLE[f.severity].label}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{f.title}{f.rule && <span className="ml-2 text-xs font-normal text-gray-400">{f.rule}</span>}</p>
                {f.detail && <p className="text-xs text-gray-600 mt-0.5">{f.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

export default async function DqfAuditPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const sp = await searchParams
  const me = await requireCompliance()
  const admin = createAdminClient()
  const { files } = await loadFiles(admin, me.company_id, { includeInactive: true })
  const audits = auditAll(files)
  const drivers = audits.filter(a => a.scope === 'driver').sort((x, y) => y.violations - x.violations || y.warnings - x.warnings || x.file.employee.full_name.localeCompare(y.file.employee.full_name))
  const unflagged = audits.filter(a => a.scope === 'not_flagged')
  const former = audits.filter(a => a.scope === 'former_driver')
  const ready = drivers.filter(a => a.ready).length
  const violations = drivers.reduce((n, a) => n + a.violations, 0)
  const warnings = drivers.reduce((n, a) => n + a.warnings, 0)
  const expandAll = sp.all === '1'

  // The most common gaps across the fleet — what to work on first.
  const gapCounts = new Map<string, number>()
  const typeName = new Map(files.flatMap(f => f.rows.map(r => [r.type.id, r.type.name] as const)))
  for (const a of drivers) for (const f of a.findings) if (f.severity === 'violation' && f.typeId) {
    const key = `${f.title.startsWith('Expired') ? 'Expired' : 'Missing'}: ${typeName.get(f.typeId)}`
    gapCounts.set(key, (gapCounts.get(key) ?? 0) + 1)
  }
  const topGaps = [...gapCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  const kpi = 'bg-white rounded-2xl border border-gray-200 shadow-sm p-4'
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/compliance" className="text-sm text-gray-500 hover:text-gray-700 print:hidden">← DQF &amp; Certifications</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-2 mb-5">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl font-bold text-gray-900 tracking-tight"><ClipboardCheck className="w-6 h-6 text-blue-600" />DOT file audit</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Every DOT driver&apos;s qualification file checked against 49 CFR 391 (and Part 382 for CDL drivers) — what is missing, expired,
            done late, or marked on file without a copy. Each line says how to fix it. Run {fmtDate(new Date().toISOString().slice(0, 10))}.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Link href={expandAll ? '/compliance/audit' : '/compliance/audit?all=1'} className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-blue-300">{expandAll ? 'Collapse' : 'Expand all'}</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className={kpi}><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" />Audit-ready files</p><p className="text-2xl font-bold text-gray-900 mt-1">{ready}<span className="text-sm font-medium text-gray-400"> / {drivers.length}</span></p></div>
        <div className={kpi}><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-red-500" />Violations</p><p className="text-2xl font-bold text-red-600 mt-1">{violations}</p></div>
        <div className={kpi}><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-500" />To fix soon</p><p className="text-2xl font-bold text-amber-600 mt-1">{warnings}</p></div>
        <div className={kpi}><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><Info className="w-3.5 h-3.5 text-blue-500" />Others to check</p><p className="text-2xl font-bold text-gray-900 mt-1">{unflagged.length + former.length}</p></div>
      </div>

      {topGaps.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-6">
          <h2 className="font-semibold text-gray-900 mb-2">Biggest gaps across all drivers</h2>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {topGaps.map(([k, n]) => <li key={k} className="flex justify-between gap-3"><span className="text-gray-700">{k}</span><span className="font-semibold text-red-600 tabular-nums">{n} driver{n === 1 ? '' : 's'}</span></li>)}
          </ul>
        </div>
      )}

      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">DOT drivers ({drivers.length})</h2>
      {drivers.map(a => <DriverCard key={a.file.employee.id} a={a} open={expandAll || (!a.ready && drivers.length <= 3)} />)}
      {!drivers.length && <p className="text-sm text-gray-500 mb-6">No active employees are marked as DOT drivers.</p>}

      {unflagged.length > 0 && (<>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mt-6 mb-2">Not marked as DOT drivers, but have driver paperwork ({unflagged.length})</h2>
        {unflagged.map(a => <DriverCard key={a.file.employee.id} a={a} open={expandAll} />)}
      </>)}

      {former.length > 0 && (<>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mt-6 mb-2">Former drivers — 3-year retention ({former.length})</h2>
        {former.map(a => <DriverCard key={a.file.employee.id} a={a} open={expandAll} />)}
      </>)}

      <p className="text-xs text-gray-400 mt-6">
        Checks are based on 49 CFR 391.21–391.51 (driver qualification), 395.8(j)(2), and Part 382 (CDL drug &amp; alcohol, Clearinghouse).
        This is a working tool, not legal advice — the FMCSA regulations are the final word.
      </p>
    </div>
  )
}
