import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { VendorForm, type VendorRecord } from '@/components/construction/vendor-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveVendor, deleteVendor } from '../../actions'

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  const admin = createAdminClient()

  const { data: vendor } = await admin.from('con_vendors').select('*')
    .eq('id', id).eq('company_id', company_id).single()
  if (!vendor) notFound()

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-5">
        <Link href="/construction/vendors" className="text-sm text-gray-500 hover:text-gray-700">← Vendors</Link>
        <h1 className="rp-title mt-2">{vendor.name}</h1>
      </div>

      <div className="rp-card p-5 mb-5">
        <VendorForm action={saveVendor.bind(null, id)} vendor={vendor as VendorRecord} />
      </div>

      {canWrite && (
        <DeleteButton action={deleteVendor.bind(null, id)} confirm={`Delete ${vendor.name}?`} label="Delete vendor" />
      )}
    </div>
  )
}
