'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ActionState } from '@/app/(app)/construction/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const file = 'block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm hover:file:bg-gray-200'

type TechRow = { name: string; initials: string; hours: string }
const blank: TechRow = { name: '', initials: '', hours: '' }

export type JobOption = { id: string; label: string }

export function DailyUpdateForm({
  action,
  jobs,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>
  /** When present the form picks its own job — used by the crew's mobile screen. */
  jobs?: JobOption[]
}) {
  const [state, formAction, isPending] = useActionState(action, null)
  const [techs, setTechs] = useState<TechRow[]>([{ ...blank }])

  const setRow = (i: number, patch: Partial<TechRow>) =>
    setTechs((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setTechs((rows) => [...rows, { ...blank }])
  const removeRow = (i: number) => setTechs((rows) => (rows.length === 1 ? rows : rows.filter((_, j) => j !== i)))

  const manHours = techs.reduce((sum, t) => sum + (parseFloat(t.hours) || 0), 0)

  // React resets the uncontrolled fields after a successful action, but the tech
  // rows are our own state — clear them too so the next day starts empty instead
  // of silently re-submitting yesterday's crew and hours.
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !isPending && !state?.error) setTechs([{ ...blank }])
    wasPending.current = isPending
  }, [isPending, state])

  return (
    <form action={formAction} className="space-y-4">
      {jobs && (
        <div>
          <label className={lbl}>Job</label>
          <select name="job_id" required defaultValue="" className={inp}>
            <option value="" disabled>Pick a job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={lbl}>Date</label>
          <input name="work_date" type="date" required defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })} className={inp} />
        </div>
        <div>
          <label className={lbl}>Ticket / PO image</label>
          <input name="ticket" type="file" accept="image/*,application/pdf" className={file} />
        </div>
        <div>
          <label className={lbl}>Job photos</label>
          <input name="photos" type="file" accept="image/*" multiple className={file} />
        </div>
      </div>

      <div>
        <label className={lbl}>Work performed</label>
        <textarea name="work_description" rows={3} className={inp} placeholder="What the crew did today…" />
      </div>

      {/* Techs → man-hours */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className={lbl + ' mb-0'}>Techs on the job</span>
          <span className="text-xs text-gray-500">Man-hours: <span className="font-semibold text-gray-800">{manHours.toFixed(2)}</span></span>
        </div>
        <div className="space-y-2">
          {techs.map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input
                className={inp + ' col-span-6'} placeholder="Tech name"
                value={t.name} onChange={(e) => setRow(i, { name: e.target.value })}
                name={t.name.trim() ? 'tech_name' : undefined}
              />
              <input
                className={inp + ' col-span-2'} placeholder="Init."
                value={t.initials} onChange={(e) => setRow(i, { initials: e.target.value })}
                name={t.name.trim() ? 'initials' : undefined}
              />
              <input
                className={inp + ' col-span-3'} type="number" step="any" placeholder="Hrs"
                value={t.hours} onChange={(e) => setRow(i, { hours: e.target.value })}
                name={t.name.trim() ? 'hours' : undefined}
              />
              <button type="button" onClick={() => removeRow(i)} className="col-span-1 flex justify-center text-gray-400 hover:text-red-600" aria-label="Remove tech">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-900">
          <Plus size={14} /> Add tech
        </button>
      </div>

      <div>
        <label className={lbl}>Notes (optional)</label>
        <input name="notes" className={inp} placeholder="Anything else…" />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button type="submit" disabled={isPending} className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-60">
        {isPending ? 'Saving…' : 'Save daily update'}
      </button>
    </form>
  )
}
