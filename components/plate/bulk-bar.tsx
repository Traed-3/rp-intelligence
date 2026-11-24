'use client'
import { useEffect, useState } from 'react'

/** Row checkboxes carry form={formId}; this bar counts them, selects/clears all in view, and submits the bulk form. */
export function BulkBar({ formId }: { formId: string }) {
  const [count, setCount] = useState(0)
  const [total, setTotal] = useState(0)
  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"]`))
  useEffect(() => {
    const sync = () => { const b = boxes(); setTotal(b.length); setCount(b.filter(x => x.checked).length) }
    sync()
    document.addEventListener('change', sync)
    return () => document.removeEventListener('change', sync)
  })
  const setAll = (on: boolean) => { boxes().forEach(b => { b.checked = on }); setCount(on ? boxes().length : 0) }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer select-none">
        <input type="checkbox" checked={total > 0 && count === total} onChange={e => setAll(e.target.checked)} /> Select all{total ? ` (${total})` : ''}
      </label>
      <button form={formId} disabled={count === 0}
        className="px-2.5 py-1 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed">
        Complete selected{count ? ` (${count})` : ''}
      </button>
    </div>
  )
}
