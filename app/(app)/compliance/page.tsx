import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompliance } from '@/lib/compliance-guard'
import { loadFiles } from '@/lib/compliance-data'
import { departmentLabel, fmtDate, CATEGORIES } from '@/lib/compliance'
import { ClickableRow } from '@/components/clickable-row'
import { HealthChip } from '@/components/compliance/health-chip'
import { ShieldCheck, Truck, BadgeCheck, Settings, Grid3x3, UserPlus, AlertTriangle, Clock, FileWarning, Users, ClipboardCheck } from 'lucide-react'

const VIEWS = [
  { value: '',        label: 'Everyone' },
  { value: 'drivers', label: 'DOT drivers' },
  { value: 'construction', label: 'Construction' },
  { value: 'service', label: 'Service' },
  { value: 'mechanics', label: 'Mechanics' },
  { value: 'office', label: 'Office' },
  { value: 'inactive', label: 'Former employees' },
]

export default async function CompliancePage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const sp = await searchParams
  const me = await requireCompliance()
  const admin = createAdminClient()
  const { files: all, settings } = await loadFiles(admin, me.company_id, { includeInactive: true })

  const active = all.filter(f => f.employee.is_active)
  const view = sp.view ?? ''
  const q = (sp.q ?? '').trim().toLowerCase()
  const files = (view === 'inactive' ? all.filter(f => !f.employee.is_active) : active)
    .filter(f => view === 'drivers' ? f.employee.is_dot_driver : ['construction', 'service', 'mechanics', 'office'].includes(view) ? f.employee.department === view : true)
    .filter(f => !q || f.employee.full_name.toLowerCase().includes(q))

  // Attention list = every expired / expiring record across active employees.
  const attention = active.flatMap(f => f.rows.filter(r => r.health === 'expired' || r.health === 'due_soon').map(r => ({ f, r })))
    .sort((a, b) => (a.r.daysLeft ?? 0) - (b.r.daysLeft ?? 0))
  const expired = attention.filter(a => a.r.health === 'expired').length
  const soon = attention.length - expired
  const drivers = active.filter(f => f.employee.is_dot_driver)
  const incompleteDqf = drivers.filter(f => f.rows.some(r => r.required && r.type.category === 'dqf' && r.health === 'missing')).length
  const windowMax = Math.max(...settings.dqf_notice_days, ...settings.cert_notice_days)

  const kpi = 'bg-white rounded-2xl border border-gray-200 shadow-sm p-4'
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl font-bold text-gray-900 tracking-tight">
            <ShieldCheck className="w-6 h-6 text-blue-600" />
            DQF &amp; Certifications
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Driver qualification files, DOT cards and every manufacturer, state and safety certification — with automatic expiry notices.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/compliance/audit" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-sm font-semibold text-blue-700 hover:border-blue-400"><ClipboardCheck className="w-4 h-4" />DOT file audit</Link>
          <Link href="/compliance/matrix" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-blue-300"><Grid3x3 className="w-4 h-4" />Matrix</Link>
          <Link href="/compliance/settings" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:border-blue-300"><Settings className="w-4 h-4" />Notices &amp; settings</Link>
          {me.canWrite && <Link href="/compliance/employees/new" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"><UserPlus className="w-4 h-4" />Add employee</Link>}
        </div>
      </div>

      {!settings.emails_enabled && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Automatic expiry emails are <b>off</b>. Review the roster below, then turn them on in{' '}
          <Link href="/compliance/settings" className="font-semibold underline">Notices &amp; settings</Link>.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className={kpi}><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-red-500" />Expired</p><p className="text-2xl font-bold text-red-600 mt-1">{expired}</p></div>
        <div className={kpi}><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-500" />Expiring ≤ {windowMax} days</p><p className="text-2xl font-bold text-amber-600 mt-1">{soon}</p></div>
        <div className={kpi}><Link href="/compliance/audit" className="block"><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><FileWarning className="w-3.5 h-3.5 text-gray-500" />Driver files incomplete</p><p className="text-2xl font-bold text-gray-900 mt-1">{incompleteDqf}<span className="text-sm font-medium text-gray-400"> / {drivers.length}</span></p></Link></div>
        <div className={kpi}><p className="text-xs font-medium text-gray-500 inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-blue-500" />Employees tracked</p><p className="text-2xl font-bold text-gray-900 mt-1">{active.length}</p></div>
      </div>

      {/* Needs attention */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Needs attention</h2>
          <span className="text-xs text-gray-400">expired and expiring within the notice window</span>
        </div>
        {!attention.length ? (
          <p className="px-4 py-6 text-sm text-gray-400">Nothing expired or expiring. 👍</p>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Employee</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Item</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500 hidden md:table-cell">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Expires</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {attention.map(({ f, r }) => (
                  <ClickableRow key={`${f.employee.id}-${r.type.id}`} href={`/compliance/employees/${f.employee.id}`}>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{f.employee.full_name}</td>
                    <td className="px-4 py-2.5 text-gray-700">{r.type.name}</td>
                    <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">{CATEGORIES.find(c => c.value === r.type.category)?.label}</td>
                    <td className="px-4 py-2.5 text-gray-700 tabular-nums">{fmtDate(r.exp)}</td>
                    <td className="px-4 py-2.5"><HealthChip health={r.health} daysLeft={r.daysLeft} /></td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Roster */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {VIEWS.map(v => (
          <Link key={v.value} href={v.value ? `/compliance?view=${v.value}` : '/compliance'}
            className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${view === v.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
            {v.label}
          </Link>
        ))}
        <form className="ml-auto">
          {view && <input type="hidden" name="view" value={view} />}
          <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name…" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </form>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {!files.length ? (
          <p className="px-4 py-8 text-sm text-gray-400">No employees match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Employee</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Department</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Driver file</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Certifications</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Next expiry</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Standing</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {files.map(f => {
                  const dqf = f.rows.filter(r => r.type.category === 'dqf' && r.required)
                  const dqfDone = dqf.filter(r => !['missing', 'expired'].includes(r.health)).length
                  const certs = f.rows.filter(r => r.type.category === 'certification' && r.item && r.health !== 'missing' && r.health !== 'not_required')
                  const certsCurrent = certs.filter(r => r.health === 'ok' || r.health === 'no_date' || r.health === 'due_soon').length
                  const next = f.rows.filter(r => r.exp && r.daysLeft != null && r.daysLeft >= 0).sort((a, b) => a.daysLeft! - b.daysLeft!)[0]
                  return (
                    <ClickableRow key={f.employee.id} href={`/compliance/employees/${f.employee.id}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{f.employee.full_name}</p>
                        <p className="text-xs text-gray-400">{f.employee.job_title ?? ''}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{departmentLabel(f.employee.department)}</td>
                      <td className="px-4 py-3">
                        {f.employee.is_dot_driver
                          ? <span className={`inline-flex items-center gap-1 text-xs font-semibold ${dqfDone === dqf.length ? 'text-green-700' : 'text-gray-700'}`}><Truck className="w-3.5 h-3.5" />{dqfDone}/{dqf.length}</span>
                          : <span className="text-xs text-gray-300">not a DOT driver</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700"><BadgeCheck className="w-3.5 h-3.5 text-blue-500" />{certsCurrent}{certs.length !== certsCurrent ? <span className="text-red-600"> · {certs.length - certsCurrent} expired</span> : ''}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 hidden lg:table-cell">{next ? <>{next.type.name} · <span className="tabular-nums">{fmtDate(next.exp)}</span></> : '—'}</td>
                      <td className="px-4 py-3"><HealthChip health={f.employee.is_active ? f.worst : 'not_required'} /></td>
                      <td className="px-4 py-3 text-right text-xs text-blue-600 font-medium">Open →</td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
