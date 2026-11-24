import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { SubcontractorForm } from '@/components/construction/subcontractor-form'
import { saveSubcontractor } from '../actions'
import { HardHat, Plus } from 'lucide-react'

const th = 'text-left px-4 py-3 font-medium text-gray-500'

export default async function SubcontractorsPage() {
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()
  const { data: subs } = await admin.from('con_subcontractors').select('*')
    .eq('company_id', company_id).order('name')
  const list = subs ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Subcontractors
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{list.length} subcontractor{list.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
      </div>

      <div className="rp-card overflow-hidden mb-5">
        {list.length === 0 ? (
          <div className="p-12 text-center">
            <HardHat className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No subcontractors yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={th}>Name</th>
                  <th className={`${th} hidden sm:table-cell`}>Trade</th>
                  <th className={`${th} hidden md:table-cell`}>Contact</th>
                  <th className={`${th} hidden md:table-cell`}>Phone</th>
                  <th className={th}>Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map(s => (
                  <ClickableRow key={s.id} href={`/construction/subcontractors/${s.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{s.name}</span>
                      {s.email && <div className="text-xs text-gray-400">{s.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{s.trade ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{s.contact_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{s.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      {s.is_active
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">Active</span>
                        : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">Inactive</span>}
                    </td>
                    <td className="px-4 py-3 text-right"><span className="text-xs font-medium text-blue-600">Edit →</span></td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canWrite && (
        <details className="rp-card">
          <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />Add Subcontractor</summary>
          <div className="px-5 pb-5">
            <SubcontractorForm action={saveSubcontractor.bind(null, null)} />
          </div>
        </details>
      )}
    </div>
  )
}
