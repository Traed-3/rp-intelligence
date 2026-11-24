import { cn } from '@/lib/utils'
import { ChangeFlash } from '@/components/ui/change-flash'
import { CON_DONE_STAGES, CON_STAGE_LABEL, type ConstructionTag } from '@/lib/con-stage'

// ── Status ────────────────────────────────────────────────────────────────────

// RPS is under service contract with Sunoco, 7-Eleven and Wawa, so every work
// order is accepted the moment it is dispatched — there is no New / Accepted /
// En Route step to track. Those three are kept only as aliases so any historical
// row still renders; they are not board columns and nothing writes them.
export const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  dispatched:    { label: 'Dispatched',        className: 'bg-blue-100 text-blue-800 border-blue-200' },
  new:           { label: 'Dispatched',        className: 'bg-blue-100 text-blue-800 border-blue-200' },
  accepted:      { label: 'Dispatched',        className: 'bg-blue-100 text-blue-800 border-blue-200' },
  en_route:      { label: 'On Site',           className: 'bg-blue-100 text-blue-800 border-blue-200' },
  on_site:       { label: 'On Site',           className: 'bg-blue-100 text-blue-800 border-blue-200' },
  in_progress:   { label: 'In Progress',       className: 'bg-green-100 text-green-800 border-green-200' },
  waiting_parts: { label: 'Waiting on Parts',  className: 'bg-orange-100 text-orange-800 border-orange-200' },
  rtn_needed:    { label: '⟲ Return Trip Needed', className: 'bg-red-100 text-red-800 border-red-200' },
  completed:     { label: 'Completed',         className: 'bg-green-200 text-green-900 border-green-300' },
  invoiced:      { label: 'Invoiced',          className: 'bg-purple-100 text-purple-800 border-purple-200' },
  paid:          { label: 'Paid',              className: 'bg-purple-200 text-purple-900 border-purple-300' },
}

export function WorkOrderStatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.dispatched
  return (
    <ChangeFlash value={status}>
      <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', c.className)}>
        {c.label}
      </span>
    </ChangeFlash>
  )
}

// ── Priority (ranked 1=most urgent .. 5+) ───────────────────────────────────────

const PRIORITY_CLASS: Record<number, string> = {
  1: 'bg-red-100 text-red-800 border-red-200',
  2: 'bg-orange-100 text-orange-800 border-orange-200',
  3: 'bg-amber-100 text-amber-800 border-amber-200',
  4: 'bg-blue-100 text-blue-700 border-blue-200',
}

export function PriorityBadge({ priorityRaw, priorityRank }: { priorityRaw: string | null; priorityRank: number | null }) {
  const cls = PRIORITY_CLASS[priorityRank ?? 0] ?? 'bg-gray-100 text-gray-500 border-gray-200'
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', cls)}>
      {priorityRaw ?? 'Unknown'}
    </span>
  )
}

// ── "No update in N days" — the exact thing Don Brown keeps flagging ───────────

export function StaleBadge({ lastUpdateAt, status }: { lastUpdateAt: string | null; status: string }) {
  if (!lastUpdateAt || ['completed', 'invoiced', 'paid'].includes(status)) return null
  const days = Math.floor((Date.now() - new Date(lastUpdateAt).getTime()) / (24 * 60 * 60 * 1000))
  if (days < 7) return null
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border bg-red-50 text-red-700 border-red-200">
      No update {days}d
    </span>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  '7help': '7-Eleven',
  wtsc: 'Wawa',
  it_service_desk: 'Sunoco',
}

export function clientLabel(sourcePortal: string, clientName: string | null): string {
  return clientName ?? SOURCE_LABEL[sourcePortal] ?? sourcePortal
}

// ── Handed to construction ───────────────────────────────────────────────────────

/** "🏗 32361-26 · Invoicing" — the call has become a construction job; green once the work is done. */
export function ConstructionBadge({ link }: { link: ConstructionTag }) {
  const done = (CON_DONE_STAGES as readonly string[]).includes(link.stage)
  return (
    <span
      title={`Construction job ${link.jobNumber ?? ''} — ${CON_STAGE_LABEL[link.stage] ?? link.stage}`}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border',
        done ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200',
      )}
    >
      🏗 {link.jobNumber ? `${link.jobNumber} · ` : ''}{CON_STAGE_LABEL[link.stage] ?? link.stage}
    </span>
  )
}
