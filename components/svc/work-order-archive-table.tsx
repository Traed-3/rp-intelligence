'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, X } from 'lucide-react'
import { ClickableRow } from '@/components/clickable-row'
import { WorkOrderStatusBadge, PriorityBadge, StaleBadge, ConstructionBadge, clientLabel } from '@/components/svc/work-order-badges'
import type { ConstructionTag } from '@/lib/con-stage'
import { ARCHIVE_REASON_PRESETS } from '@/lib/svc-archive-reasons'
import { archiveWorkOrders, unarchiveWorkOrder } from '@/app/(app)/service/actions'

type WorkOrder = {
  id: string
  source_portal: string
  client_name: string | null
  portal_wo_number: string | null
  site_number: string | null
  site_name: string | null
  priority_raw: string | null
  priority_rank: number | null
  status: string
  last_update_at: string | null
  return_trip_needed: boolean
  invoice_rejected: boolean
  archived: boolean
  archived_at: string | null
  archived_reason: string | null
  svc_technicians?: { full_name: string }[] | null
  construction?: ConstructionTag | null
}

/** `mixed` = search results: active and archived calls side by side, so archived-ness is decided per row. */
export function WorkOrderArchiveTable({ workOrders, showArchived, mixed = false }: { workOrders: WorkOrder[]; showArchived: boolean; mixed?: boolean }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [modalIds, setModalIds] = useState<string[] | null>(null)
  const [isPending, startTransition] = useTransition()

  const allSelected = workOrders.length > 0 && selected.size === workOrders.length

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(workOrders.map(w => w.id)))
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleUnarchive(id: string) {
    startTransition(async () => {
      await unarchiveWorkOrder(id)
      router.refresh()
    })
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-foreground text-background rounded-xl px-4 py-2.5 mb-3 shadow-lg">
          <p className="text-sm font-medium">{selected.size} selected</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-gray-300 hover:text-white px-2 py-1"
            >
              Clear
            </button>
            <button
              onClick={() => setModalIds(Array.from(selected))}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-card text-gray-900 rounded-lg px-3 py-1.5 hover:bg-gray-100"
            >
              <Archive className="w-3.5 h-3.5" /> Archive Selected
            </button>
          </div>
        </div>
      )}

      {!workOrders.length ? (
        <div className="rp-card p-12 text-center">
          <p className="text-gray-400 text-sm">No work orders match this view.</p>
        </div>
      ) : (
        <div className="rp-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-gray-300"
                      aria-label="Select all"
                    />
                  </th>
                  <th className="text-left px-4 py-3 w-28">WO #</th>
                  <th className="text-left px-4 py-3">Site</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Client</th>
                  <th className="text-left px-4 py-3 hidden sm:table-cell">Priority</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Tech</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">
                    {mixed ? 'Last Update / Archived' : showArchived ? 'Archived' : 'Last Update'}
                  </th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {workOrders.map((w) => {
                  const rowArchived = showArchived || (mixed && w.archived)
                  return (
                  <ClickableRow key={w.id} href={`/service/${w.id}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(w.id)}
                        onChange={() => toggleOne(w.id)}
                        className="rounded border-gray-300"
                        aria-label={`Select ${w.portal_wo_number}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{w.portal_wo_number}</td>
                    <td className="px-4 py-3">
                      <Link href={`/service/${w.id}`} className="font-medium text-gray-900 hover:text-blue-600">
                        {w.site_number ?? '—'}
                      </Link>
                      {w.site_name && <div className="text-xs text-gray-400">{w.site_name}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">
                      {clientLabel(w.source_portal, w.client_name)}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <PriorityBadge priorityRaw={w.priority_raw} priorityRank={w.priority_rank} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <WorkOrderStatusBadge status={w.status} />
                        {mixed && rowArchived && <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">Archived</span>}
                        {!rowArchived && <StaleBadge lastUpdateAt={w.last_update_at} status={w.status} />}
                        {w.invoice_rejected && (
                          <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Invoice Rejected</span>
                        )}
                        {w.construction && (
                          <Link href={`/construction/jobs/${w.construction.jobId}`}><ConstructionBadge link={w.construction} /></Link>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 hidden lg:table-cell text-xs">
                      {w.svc_technicians?.[0]?.full_name ?? <span className="text-gray-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden lg:table-cell">
                      {rowArchived ? (
                        <>
                          {w.archived_at
                            ? new Date(w.archived_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : '—'}
                          {w.archived_reason && <div className="text-gray-500 mt-0.5">{w.archived_reason}</div>}
                        </>
                      ) : (
                        w.last_update_at
                          ? new Date(w.last_update_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {rowArchived ? (
                        <button
                          onClick={() => handleUnarchive(w.id)}
                          disabled={isPending}
                          title="Unarchive"
                          className="text-gray-400 hover:text-blue-600 disabled:opacity-50"
                        >
                          <ArchiveRestore className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setModalIds([w.id])}
                          title="Archive"
                          className="text-gray-400 hover:text-red-600"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </ClickableRow>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalIds && (
        <ArchiveReasonModal
          count={modalIds.length}
          isPending={isPending}
          onCancel={() => setModalIds(null)}
          onConfirm={(reason) => {
            startTransition(async () => {
              const result = await archiveWorkOrders(modalIds, reason)
              setModalIds(null)
              setSelected(new Set())
              router.refresh()
              if (result.error) alert(result.error)
            })
          }}
        />
      )}
    </>
  )
}

function ArchiveReasonModal({
  count,
  isPending,
  onCancel,
  onConfirm,
}: {
  count: number
  isPending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [preset, setPreset] = useState<string>(ARCHIVE_REASON_PRESETS[0])
  const [other, setOther] = useState('')
  const isOther = preset === 'Other'
  const reason = isOther ? other.trim() : preset
  const canConfirm = reason.length > 0 && !isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">
            Archive {count} work order{count !== 1 ? 's' : ''}
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          {count > 1
            ? 'This reason will be applied to all selected work orders.'
            : 'The source dispatch email in rpdispatcher will be archived too.'}
        </p>

        <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
        <select
          value={preset}
          onChange={e => setPreset(e.target.value)}
          className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {ARCHIVE_REASON_PRESETS.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {isOther && (
          <textarea
            value={other}
            onChange={e => setOther(e.target.value)}
            placeholder="Describe the reason…"
            rows={2}
            autoFocus
            className="w-full text-sm border border-gray-300 rounded-lg px-2.5 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        )}

        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={onCancel}
            className="text-sm font-medium text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => canConfirm && onConfirm(reason)}
            disabled={!canConfirm}
            className="text-sm font-semibold text-white bg-red-600 hover:bg-red-600/90 disabled:opacity-50 rounded-lg px-3.5 py-1.5"
          >
            {isPending ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  )
}
