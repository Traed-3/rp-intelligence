'use client'

import { useTransition } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

// Only usable when the project is actually clear (every Required permit in hand).
// The server action re-checks and refuses otherwise — this is a convenience, not the gate.
export function ReadyToWorkButton({
  projectId,
  ready,
  eligible,
  mark,
  clear,
}: {
  projectId: string
  ready: boolean
  eligible: boolean
  mark: (projectId: string) => Promise<void>
  clear: (projectId: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  if (ready) {
    return (
      <button type="button" disabled={isPending} onClick={() => startTransition(() => clear(projectId))}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-600 text-white font-semibold hover:bg-green-600/90 disabled:opacity-60">
        <CheckCircle2 className="w-3.5 h-3.5" /> Marked ready — click to undo
      </button>
    )
  }
  return (
    <button type="button" disabled={isPending || !eligible} title={eligible ? '' : 'A required permit is not in hand yet.'}
      onClick={() => startTransition(() => mark(projectId))}
      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-semibold ${eligible ? 'bg-card border border-green-500 text-green-700 hover:bg-green-50' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'} disabled:opacity-60`}>
      {eligible ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} Mark ready to work
    </button>
  )
}
