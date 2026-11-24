import Link from 'next/link'
import { ClickableRow } from '@/components/clickable-row'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

export default async function ShopEmployeesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles').select('company_id, role').eq('id', user!.id).single()

  if (!['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')) {
    return <div className="p-6 text-gray-500">Access restricted.</div>
  }

  const { data: employees } = await admin
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .eq('company_id', profile!.company_id)
    .in('role', ['shop_employee', 'shop_manager', 'mechanic', 'service_tech', 'construction_tech'])
    .order('full_name')

  const empIds = (employees ?? []).map(e => e.id)

  const { data: statuses } = await admin
    .from('employee_statuses')
    .select('profile_id, clock_status, current_status')
    .in('profile_id', empIds)

  const statusMap = Object.fromEntries((statuses ?? []).map(s => [s.profile_id, s]))

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/shop" className="text-sm text-gray-500 hover:text-gray-700">← Shop</Link>
        <span className="text-gray-300">/</span>
        <h1 className="rp-title">Shop Employees</h1>
      </div>

      <div className="rp-card overflow-hidden">
        <table className="rp-table w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3 hidden sm:table-cell">Role</th>
              <th className="text-left px-4 py-3">Clock Status</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Current Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(employees ?? []).map((emp) => {
              const s = statusMap[emp.id]
              return (
                <ClickableRow key={emp.id} href={`/shop/employees/${emp.id}`}>
                  <td className="px-4 py-3">
                    <Link href={`/shop/employees/${emp.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                      {emp.full_name}
                    </Link>
                    <p className="text-xs text-gray-400">{emp.email}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize hidden sm:table-cell">
                    {emp.role.replace('_', ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full border',
                      s?.clock_status === 'clocked_in'
                        ? 'bg-green-100 text-green-800 border-green-200'
                        : 'bg-gray-100 text-gray-500 border-gray-200'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', s?.clock_status === 'clocked_in' ? 'bg-green-500' : 'bg-gray-400')} />
                      {s?.clock_status === 'clocked_in' ? 'Clocked In' : 'Clocked Out'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-sm hidden md:table-cell capitalize">
                    {s?.current_status?.replace(/_/g, ' ') ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/shop/employees/${emp.id}`} className="text-xs font-medium text-blue-600 hover:text-blue-800">View →</Link>
                  </td>
                </ClickableRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
