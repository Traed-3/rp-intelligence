'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { saveLingo, removeLingo, type LingoState } from '@/app/(app)/service/tickets/lingo/actions'
import { LINGO_CATEGORIES } from '@/lib/ticket-log'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'

export type LingoRow = { id: string; term: string; meaning: string | null; misreads: string | null; note: string | null; category: string }

/** Add a word; pressing Edit on a row loads it here, and saving a term that already exists updates it. */
export function LingoForm({ editing, onDone }: { editing: LingoRow | null; onDone: () => void }) {
  const [state, action, pending] = useActionState<LingoState, FormData>(saveLingo, null)
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state?.ok) { formRef.current?.reset(); onDone() } }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form ref={formRef} action={action} key={editing?.id ?? 'new'} className="rp-card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">{editing ? `Change "${editing.term}"` : 'Add a word'}</h2>
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{state.error}</div>}
      {state?.ok && <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">{state.ok} The reader uses it on the next ticket.</div>}
      <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
        <div className="sm:col-span-1">
          <label htmlFor="term" className="block text-xs font-medium text-gray-500 mb-1">Word</label>
          <input id="term" name="term" required defaultValue={editing?.term ?? ''} placeholder="MUL" className={inp} />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="meaning" className="block text-xs font-medium text-gray-500 mb-1">What it means</label>
          <input id="meaning" name="meaning" required defaultValue={editing?.meaning ?? ''} placeholder="Midgrade unleaded" className={inp} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="category" className="block text-xs font-medium text-gray-500 mb-1">Kind</label>
          <select id="category" name="category" defaultValue={editing?.category ?? 'equipment'} className={inp}>
            {LINGO_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="misreads" className="block text-xs font-medium text-gray-500 mb-1">Gets misread as (optional)</label>
          <input id="misreads" name="misreads" defaultValue={editing?.misreads ?? ''} placeholder="MVL, MID" className={inp} />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="note" className="block text-xs font-medium text-gray-500 mb-1">Note (optional)</label>
          <input id="note" name="note" defaultValue={editing?.note ?? ''} placeholder="Anything that helps tell it apart" className={inp} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : editing ? 'Save change' : 'Add word'}</Button>
        {editing && <button type="button" onClick={onDone} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>}
      </div>
    </form>
  )
}

export function LingoManager({ rows, canEdit }: { rows: LingoRow[]; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState<LingoRow | null>(null)
  const [, start] = useTransition()
  const groups = LINGO_CATEGORIES.map(c => ({ ...c, rows: rows.filter(r => r.category === c.value) })).filter(g => g.rows.length)
  const known = new Set(LINGO_CATEGORIES.map(c => c.value as string))
  const stray = rows.filter(r => !known.has(r.category))
  if (stray.length) groups.push({ value: 'general', label: 'Other', rows: stray })

  return (
    <div className="space-y-5">
      {canEdit && <LingoForm editing={editing} onDone={() => setEditing(null)} />}
      {groups.map(g => (
        <div key={g.label} className="rp-card overflow-x-auto">
          <div className="px-4 py-3 border-b border-gray-100"><h2 className="font-semibold text-gray-900">{g.label} ({g.rows.length})</h2></div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-50">
              {g.rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-semibold text-gray-900 whitespace-nowrap align-top w-36">{r.term}</td>
                  <td className="px-4 py-2.5 text-gray-700 align-top">
                    {r.meaning ?? <span className="text-amber-600 font-medium">Meaning needed</span>}
                    {r.note && <span className="block text-xs text-gray-400">{r.note}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 align-top hidden sm:table-cell">{r.misreads ? `Misread as: ${r.misreads}` : ''}</td>
                  {canEdit && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap align-top">
                      <button type="button" onClick={() => { setEditing(r); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="text-xs font-medium text-blue-600 hover:text-blue-800 mr-3">Edit</button>
                      <button type="button" onClick={() => { if (window.confirm(`Remove "${r.term}" from the list?`)) start(async () => { await removeLingo(r.id); router.refresh() }) }} className="text-xs font-medium text-gray-400 hover:text-red-600">Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
