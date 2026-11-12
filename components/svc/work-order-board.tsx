'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GripVertical } from 'lucide-react'
import { PriorityBadge, StaleBadge, ConstructionBadge, clientLabel, STATUS_CONFIG } from './work-order-badges'
import type { ConstructionTag } from '@/lib/con-stage'

type WorkOrder = {
  id: string
  status: string
  site_number: string | null
  priority_raw: string | null
  priority_rank: number | null
  source_portal: string
  client_name: string | null
  portal_wo_number: string | null
  last_update_at: string | null
  return_trip_needed: boolean
  invoice_rejected: boolean
  svc_technicians?: { full_name: string }[] | null
  construction?: ConstructionTag | null
}

const STORAGE_KEY = 'svc-board-column-order'

/** Restore a saved column order, keeping only statuses that still exist and
 * appending any new ones (e.g. after a status list change) at the end. */
function loadOrder(defaultOrder: string[]): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!Array.isArray(saved)) return defaultOrder
    const known = new Set(defaultOrder)
    const kept = saved.filter((v): v is string => typeof v === 'string' && known.has(v))
    const missing = defaultOrder.filter(v => !kept.includes(v))
    return [...kept, ...missing]
  } catch {
    return defaultOrder
  }
}

export function WorkOrderBoard({ workOrders, statuses }: { workOrders: WorkOrder[]; statuses: string[] }) {
  const [order, setOrder] = useState<string[]>(statuses)
  const [dragging, setDragging] = useState<string | null>(null)

  // Only touches localStorage after mount, so the server-rendered default
  // order is what shows up first (and still works if storage is blocked).
  useEffect(() => { setOrder(loadOrder(statuses)) }, [statuses])

  function persist(next: string[]) {
    setOrder(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  function onDrop(target: string) {
    if (!dragging || dragging === target) { setDragging(null); return }
    const next = [...order]
    const from = next.indexOf(dragging)
    const to = next.indexOf(target)
    if (from === -1 || to === -1) { setDragging(null); return }
    next.splice(from, 1)
    next.splice(to, 0, dragging)
    persist(next)
    setDragging(null)
  }

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-max">
        {order.map(st => {
          const col = workOrders.filter(w => w.status === st)
          const cfg = STATUS_CONFIG[st] ?? STATUS_CONFIG.new
          return (
            <div
              key={st}
              className={`w-64 shrink-0 rounded-xl ${dragging === st ? 'opacity-40' : ''}`}
              draggable
              onDragStart={() => setDragging(st)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => onDrop(st)}
              onDragEnd={() => setDragging(null)}
            >
              <div className="flex items-center justify-between mb-2 px-1 cursor-grab active:cursor-grabbing select-none" title="Drag to reorder">
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.className}`}>
                  <GripVertical className="w-3 h-3 opacity-50" />{cfg.label}
                </span>
                <span className="text-xs text-gray-400">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map(w => (
                  <Link key={w.id} href={`/service/${w.id}`} className="rp-card rp-card-link block p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-gray-900">{w.site_number ?? '—'}</span>
                      <PriorityBadge priorityRaw={w.priority_raw} priorityRank={w.priority_rank} />
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{clientLabel(w.source_portal, w.client_name)}</div>
                    {w.portal_wo_number && <div className="text-xs text-gray-400 mt-0.5 font-mono">{w.portal_wo_number}</div>}
                    <div className="flex items-center justify-between mt-1.5 gap-2">
                      <span className="text-xs text-gray-500 truncate">{w.svc_technicians?.[0]?.full_name ?? 'Unassigned'}</span>
                      <StaleBadge lastUpdateAt={w.last_update_at} status={w.status} />
                    </div>
                    {w.construction && <div className="mt-1.5"><ConstructionBadge link={w.construction} /></div>}
                    {w.return_trip_needed && <div className="text-xs text-red-600 font-semibold mt-1">⟲ Return trip needed</div>}
                    {w.invoice_rejected && <div className="text-xs text-amber-700 font-medium mt-1">Invoice Rejected</div>}
                  </Link>
                ))}
                {col.length === 0 && <div className="text-xs text-gray-300 px-1 py-2">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
