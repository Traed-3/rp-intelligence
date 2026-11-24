import { cn } from '@/lib/utils'
import { ChangeFlash } from '@/components/ui/change-flash'

// ── Status ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  new:               { label: 'New',               className: 'bg-gray-100 text-gray-700 border-gray-200' },
  open:              { label: 'Open',              className: 'bg-blue-100 text-blue-800 border-blue-200' },
  needs_review:      { label: 'Needs Review',      className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  assigned:          { label: 'Assigned',          className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  in_progress:       { label: 'In Progress',       className: 'bg-green-100 text-green-800 border-green-200' },
  paused:            { label: 'Paused',            className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  waiting_parts:     { label: 'Waiting on Parts',  className: 'bg-orange-100 text-orange-800 border-orange-200' },
  waiting_approval:  { label: 'Waiting Approval',  className: 'bg-purple-100 text-purple-800 border-purple-200' },
  scheduled:         { label: 'Scheduled',         className: 'bg-blue-100 text-blue-800 border-blue-200' },
  completed:         { label: 'Completed',         className: 'bg-green-200 text-green-900 border-green-300' },
  // 'closed' is treated as the same thing as 'completed' (legacy/leftover rows) — show it identically
  closed:            { label: 'Completed',         className: 'bg-green-200 text-green-900 border-green-300' },
  deferred:          { label: 'Deferred',          className: 'bg-gray-100 text-gray-500 border-gray-200' },
  unsafe_do_not_use: { label: '⚠ Unsafe – Do Not Use', className: 'bg-red-200 text-red-900 border-red-300' },
}

export function TicketStatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.new
  return (
    <ChangeFlash value={status}>
      <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', c.className)}>
        {c.label}
      </span>
    </ChangeFlash>
  )
}

// ── Priority ──────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  low:      { label: 'Low',       className: 'bg-gray-100 text-gray-500 border-gray-200' },
  normal:   { label: 'Normal',    className: 'bg-blue-100 text-blue-700 border-blue-200' },
  high:     { label: 'High',      className: 'bg-orange-100 text-orange-800 border-orange-200' },
  critical: { label: 'Critical',  className: 'bg-red-100 text-red-800 border-red-200' },
  safety:   { label: '⚠ Safety',  className: 'bg-red-200 text-red-900 border-red-300' },
}

export function PriorityBadge({ priority }: { priority: string }) {
  const c = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.normal
  return (
    <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border', c.className)}>
      {c.label}
    </span>
  )
}

// ── Status transition map ─────────────────────────────────────────────────────

export const STATUS_ACTIONS: Record<string, Array<{ label: string; nextStatus: string; style?: string }>> = {
  new:               [{ label: 'Mark Open', nextStatus: 'open' }],
  open:              [{ label: 'Start Work', nextStatus: 'in_progress', style: 'primary' }],
  needs_review:      [{ label: 'Open', nextStatus: 'open' }],
  assigned:          [{ label: 'Start Work', nextStatus: 'in_progress', style: 'primary' }],
  in_progress:       [
    { label: 'Pause',            nextStatus: 'paused' },
    { label: 'Waiting on Parts', nextStatus: 'waiting_parts' },
    { label: 'Mark Complete',    nextStatus: 'completed', style: 'primary' },
  ],
  paused:            [
    { label: 'Resume',        nextStatus: 'in_progress', style: 'primary' },
    { label: 'Mark Complete', nextStatus: 'completed' },
  ],
  waiting_parts:     [
    { label: 'Parts Arrived', nextStatus: 'in_progress', style: 'primary' },
    { label: 'Mark Complete', nextStatus: 'completed' },
  ],
  waiting_approval:  [{ label: 'Approve & Resume', nextStatus: 'in_progress', style: 'primary' }],
  scheduled:         [{ label: 'Start Work', nextStatus: 'in_progress', style: 'primary' }],
  completed:         [{ label: 'Reopen', nextStatus: 'open' }],
  closed:            [{ label: 'Reopen', nextStatus: 'open' }],
  deferred:          [{ label: 'Reopen', nextStatus: 'open' }],
  unsafe_do_not_use: [{ label: 'Begin Repair', nextStatus: 'in_progress', style: 'primary' }],
}
