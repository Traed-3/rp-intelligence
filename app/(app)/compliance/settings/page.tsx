import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompliance } from '@/lib/compliance-guard'
import { loadSettings, loadTypes } from '@/lib/compliance-data'
import { fmtDate } from '@/lib/compliance'
import { saveComplianceAccess } from '../actions'
import { COMPLIANCE_READ_ROLES } from '@/lib/compliance'
import { NoticeSettingsForm, PreviewAndTest, RequirementTypeForm, RequirementTypeList } from '@/components/compliance/settings-forms'

export default async function ComplianceSettingsPage() {
  const me = await requireCompliance()
  const admin = createAdminClient()
  const [settings, types, { data: log }, { data: people }] = await Promise.all([
    loadSettings(admin, me.company_id),
    loadTypes(admin, me.company_id, true),
    admin.from('hr_notice_log').select('id, stage, recipient, sent_at, expiration_date, hr_employee_items(hr_employees(full_name), hr_requirement_types(name))')
      .eq('company_id', me.company_id).order('sent_at', { ascending: false }).limit(25),
    admin.from('profiles').select('id, full_name, email, role, is_active').eq('company_id', me.company_id).order('full_name'),
  ])
  const canManageAccess = ['owner', 'manager'].includes(me.role)
  const granted = new Set(settings.access_profile_ids ?? [])
  const byRole = (people ?? []).filter(p => p.is_active !== false && COMPLIANCE_READ_ROLES.includes(p.role))
  const others = (people ?? []).filter(p => p.is_active !== false && !COMPLIANCE_READ_ROLES.includes(p.role))
  const card = 'bg-white rounded-2xl border border-gray-200 shadow-sm mb-6'
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/compliance" className="text-sm text-gray-500 hover:text-gray-700">← DQF &amp; Certifications</Link>
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight mt-2 mb-5">Notices &amp; settings</h1>

      <section className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 mb-4">Expiry notices</h2>
        <NoticeSettingsForm settings={settings} canWrite={me.canWrite} />
      </section>

      <section className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900">Who else can use DQF &amp; Certs</h2>
        <p className="text-xs text-gray-500 mt-0.5 mb-3">
          Owners, managers and construction managers always have it ({byRole.map(p => p.full_name ?? p.email).join(', ') || 'none'}).
          Tick anyone else who keeps the driver files — they get full DQF &amp; Certs access without changing their role for the rest of the app.
        </p>
        <form action={saveComplianceAccess} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {others.map(p => (
            <label key={p.id} className="inline-flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" name="profile_id" value={p.id} defaultChecked={granted.has(p.id)} disabled={!canManageAccess} className="w-4 h-4" />
              <span>{p.full_name ?? p.email} <span className="text-xs text-gray-400">({p.role})</span></span>
            </label>
          ))}
          {canManageAccess && <div className="sm:col-span-2 lg:col-span-3 pt-2"><button className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700">Save access</button></div>}
        </form>
      </section>

      <section className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 mb-3">Preview &amp; test</h2>
        <PreviewAndTest canWrite={me.canWrite} />
      </section>

      <section id="types" className={card}>
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Requirements &amp; certification types</h2>
          <p className="text-xs text-gray-500 mt-0.5">“Every DOT driver” items are added to each driver’s file automatically; “Only when added” items (manufacturer and state certs) are added per person from their file. Click a row to edit.</p>
        </div>
        <RequirementTypeList types={types} canWrite={me.canWrite} />
        {me.canWrite && (
          <div className="px-4 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
            <p className="text-sm font-semibold text-gray-800 mb-2">Add a new requirement / certification type</p>
            <RequirementTypeForm canWrite={me.canWrite} />
          </div>
        )}
      </section>

      <section className={card}>
        <h2 className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900">Recently sent notices</h2>
        {!log?.length ? <p className="px-4 py-4 text-sm text-gray-400">Nothing sent yet.</p> : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {log.map(l => {
                const rel = l.hr_employee_items as unknown as { hr_employees: { full_name: string } | null; hr_requirement_types: { name: string } | null } | null
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtDate(String(l.sent_at).slice(0, 10))}</td>
                    <td className="px-4 py-2 text-gray-800">{l.stage === 'digest' ? 'Weekly roll-up' : `${rel?.hr_employees?.full_name ?? ''} — ${rel?.hr_requirement_types?.name ?? ''}`}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{l.stage === 'expired' ? 'expired' : l.stage === 'digest' ? '' : `${l.stage}-day`}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{l.recipient}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
