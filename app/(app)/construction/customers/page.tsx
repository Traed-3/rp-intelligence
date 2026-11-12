import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { Button } from '@/components/ui/button'
import { Plus, Building2 } from 'lucide-react'

export default async function CustomersPage() {
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: customers } = await admin
    .from('con_customers')
    .select('id, name, billing_contact, phone, email, con_sites(count)')
    .eq('company_id', company_id)
    .order('name')

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="rp-title">
            Customers
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{customers?.length ?? 0} customer{customers?.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
          {canWrite && (
            <Link href="/construction/customers/new"><Button className="gap-2"><Plus className="w-4 h-4" />New Customer</Button></Link>
          )}
        </div>
      </div>

      {!customers?.length ? (
        <div className="rp-card p-12 text-center">
          <Building2 className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No customers yet.</p>
          {canWrite && (
            <Link href="/construction/customers/new" className="mt-4 inline-block">
              <Button className="gap-2"><Plus className="w-4 h-4" />New Customer</Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="rp-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Contact</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Phone</th>
                  <th className="text-left px-4 py-3">Sites</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map((c) => {
                  const siteCount = (c as any).con_sites?.[0]?.count ?? 0
                  return (
                    <ClickableRow key={c.id} href={`/construction/customers/${c.id}`}>
                      <td className="px-4 py-3">
                        <Link href={`/construction/customers/${c.id}`} className="font-medium text-gray-900 hover:text-blue-600">{c.name}</Link>
                        {c.email && <div className="text-xs text-gray-400">{c.email}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{c.billing_contact ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{c.phone ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{siteCount}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs font-medium text-blue-600">View →</span>
                      </td>
                    </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
