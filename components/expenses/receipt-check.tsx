'use client'

import { useOptimistic, useState, useTransition } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { setStatementChecked } from '@/app/(app)/expenses/receipts/actions'

/** The tick in front of a receipt: found on the bill or not. Flips at once, saves in the background. */
export function ReceiptCheck({ id, checked, canEdit }: { id: string; checked: boolean; canEdit: boolean }) {
  const [on, setOn] = useOptimistic(checked)
  const [pending, start] = useTransition()
  const [failed, setFailed] = useState(false)

  if (!canEdit) {
    return on
      ? <CheckCircle2 className="w-5 h-5 text-green-600" aria-label="On the bill" />
      : <Circle className="w-5 h-5 text-gray-200" aria-label="Not checked off" />
  }
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? 'Checked off — click to undo' : 'Check off against the bill'}
      title={failed ? 'That did not save. Try again.' : on ? 'On the bill — click to undo' : 'Check off against the bill'}
      onClick={() => start(async () => {
        setOn(!on)
        const res = await setStatementChecked([id], !on)
        setFailed(!!res.error)
      })}
      className="align-middle"
    >
      {on
        ? <CheckCircle2 className="w-5 h-5 text-green-600" />
        : <Circle className={`w-5 h-5 ${failed ? 'text-red-500' : 'text-gray-300 hover:text-green-500'}`} />}
    </button>
  )
}

/** "Check off all shown" / "Clear all shown" for the receipts on screen. */
export function ReceiptCheckAll({ ids, checked, label }: { ids: string[]; checked: boolean; label: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  if (!ids.length) return null
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`${label}? That is ${ids.length} receipt${ids.length === 1 ? '' : 's'}.`)) return
        start(async () => { const res = await setStatementChecked(ids, checked); setError(res.error ?? null) })
      }}
      className={`text-xs font-medium hover:underline disabled:opacity-50 ${checked ? 'text-green-700' : 'text-gray-500'}`}
    >
      {pending ? 'Saving…' : error ?? label}
    </button>
  )
}
