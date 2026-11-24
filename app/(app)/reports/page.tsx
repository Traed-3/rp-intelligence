import Link from 'next/link'
import { BarChart3, Users, Clock, Wrench, Truck, ClipboardList } from 'lucide-react'

const REPORTS = [
  {
    href: '/reports/payroll',
    icon: Users,
    title: 'Payroll Hours',
    description: 'Daily and weekly hours per employee. Export to CSV for payroll processing.',
    color: 'text-blue-600 bg-blue-50 border-blue-100',
  },
  {
    href: '/time',
    icon: Clock,
    title: 'Time Entries',
    description: 'All clock-in/out records. Approve entries and review adjustments.',
    color: 'text-green-600 bg-green-50 border-green-100',
  },
  {
    href: '/maintenance',
    icon: Wrench,
    title: 'Maintenance',
    description: 'Overdue and upcoming maintenance across the entire fleet.',
    color: 'text-orange-600 bg-orange-50 border-orange-100',
  },
  {
    href: '/assets',
    icon: Truck,
    title: 'Assets',
    description: 'Full fleet list with status, mileage, and maintenance history.',
    color: 'text-purple-600 bg-purple-50 border-purple-100',
  },
  {
    href: '/tickets',
    icon: ClipboardList,
    title: 'Repair Tickets',
    description: 'All tickets filtered by status, priority, asset, or employee.',
    color: 'text-gray-600 bg-gray-50 border-gray-200',
  },
]

export default function ReportsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="rp-title">Reports</h1>
        <p className="text-sm text-gray-500 mt-0.5">Data and exports for RPS operations.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {REPORTS.map(r => (
          <Link
            key={r.href}
            href={r.href}
            className="rp-card rp-card-link p-5 flex items-start gap-4"
          >
            <div className={`p-2.5 rounded-lg border shrink-0 ${r.color}`}>
              <r.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">{r.title}</p>
              <p className="text-sm text-gray-500 mt-0.5 leading-relaxed">{r.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
