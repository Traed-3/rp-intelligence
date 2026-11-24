'use client'

import { useActionState, useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PartPicker, type PickedPart } from '@/components/construction/part-picker'
import { createTransfer, setTransferStatus } from '@/app/(app)/inventory/stock-actions'
import type { ActionState } from '@/app/(app)/inventory/actions'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'
type Line = { key: number; text: string; part_id: string | null; part_number: string | null; qty: string }
let k = 0

export function TransferForm({ locations, shortages }: { locations: { id: string; name: string; kind: string }[]; shortages: { location_id: string; part_id: string; part_number: string | null; description: string; on_hand: number; min_qty: number; max_qty: number }[] }) {
  const [state, formAction, pending] = useActionState(createTransfer, {} as ActionState)
  const [from, setFrom] = useState(locations.find(l => l.kind === 'office')?.id ?? '')
  const [to, setTo] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: k++, text: '', part_id: null, part_number: null, qty: '1' }])
  const update = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => l.key === key ? { ...l, ...patch } : l))
  const short = shortages.filter(s => s.location_id === to)

  function fillFromShortages() {
    setLines(short.map(s => ({ key: k++, text: `${s.description}${s.part_number ? ` (${s.part_number})` : ''}`, part_id: s.part_id, part_number: s.part_number, qty: String(Math.max(0, s.max_qty - s.on_hand)) })))
  }

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}
      <input type="hidden" name="lines" value={JSON.stringify(lines.filter(l => l.part_id).map(l => ({ part_id: l.part_id, qty: Number(l.qty) })))} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className={lbl} htmlFor="tr-from">From</label><select id="tr-from" name="from_location" className={inp} value={from} onChange={e => setFrom(e.target.value)}><option value="">— from —</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div><label className={lbl} htmlFor="tr-to">To</label><select id="tr-to" name="to_location" className={inp} value={to} onChange={e => setTo(e.target.value)}><option value="">— to —</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      </div>
      {short.length > 0 && (
        <button type="button" onClick={fillFromShortages} className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">Fill to max: {short.length} part{short.length !== 1 ? 's' : ''} below minimum on this truck</button>
      )}
      <div className="space-y-2">
        {lines.map(l => (
          <div key={l.key} className="grid grid-cols-[1fr_5rem_2rem] gap-2 items-center">
            <PartPicker value={l.text} onChange={t => update(l.key, { text: t, part_id: null, part_number: null })} onPick={(p: PickedPart) => update(l.key, { text: p.part_number ? `${p.description} (${p.part_number})` : p.description, part_id: p.id, part_number: p.part_number })} className={inp} placeholder="Part number or description" />
            <input value={l.qty} onChange={e => update(l.key, { qty: e.target.value })} type="number" step="any" inputMode="decimal" className={`${inp} text-right`} aria-label="Quantity" />
            <button type="button" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="text-gray-300 hover:text-red-500" aria-label="Remove line"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setLines(ls => [...ls, { key: k++, text: '', part_id: null, part_number: null, qty: '1' }])} className="text-sm text-blue-600 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Add line</button>
      </div>
      <div><label className={lbl} htmlFor="tr-note">Note</label><input id="tr-note" name="note" className={inp} placeholder="restock after 41617" /></div>
      <Button type="submit" disabled={pending || !from || !to || !lines.some(l => l.part_id)}>{pending ? 'Creating…' : 'Create transfer'}</Button>
    </form>
  )
}

export function TransferStatusButtons({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition()
  const btn = 'text-xs px-2.5 py-1 rounded-lg border disabled:opacity-50'
  if (status === 'received' || status === 'cancelled') return null
  return (
    <div className="flex gap-2" data-no-row-nav>
      {status === 'pending' && <button type="button" disabled={pending} onClick={() => start(() => setTransferStatus(id, 'picked'))} className={`${btn} border-amber-200 bg-amber-50 text-amber-800`}>Picked</button>}
      <button type="button" disabled={pending} onClick={() => start(() => setTransferStatus(id, 'received'))} className={`${btn} border-green-200 bg-green-50 text-green-800`}>Received on truck</button>
      <button type="button" disabled={pending} onClick={() => { if (confirm('Cancel this transfer?')) start(() => setTransferStatus(id, 'cancelled')) }} className={`${btn} border-gray-200 text-gray-500`}>Cancel</button>
    </div>
  )
}
