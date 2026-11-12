import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireCompliance } from '@/lib/compliance-guard'
import { EmployeeForm } from '@/components/compliance/employee-form'
import { createEmployee } from '../../actions'

export default async function NewEmployeePage() {
  const me = await requireCompliance()
  if (!me.canWrite) redirect('/compliance')
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link href="/compliance" className="text-sm text-gray-500 hover:text-gray-700">← DQF &amp; Certifications</Link>
      <h1 className="rp-title mt-2 mb-1">Add employee</h1>
      <p className="text-sm text-gray-500 mb-5">Tick “DOT driver” and the full Driver Qualification File checklist is added automatically. Certifications are added from their file page.</p>
      <div className="rp-card p-5">
        <EmployeeForm action={createEmployee} submitLabel="Add employee" />
      </div>
    </div>
  )
}
