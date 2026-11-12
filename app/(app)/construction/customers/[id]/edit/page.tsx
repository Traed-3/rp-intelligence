import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { CustomerForm } from '@/components/construction/customer-form'
import { DeleteButton } from '@/components/construction/delete-button'
import { saveCustomer, deleteCustomer } from '../../../actions'

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireConstruction()
  if (!canWrite) redirect(`/construction/customers/${id}`)
  const admin = createAdminClient()

  const { data: customer } = await admin
    .from('con_customers').select('*').eq('id', id).eq('company_id', company_id).single()
  if (!customer) notFound()

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href={`/construction/customers/${id}`} className="text-sm text-gray-500 hover:text-gray-700">← Back to Customer</Link>
        <h1 className="rp-title mt-2">Edit Customer</h1>
      </div>
      <div className="rp-card p-6">
        <CustomerForm action={saveCustomer.bind(null, id)} customer={customer} />
      </div>
      <div className="mt-4 flex justify-end">
        <DeleteButton
          action={deleteCustomer.bind(null, id)}
          confirm="Delete this customer? Their sites will be kept but unlinked."
          label="Delete Customer"
        />
      </div>
    </div>
  )
}
