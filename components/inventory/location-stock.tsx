'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PartPicker, type PickedPart } from '@/components/construction/part-picker'
import { setStockLevel, postCount, adjustStock } from '@/app/(app)/inventory/stock-actions'
import type { ActionState } from '@/app/(app)/inventory/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
export type StockRow = { part_id: string; part_number: string | null; description: string; on_hand: number; min_qty: number | null; max_qty: number | null; bin: string | null }

/** One location's stock: on-hand list with inline min/max, a count mode, and a quick adjust. */
export function LocationStock({ locationId, rows, canWrite }: { locationId: string; rows: StockRow[]; canWrite: boolean }) {
  const [mode, setMode] = useState<'view' | 'count'>('view')
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [countState, countAction, countPending] = useActionState(postCount.bind(null, locationId), {} as ActionState)
  const [q, setQ] = useState('')
  const shown = rows.filter(r => !q || `${r.part_number ?? ''} ${r.description}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter this location…" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-64" aria-label="Filter parts" />
        {canWrite && (mode === 'view'
          ? <button type="button" onClick={() => setMode('count')} className="text-sm rounded-lg border border-blue-200 bg-blue-50 text-blue-700 px-3 py-1.5">Start a count</button>
          : <button type="button" onClick={() => { setMode('view'); setCounts({}) }} className="text-sm rounded-lg border border-gray-200 px-3 py-1.5 text-gray-600">Cancel count</button>)}
        <span className="text-xs text-gray-400 ml-auto">{rows.length} part{rows.length !== 1 ? 's' : ''} tracked here</span>
      </div>

      {mode === 'count' && (
        <form action={countAction} className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm flex flex-wrap items-center gap-3">
          <input type="hidden" name="counts" value={JSON.stringify(Object.entries(counts).filter(([, v]) => v !== '').map(([part_id, counted]) => ({ part_id, counted: Number(counted) })))} />
          <span className="text-blue-900">Type what you actually see. Blank lines are skipped; differences post as count adjustments.</span>
          <input name="note" placeholder="quarterly count" className="rounded-lg border border-blue-200 px-3 py-1.5 text-sm" aria-label="Count note" />
          <Button type="submit" disabled={countPending || Object.values(counts).every(v => v === '')}>{countPending ? 'Posting…' : 'Post count'}</Button>
          {countState?.error && <span className="text-red-600">{countState.error}</span>}
          {countState?.ok && <span className="text-green-700">Count posted.</span>}
        </form>
      )}

      <div className="rp-card overflow-hidden">
        {shown.length === 0 ? <p className="p-6 text-sm text-gray-400">Nothing tracked here yet. Receive parts onto it, transfer some in, or set a min/max below.</p> : (
          <div className="overflow-x-auto"><table className="rp-table w-full text-sm">
            <thead><tr className="bg-gray-50 text-gray-500 text-xs"><th className="text-left px-4 py-2">Part</th><th className="text-right px-4 py-2">On hand</th>{mode === 'count' && <th className="text-right px-4 py-2">Counted</th>}<th className="text-right px-4 py-2">Min</th><th className="text-right px-4 py-2">Max</th><th className="text-left px-4 py-2 hidden sm:table-cell">Bin</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {shown.map(r => <Row key={r.part_id} r={r} locationId={locationId} canWrite={canWrite} counting={mode === 'count'} counted={counts[r.part_id] ?? ''} onCount={v => setCounts(c => ({ ...c, [r.part_id]: v }))} />)}
            </tbody></table></div>
        )}
      </div>

      {canWrite && <AddToLocation locationId={locationId} />}
    </div>
  )
}

function Row({ r, locationId, canWrite, counting, counted, onCount }: { r: StockRow; locationId: string; canWrite: boolean; counting: boolean; counted: string; onCount: (v: string) => void }) {
  const [state, action, pending] = useActionState(setStockLevel, {} as ActionState)
  const below = r.min_qty != null && r.on_hand < Number(r.min_qty)
  return (
    <tr className={below ? 'bg-red-50/40' : ''}>
      <td className="px-4 py-2"><div className="text-gray-900">{r.description}</div><div className="text-xs font-mono text-gray-400">{r.part_number ?? ''}</div></td>
      <td className={`px-4 py-2 text-right tabular-nums font-semibold ${below ? 'text-red-600' : 'text-gray-900'}`}>{r.on_hand}</td>
      {counting && <td className="px-4 py-2 text-right"><input value={counted} onChange={e => onCount(e.target.value)} type="number" step="any" inputMode="decimal" className={`${inp} w-20 text-right ml-auto`} aria-label={`Counted ${r.description}`} /></td>}
      {canWrite ? (
        <td colSpan={3} className="px-4 py-2">
          <form action={action} className="flex items-center gap-2 justify-end">
            <input type="hidden" name="location_id" value={locationId} /><input type="hidden" name="part_id" value={r.part_id} />
            <input name="min_qty" defaultValue={r.min_qty ?? ''} type="number" step="any" className={`${inp} w-16 text-right`} aria-label="Min" placeholder="min" />
            <input name="max_qty" defaultValue={r.max_qty ?? ''} type="number" step="any" className={`${inp} w-16 text-right`} aria-label="Max" placeholder="max" />
            <input name="bin" defaultValue={r.bin ?? ''} className={`${inp} w-20 hidden sm:block`} aria-label="Bin" placeholder="bin" />
            <button type="submit" disabled={pending} className="text-xs text-blue-600 disabled:opacity-50">{pending ? '…' : state?.ok ? 'Saved' : 'Save'}</button>
          </form>
        </td>
      ) : (<><td className="px-4 py-2 text-right tabular-nums text-gray-500">{r.min_qty ?? '—'}</td><td className="px-4 py-2 text-right tabular-nums text-gray-500">{r.max_qty ?? '—'}</td><td className="px-4 py-2 text-gray-500 hidden sm:table-cell">{r.bin ?? ''}</td></>)}
    </tr>
  )
}

/** Put a catalog part on this location's list (sets min/max), or post a quick +/- adjustment. */
function AddToLocation({ locationId }: { locationId: string }) {
  const [desc, setDesc] = useState(''); const [part, setPart] = useState<PickedPart | null>(null)
  const [lvl, lvlAction, lvlPending] = useActionState(setStockLevel, {} as ActionState)
  const [adj, adjAction, adjPending] = useActionState(adjustStock, {} as ActionState)
  return (
    <details className="rp-card">
      <summary className="px-5 py-4 cursor-pointer font-semibold text-gray-900">Add a part to this location / quick adjustment</summary>
      <div className="px-5 pb-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ls-part">Part</label>
          <PartPicker value={desc} onChange={t => { setDesc(t); setPart(null) }} onPick={p => { setDesc(p.part_number ? `${p.description} (${p.part_number})` : p.description); setPart(p) }} className={inp} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <form action={lvlAction} className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="text-sm font-medium text-gray-800">Set min / max here</div>
            {lvl?.error && <div className="text-xs text-red-600">{lvl.error}</div>}{lvl?.ok && <div className="text-xs text-green-700">Saved.</div>}
            <input type="hidden" name="location_id" value={locationId} /><input type="hidden" name="part_id" value={part?.id ?? ''} />
            <div className="grid grid-cols-3 gap-2"><input name="min_qty" type="number" step="any" placeholder="min" className={inp} aria-label="Min" /><input name="max_qty" type="number" step="any" placeholder="max" className={inp} aria-label="Max" /><input name="bin" placeholder="bin" className={inp} aria-label="Bin" /></div>
            <Button type="submit" disabled={lvlPending || !part} variant="outline">Save level</Button>
          </form>
          <form action={adjAction} className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="text-sm font-medium text-gray-800">Adjust on-hand</div>
            {adj?.error && <div className="text-xs text-red-600">{adj.error}</div>}{adj?.ok && <div className="text-xs text-green-700">Posted.</div>}
            <input type="hidden" name="location_id" value={locationId} /><input type="hidden" name="part_id" value={part?.id ?? ''} />
            <div className="grid grid-cols-3 gap-2">
              <input name="qty" type="number" step="any" placeholder="+2 / -1" className={inp} aria-label="Quantity change" />
              <select name="txn_type" className={inp} defaultValue="adjust" aria-label="Reason"><option value="adjust">Adjust</option><option value="scrap">Scrap / broken</option><option value="warranty_return">Warranty return</option></select>
              <input name="note" placeholder="why" className={inp} aria-label="Note" />
            </div>
            <Button type="submit" disabled={adjPending || !part} variant="outline">Post adjustment</Button>
          </form>
        </div>
      </div>
    </details>
  )
}
