import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompliance } from '@/lib/compliance-guard'
import { loadFiles } from '@/lib/compliance-data'
import { CATEGORIES, CERT_KINDS, departmentLabel, fmtDate } from '@/lib/compliance'
import { EmployeeForm } from '@/components/compliance/employee-form'
import { ItemRow } from '@/components/compliance/item-row'
import { HealthChip } from '@/components/compliance/health-chip'
import { updateEmployee, addRequirement } from '../../actions'
import { auditFile, SEVERITY_STYLE } from '@/lib/compliance-audit'
import { Truck, Mail, Phone, IdCard, ClipboardCheck, Paperclip } from 'lucide-react'

export default async function EmployeeFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = await requireCompliance()
  const admin = createAdminClient()
  const { files, types } = await loadFiles(admin, me.company_id, { includeInactive: true, employeeId: id })
  const file = files[0]
  if (!file) notFound()
  const e = file.employee

  const { data: history } = await admin.from('hr_item_history')
    .select('id, item_id, issued_date, expiration_date, cert_number, replaced_at, document_path, document_name, hr_employee_items!inner(employee_id, hr_requirement_types(name))')
    .eq('hr_employee_items.employee_id', id).order('replaced_at', { ascending: false }).limit(200)

  const audit = auditFile(file)
  const present = new Set(file.rows.map(r => r.type.id))
  const addable = types.filter(t => t.is_active && !present.has(t.id))

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/compliance" className="text-sm text-gray-500 hover:text-gray-700">← DQF &amp; Certifications</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-2 mb-5">
        <div>
          <h1 className="rp-title">{e.full_name}</h1>
          <p className="text-sm text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{[e.job_title, departmentLabel(e.department)].filter(Boolean).join(' · ')}</span>
            {e.hire_date && <span>Hired {fmtDate(e.hire_date)}</span>}
            {e.is_dot_driver && <span className="inline-flex items-center gap-1 text-blue-700 font-semibold"><Truck className="w-3.5 h-3.5" />DOT driver{e.is_cdl ? ' · CDL' : ''}</span>}
            {!e.is_active && <span className="text-red-600 font-semibold">Former employee{e.termination_date ? ` (${fmtDate(e.termination_date)})` : ''}</span>}
          </p>
          <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-4">
            {e.email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{e.email}{!e.notify_employee && ' (reminders off)'}</span>}
            {e.phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{e.phone}</span>}
            {e.license_number && <span className="inline-flex items-center gap-1"><IdCard className="w-3 h-3" />{e.license_state} {e.license_number}{e.license_class ? ` · Class ${e.license_class}` : ''}</span>}
          </p>
        </div>
        <HealthChip health={file.worst} />
      </div>

      {audit && audit.findings.length > 0 && (
        <section className="rp-card overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-900 inline-flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-blue-600" />DOT audit</h2>
            <span className="text-xs text-gray-400">{audit.violations} violation{audit.violations === 1 ? '' : 's'} · {audit.warnings} to fix · <Link href="/compliance/audit" className="hover:underline">all drivers</Link></span>
          </div>
          <ul className="divide-y divide-gray-50">
            {audit.findings.map((f, i) => (
              <li key={i} className="px-4 py-2 flex gap-3">
                <span className={`shrink-0 h-fit mt-0.5 px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${SEVERITY_STYLE[f.severity].cls}`}>{SEVERITY_STYLE[f.severity].label}</span>
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">{f.title}{f.rule && <span className="ml-2 text-xs text-gray-400">{f.rule}</span>}</p>
                  {f.detail && <p className="text-xs text-gray-500">{f.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {audit?.ready && audit.scope === 'driver' && (
        <p className="mb-5 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 font-medium">DOT file is audit-ready — every required item is on file, current, and has a copy attached.</p>
      )}

      {CATEGORIES.map(cat => {
        const rows = file.rows.filter(r => r.type.category === cat.value)
        if (cat.value === 'dqf' && !e.is_dot_driver && !rows.some(r => r.item)) return null
        // Certifications grouped by kind so state cards, manufacturer cards and safety cards sit together.
        const groups = cat.value === 'certification'
          ? [...CERT_KINDS.map(k => ({ label: k.label, rows: rows.filter(r => r.type.kind === k.value) })), { label: 'Other', rows: rows.filter(r => !CERT_KINDS.some(k => k.value === r.type.kind)) }]
          : [{ label: '', rows }]
        const addHere = addable.filter(t => t.category === cat.value)
        return (
          <section key={cat.value} className="rp-card overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">{cat.label}</h2>
              <span className="text-xs text-gray-400">
                {rows.filter(r => r.health === 'expired').length} expired · {rows.filter(r => r.health === 'due_soon').length} due soon · {rows.filter(r => r.required && r.health === 'missing').length} missing
              </span>
            </div>
            {!rows.length && <p className="px-4 py-4 text-sm text-gray-400">Nothing on file yet.</p>}
            {groups.filter(g => g.rows.length).map(g => (
              <div key={g.label}>
                {g.label && <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.label}</p>}
                {g.rows.map(r => (
                  <ItemRow key={r.type.id} employeeId={e.id} type={r.type} item={r.item} health={r.health} exp={r.exp} daysLeft={r.daysLeft} required={r.required} canWrite={me.canWrite} />
                ))}
              </div>
            ))}
            {me.canWrite && addHere.length > 0 && (
              <form action={addRequirement} className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center gap-2">
                <input type="hidden" name="employee_id" value={e.id} />
                <select name="type_id" className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm min-w-64">
                  {addHere.map(t => <option key={t.id} value={t.id}>{t.name}{t.issuer ? ` — ${t.issuer}` : ''}</option>)}
                </select>
                <button className="px-3 py-1.5 rounded-lg border border-blue-300 bg-card text-xs font-semibold text-blue-700 hover:bg-blue-50">+ Add to file</button>
                {cat.value === 'certification' && <Link href="/compliance/settings#types" className="text-xs text-gray-500 hover:underline">Not listed? Add a new certification type</Link>}
              </form>
            )}
          </section>
        )
      })}

      {!!history?.length && (
        <section className="rp-card overflow-hidden mb-5">
          <h2 className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Earlier copies &amp; renewal history</h2>
          <table className="rp-table w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {history.map(h => {
                const rel = h.hr_employee_items as unknown as { hr_requirement_types: { name: string } | null }
                return (
                  <tr key={h.id}>
                    <td className="px-4 py-2 text-gray-800">{rel?.hr_requirement_types?.name}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">issued {fmtDate(h.issued_date)} · expired {fmtDate(h.expiration_date)}{h.cert_number ? ` · #${h.cert_number}` : ''}</td>
                    <td className="px-4 py-2 text-xs">{h.document_path && <a href={`/api/compliance/documents/${h.item_id}?history=${h.id}`} target="_blank" className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Paperclip className="w-3 h-3" />{h.document_name ?? 'file'}</a>}</td>
                    <td className="px-4 py-2 text-gray-400 text-xs text-right">replaced {fmtDate(String(h.replaced_at).slice(0, 10))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      {me.canWrite && (
        <details className="rp-card mb-8">
          <summary className="px-4 py-3 font-semibold text-gray-900 cursor-pointer">Edit employee details</summary>
          <div className="px-4 pb-5 pt-2"><EmployeeForm action={updateEmployee.bind(null, e.id)} employee={e} /></div>
        </details>
      )}
    </div>
  )
}
