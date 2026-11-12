import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { Button } from '@/components/ui/button'
import { SiteForm } from '@/components/construction/site-form'
import { saveSite } from '../../actions'
import { Pencil, MapPin } from 'lucide-react'

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: customer } = await admin
    .from('con_customers').select('*').eq('id', id).eq('company_id', company_id).single()
  if (!customer) notFound()

  const [{ data: sites }, { data: jobs }] = await Promise.all([
    admin.from('con_sites').select('*').eq('customer_id', id).eq('company_id', company_id).order('site_number'),
    admin.from('con_jobs').select('id, site_number, stage, work_order_number').eq('customer_id', id).eq('company_id', company_id).order('created_at', { ascending: false }).limit(10),
  ])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href="/construction/customers" className="text-sm text-gray-500 hover:text-gray-700">← Back to Customers</Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="rp-title">{customer.name}</h1>
            <div className="text-sm text-gray-500 mt-1 space-y-0.5">
              {customer.billing_contact && <div>Contact: {customer.billing_contact}</div>}
              {customer.email && <div>{customer.email}</div>}
              {customer.phone && <div>{customer.phone}</div>}
              {customer.billing_address && <div className="whitespace-pre-line">{customer.billing_address}</div>}
            </div>
          </div>
          {canWrite && (
            <Link href={`/construction/customers/${id}/edit`}>
              <Button variant="outline" className="gap-2"><Pencil className="w-3.5 h-3.5" />Edit</Button>
            </Link>
          )}
        </div>
        {customer.notes && <p className="text-sm text-gray-600 mt-3 bg-gray-50 rounded-lg p-3">{customer.notes}</p>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sites */}
        <div className="rp-card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-gray-400" />
            <h2 className="font-semibold text-gray-900">Sites</h2>
            <span className="text-xs text-gray-400">({sites?.length ?? 0})</span>
          </div>
          {!sites?.length ? (
            <p className="px-4 py-6 text-sm text-gray-400">No sites yet.</p>
          ) : (
            <table className="rp-table w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {sites.map(s => (
                  <ClickableRow key={s.id} href={`/construction/customers/${id}/sites/${s.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{s.site_number}</span>
                      {s.store_brand && <span className="ml-2 text-xs text-gray-400">{s.store_brand}</span>}
                      {(s.city || s.state) && <div className="text-xs text-gray-400">{[s.city, s.state].filter(Boolean).join(', ')}</div>}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">
                      {[
                        s.dispenser_count ? `${s.dispenser_count} disp.` : '',
                        s.tank_count ? `${s.tank_count} tank` : '',
                        s.stp_count ? `${s.stp_count} STP` : '',
                        (s.fill_spill_bucket_count || s.vapor_bucket_count)
                          ? `${(s.fill_spill_bucket_count ?? 0) + (s.vapor_bucket_count ?? 0)} buckets` : '',
                      ].filter(Boolean).join(' · ')}
                      {canWrite && <span className="ml-2 text-blue-600">Edit →</span>}
                    </td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          )}

          {canWrite && (
            <details className="border-t border-gray-100">
              <summary className="px-4 py-3 text-sm font-medium text-blue-600 cursor-pointer hover:bg-gray-50">+ Add a site</summary>
              <div className="px-4 py-4 bg-gray-50">
                <SiteForm
                  action={saveSite.bind(null, null)}
                  customers={[]}
                  fixedCustomerId={id}
                  redirectTo={`/construction/customers/${id}`}
                />
              </div>
            </details>
          )}
        </div>

        {/* Recent jobs */}
        <div className="rp-card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Jobs</h2>
          </div>
          {!jobs?.length ? (
            <p className="px-4 py-6 text-sm text-gray-400">No jobs for this customer yet.</p>
          ) : (
            <table className="rp-table w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {jobs.map(j => (
                  <ClickableRow key={j.id} href={`/construction/jobs/${j.id}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{j.site_number ?? '—'}</span>
                      {j.work_order_number && <span className="ml-2 text-xs text-gray-400">{j.work_order_number}</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500 capitalize">{j.stage?.replace(/_/g, ' ')}</td>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
