'use client'

type Employee = { id: string; full_name: string }

export function EmployeeSelect({
  employees,
  currentValue,
  period,
}: {
  employees: Employee[]
  currentValue: string
  period: string
}) {
  return (
    <select
      className="px-3 py-1.5 text-xs border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card"
      value={currentValue}
      onChange={e => {
        const val = e.target.value
        window.location.href = `/reports/payroll?period=${period}${val ? `&employee=${val}` : ''}`
      }}
    >
      <option value="">All Employees</option>
      {employees.map(emp => (
        <option key={emp.id} value={emp.id}>{emp.full_name}</option>
      ))}
    </select>
  )
}
