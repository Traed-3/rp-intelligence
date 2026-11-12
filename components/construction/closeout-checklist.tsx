'use client'

import { useActionState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { fmtDate } from '@/lib/construction'
import type { ActionState } from '@/app/(app)/construction/actions'

export type CloseoutTask = {
  id: string
  task_name: string | null
  is_complete: boolean
  completed_by: string | null
  completed_date: string | null
}

function TaskRow({
  task,
  canWrite,
  onToggle,
  onDelete,
}: {
  task: CloseoutTask
  canWrite: boolean
  onToggle: (id: string, v: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        disabled={!canWrite || isPending}
        onClick={() => startTransition(() => { onToggle(task.id, !task.is_complete) })}
        className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
          task.is_complete ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-blue-400'
        } disabled:opacity-50`}
      >
        {task.is_complete && <Check className="w-3.5 h-3.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${task.is_complete ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{task.task_name}</p>
        {task.is_complete && (task.completed_by || task.completed_date) && (
          <p className="text-xs text-gray-400">{task.completed_by ?? ''}{task.completed_date ? ` · ${fmtDate(task.completed_date)}` : ''}</p>
        )}
      </div>
      {canWrite && (
        <button type="button" onClick={() => startTransition(() => { onDelete(task.id) })} className="text-xs text-gray-300 hover:text-red-500">✕</button>
      )}
    </li>
  )
}

export function CloseoutChecklist({
  tasks,
  canWrite,
  onToggle,
  onDelete,
  onAdd,
  onSeed,
}: {
  tasks: CloseoutTask[]
  canWrite: boolean
  onToggle: (id: string, v: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onAdd: (state: ActionState, formData: FormData) => Promise<ActionState>
  onSeed: () => Promise<void>
}) {
  const [state, addAction, isAdding] = useActionState(onAdd, null)
  const [isSeeding, startSeed] = useTransition()
  const done = tasks.filter(t => t.is_complete).length

  return (
    <div className="rp-card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Close-Out Punchlist</h2>
        <span className="text-xs text-gray-400">{done}/{tasks.length} done</span>
      </div>

      {tasks.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-gray-400 mb-3">No punchlist yet.</p>
          {canWrite && (
            <button
              type="button"
              disabled={isSeeding}
              onClick={() => startSeed(() => { onSeed() })}
              className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60"
            >
              {isSeeding ? 'Adding…' : 'Add standard checklist'}
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {tasks.map(t => (
            <TaskRow key={t.id} task={t} canWrite={canWrite} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </ul>
      )}

      {canWrite && (
        <form action={addAction} className="px-4 py-3 border-t border-gray-100 flex gap-2">
          <input
            name="task_name"
            placeholder="Add a punchlist item…"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={isAdding} className="px-3 py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-60">
            {isAdding ? '…' : 'Add'}
          </button>
        </form>
      )}
      {state?.error && <p className="px-4 pb-3 text-xs text-red-600">{state.error}</p>}
    </div>
  )
}
