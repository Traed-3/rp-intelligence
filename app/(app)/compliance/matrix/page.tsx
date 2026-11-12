import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCompliance } from '@/lib/compliance-guard'
import { loadFiles } from '@/lib/compliance-data'
import { HEALTH_STYLE, fmtDate } from '@/lib/compliance'

const TABS = [
  { value: 'certification', label: 'Certifications' },
  { value: 'dqf', label: 'Driver files (DQF)' },
  { value: 'personnel', label: 'Personnel files' },
]

/** Spreadsheet-style grid: one row per employee, one column per requirement — the old Smartsheet at a glance. */
export default async function MatrixPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const sp = await searchParams
  const cat = TABS.some(t => t.value === sp.cat) ? sp.cat! : 'certification'
  const me = await requireCompliance()
  const { files } = await loadFiles(createAdminClient(), me.company_id)
  // Only people who have (or must have) something in this category.
  const rowsFor = files.filter(f => (cat !== 'dqf' || f.employee.is_dot_driver) && f.rows.some(r => r.type.category === cat && (r.item || r.required)))
  // Only the columns somebody actually has (or is required to have).
  const colMap = new Map<string, { id: string; name: string; sort: number }>()
  for (const f of rowsFor) for (const r of f.rows) if (r.type.category === cat && (r.item || r.required)) colMap.set(r.type.id, { id: r.type.id, name: r.type.name, sort: r.type.sort_order })
  const cols = [...colMap.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <Link href="/compliance" className="text-sm text-gray-500 hover:text-gray-700">← DQF &amp; Certifications</Link>
      <h1 className="rp-title mt-2 mb-4">Matrix</h1>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {TABS.map(t => (
          <Link key={t.value} href={`/compliance/matrix?cat=${t.value}`}
            className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${cat === t.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-gray-600 border-gray-200 hover:border-blue-300'}`}>{t.label}</Link>
        ))}
        <span className="ml-auto flex flex-wrap gap-3 text-[11px] text-gray-500">
          {(['expired', 'due_soon', 'ok', 'no_date', 'missing'] as const).map(h => (
            <span key={h} className="inline-flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${HEALTH_STYLE[h].dot}`} />{HEALTH_STYLE[h].label}</span>
          ))}
        </span>
      </div>
      <div className="rp-card overflow-auto max-h-[75vh]">
        <table className="text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-gray-50 text-left px-3 py-2 font-semibold text-gray-600 border-b border-r border-gray-200 min-w-44">Employee</th>
              {cols.map(c => (
                <th key={c.id} className="sticky top-0 z-10 bg-gray-50 px-1 py-2 border-b border-gray-200 align-bottom">
                  <div className="w-20 text-[10px] font-semibold text-gray-600 leading-tight break-words">{c.name.replace(/ Certification$/, '')}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsFor.map(f => {
              const byType = new Map(f.rows.map(r => [r.type.id, r]))
              return (
                <tr key={f.employee.id}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 border-b border-r border-gray-100 font-medium text-gray-900 whitespace-nowrap">
                    <Link href={`/compliance/employees/${f.employee.id}`} className="hover:text-blue-700">{f.employee.full_name}</Link>
                  </td>
                  {cols.map(c => {
                    const r = byType.get(c.id)
                    if (!r || (!r.item && !r.required)) return <td key={c.id} className="border-b border-gray-50" />
                    const s = HEALTH_STYLE[r.health]
                    return (
                      <td key={c.id} className="border-b border-gray-50 p-0.5" title={`${c.name}: ${s.label}${r.exp ? ` · ${fmtDate(r.exp)}` : ''}`}>
                        <Link href={`/compliance/employees/${f.employee.id}`} className={`block w-20 rounded px-1 py-1 text-center tabular-nums border ${s.cls}`}>
                          {r.exp ? fmtDate(r.exp) : r.health === 'missing' ? '—' : '✓'}
                        </Link>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
