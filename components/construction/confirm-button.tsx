'use client'

import { useTransition } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Runs a bound server action with no confirm dialog — for the "I've reviewed
 * this and it's correct" click on a backfilled draft (con_daily_updates
 * review_status: needs_review -> filed). Mirrors DeleteButton's shape.
 */
export function ConfirmButton({
  action,
  label = 'Confirm',
  className,
}: {
  action: () => Promise<void>
  label?: string
  className?: string
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <button
      type="button"
      data-no-row-nav
      disabled={isPending}
      onClick={() => startTransition(() => { action() })}
      className={cn(
        'inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-50',
        className,
      )}
    >
      <CheckCircle2 className="w-3.5 h-3.5" />
      {isPending ? 'Confirming…' : label}
    </button>
  )
}
