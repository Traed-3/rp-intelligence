import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireConstruction } from '@/lib/construction-guard'
import { CustomerForm } from '@/components/construction/customer-form'
import { saveCustomer } from '../../actions'

export default async function NewCustomerPage() {
  const { canWrite } = await requireConstruction()
  if (!canWrite) redirect('/construction/customers')

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/construction/customers" className="text-sm text-gray-500 hover:text-gray-700">← Back to Customers</Link>
        <h1 className="rp-title mt-2">New Customer</h1>
      </div>
      <div className="rp-card p-6">
        <CustomerForm action={saveCustomer.bind(null, null)} />
      </div>
    </div>
  )
}
