'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PartPicker, type PickedPart } from '@/components/construction/part-picker'
import { receiveStock } from '@/app/(app)/inventory/stock-actions'
import type { ActionState } from '@/app/(app)/inventory/actions'
import { money } from '@/lib/inventory'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-sm font-medium text-gray-700 mb-1'

export function ReceiveForm({ locations, defaultLocation }: { locations: { id: string; name: string }[]; defaultLocation?: string | null }) {
  const [state, formAction, pending] = useActionState(receiveStock, {} as ActionState)
  const [desc, setDesc] = useState('')
  const [part, setPart] = useState<PickedPart | null>(null)
  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}
      {state?.ok && <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">Received. Add the next line.</div>}
      <input type="hidden" name="part_id" value={part?.id ?? ''} />
      <div>
        <label className={lbl} htmlFor="rcv-part">Part <span className="text-red-500">*</span></label>
        <PartPicker value={desc} onChange={t => { setDesc(t); setPart(null) }} onPick={p => { setDesc(p.part_number ? `${p.description} (${p.part_number})` : p.description); setPart(p) }} className={inp} placeholder="Type the part number off the packing slip" />
        {part && <div className="text-xs text-gray-500 mt-1">On file: {part.unit_cost != null ? `${money(part.unit_cost)} (${part.cost_source ?? 'book'}${part.cost_date ? `, ${part.cost_date.slice(0, 10)}` : ''})` : 'no cost yet'}</div>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div><label className={lbl} htmlFor="rcv-qty">Quantity <span className="text-red-500">*</span></label><input id="rcv-qty" name="qty" type="number" step="any" inputMode="decimal" className={inp} required placeholder="1" /></div>
        <div><label className={lbl} htmlFor="rcv-cost">Unit cost <span className="font-normal text-gray-400">(from the invoice)</span></label><input id="rcv-cost" name="unit_cost" type="number" step="any" inputMode="decimal" className={inp} placeholder={part?.unit_cost != null ? String(part.unit_cost) : '0.00'} /></div>
        <div className="col-span-2"><label className={lbl} htmlFor="rcv-loc">Put on <span className="text-red-500">*</span></label>
          <select id="rcv-loc" name="location_id" className={inp} defaultValue={defaultLocation ?? ''} required><option value="">— choose shelf or truck —</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div><label className={lbl} htmlFor="rcv-vendor">Vendor</label><input id="rcv-vendor" name="vendor" className={inp} placeholder="Source North America" /></div>
        <div><label className={lbl} htmlFor="rcv-ref">Packing slip / invoice #</label><input id="rcv-ref" name="ref_label" className={inp} placeholder="2628199" /></div>
        <div><label className={lbl} htmlFor="rcv-type">Document</label>
          <select id="rcv-type" name="ref_type" className={inp} defaultValue="packing_slip"><option value="packing_slip">Packing slip</option><option value="vendor_invoice">Vendor invoice</option><option value="counter_pickup">Counter pickup / receipt</option><option value="return_from_job">Returned from a job</option></select></div>
        <div><label className={lbl} htmlFor="rcv-note">Note</label><input id="rcv-note" name="note" className={inp} placeholder="for SU-5015" /></div>
      </div>
      <Button type="submit" disabled={pending || !part}>{pending ? 'Receiving…' : 'Receive into stock'}</Button>
    </form>
  )
}
