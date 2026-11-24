'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AssignControl } from '@/components/tickets/assign-control'

type Item = {
  id: string
  title: string
  unitNumber: string
  status: string
  assignedId: string | null
  assignedName: string | null
  category: 'property' | 'equipment'
}
type Employee = { id: string; full_name: string }

export function MiscTasksCard({
  items,
  employees,
  canAssign,
}: {
  items: Item[]
  employees: Employee[]
  canAssign: boolean
}) {
  // '' = everyone, 'unassigned', or a profile id
  const [assignee, setAssignee] = useState('')

  const match = (it: Item) =>
    assignee === '' ||
    (assignee === 'unassigned' ? !it.assignedId : it.assignedId === assignee)

  const property = items.filter((it) => it.category === 'property' && match(it))
  const equipment = items.filter((it) => it.category === 'equipment' && match(it))

  function renderBox(title: string, tint: string, list: Item[]) {
    return (
      <div className="rp-card overflow-hidden">
        <div className={`px-3 py-2 border-b flex items-center justify-between ${tint}`}>
          <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
          <span className="text-xs font-bold opacity-70">{list.length}</span>
        </div>
        {list.length === 0 ? (
          <p className="px-3 py-3 text-xs text-gray-400">Nothing here.</p>
        ) : (
          <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
            {list.map((it) => (
              <div key={it.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <Link href={`/tickets/${it.id}`} className="font-semibold text-gray-900 hover:text-blue-600 shrink-0">
                  {it.unitNumber}
                </Link>
                <Link href={`/tickets/${it.id}`} className="text-gray-600 truncate flex-1 min-w-0 hover:text-blue-600">
                  {it.title}
                </Link>
                <div className="shrink-0 text-right">
                  {canAssign ? (
                    <AssignControl ticketId={it.id} currentId={it.assignedId} currentName={it.assignedName} employees={employees} />
                  ) : (
                    <span className="text-gray-500">{it.assignedName ?? 'Unassigned'}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold text-gray-900 before:content-[''] before:w-1.5 before:h-5 before:rounded-full before:bg-gradient-to-b before:from-blue-500 before:to-blue-700 before:shrink-0">Misc Tasks</h2>
          <span className="text-xs text-gray-400">{property.length + equipment.length} shown</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Assigned:</span>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="text-xs border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderBox('🏢 Property', 'bg-gradient-to-r from-indigo-50 to-blue-50 border-indigo-100 text-indigo-700', property)}
        {renderBox('🔧 Equipment', 'bg-gradient-to-r from-amber-50 to-orange-50 border-amber-100 text-amber-700', equipment)}
      </div>
    </section>
  )
}
