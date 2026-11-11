import { cn } from '@/lib/utils'
import { ChangeFlash } from '@/components/ui/change-flash'
import {
  stageMeta, priorityMeta, statusMeta,
  QUOTE_STATUSES, INVOICE_STATUSES, MATERIAL_STATUSES,
} from '@/lib/construction'

const base = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border'

export function StageBadge({ stage }: { stage: string }) {
  const c = stageMeta(stage)
  return <ChangeFlash value={stage}><span className={cn(base, c.className)}>{c.label}</span></ChangeFlash>
}

export function ConPriorityBadge({ priority }: { priority: string }) {
  const c = priorityMeta(priority)
  return <span className={cn(base, c.className)}>{c.label}</span>
}

export function QuoteStatusBadge({ status }: { status: string }) {
  const c = statusMeta(QUOTE_STATUSES, status)
  return <ChangeFlash value={status}><span className={cn(base, c.className)}>{c.label}</span></ChangeFlash>
}

export function InvoiceStatusBadge({ status }: { status: string }) {
  const c = statusMeta(INVOICE_STATUSES, status)
  return <ChangeFlash value={status}><span className={cn(base, c.className)}>{c.label}</span></ChangeFlash>
}

export function MaterialStatusBadge({ status }: { status: string }) {
  const c = statusMeta(MATERIAL_STATUSES, status)
  return <ChangeFlash value={status}><span className={cn(base, c.className)}>{c.label}</span></ChangeFlash>
}
