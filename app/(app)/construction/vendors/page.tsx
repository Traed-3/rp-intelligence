import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { VendorForm } from '@/components/construction/vendor-form'
import { saveVendor } from '../actions'
import { Truck, Plus } from 'lucide-react'

const th = 'text-left px-4 py-3 font-medium text-gray-500'

export default async function VendorsPage() {
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()
  const { data: vendors } = await admin.from('con_vendors').select('*')
    .eq('company_id', company_id).order('name')
  const list = vendors ?? []

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Vendors
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{list.length} vendor{list.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/construction/materials" className="text-sm text-gray-500 hover:text-gray-700">Materials</Link>
          <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
        </div>
      </div>

      <div className="rp-card overflow-hidden mb-5">
        {list.length === 0 ? (
          <div className="p-12 text-center">
            <Truck className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No vendors yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className={th}>Vendor</th>
                  <th className={`${th} hidden sm:table-cell`}>Supplies</th>
                  <th className={`${th} hidden md:table-cell`}>Contact</th>
                  <th className={`${th} hidden md:table-cell`}>Phone</th>
                  <th className={th}>Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map(v => (
                  <ClickableRow key={v.id} href={`/construction/vendors/${v.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{v.name}</span>
                      {v.account_number && <div className="text-xs text-gray-400">Acct {v.account_number}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{v.category ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{v.contact_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{v.phone ?? '—'}</td>
                    <td className="px-4 py-3">
                      {v.is_active
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
          <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-blue-600" />Add Vendor</summary>
          <div className="px-5 pb-5">
            <VendorForm action={saveVendor.bind(null, null)} />
          </div>
        </details>
      )}
    </div>
  )
}
