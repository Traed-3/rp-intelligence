'use client'

import { useActionState, useRef, useState, useTransition } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { RingLoader } from '@/components/ui/ring-loader'
import { PartPicker, type PickedPart } from '@/components/construction/part-picker'
import { SignaturePad } from '@/components/svc/signature-pad'
import { money } from '@/lib/inventory'
import { BRANDS, CHARGE_TYPES, TICKET_STATUSES, ticketStatusMeta } from '@/lib/service-tickets'
import { saveTicketDetails, addLabor, removeLabor, addPart, removePart, addPhoto, signTicket, type ActionState } from '@/app/(app)/service/tickets/actions'

const inp = 'w-full rounded-xl border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'
const card = 'rp-card p-4'

export type TicketRecord = {
  id: string; ticket_number: string; status: string; brand: string | null; store_number: string | null; csr_number: string | null; po_number: string | null
  site_address: string | null; city_state_zip: string | null; problem_reported: string | null; work_performed: string | null
  truck_location_id: string | null; technician_id: string | null; charge_type: string | null; needs_quote: boolean | null
  tech_signature_url: string | null; tech_signed_at: string | null; site_signature_url: string | null; site_signer_name: string | null; site_signer_title: string | null; site_signed_at: string | null
}
export type LaborRow = { id: string; work_date: string; kind: string; hours: number; tech_name?: string | null }
export type PartRow = { id: string; description: string; quantity: number; unit_cost: number | null; sell_price: number | null; charge_type: string | null; part_number?: string | null; location_name?: string | null }
export type PhotoRow = { id: string; url: string; kind: string | null }
type Opt = { id: string; name: string }

export function TicketForm({ ticket, labor, parts, photos, trucks, techs, canWrite, compact }: {
  ticket: TicketRecord; labor: LaborRow[]; parts: PartRow[]; photos: PhotoRow[]; trucks: Opt[]; techs: Opt[]; canWrite: boolean; compact?: boolean
}) {
  const locked = ['signed', 'invoiced', 'void'].includes(ticket.status)
  const editable = canWrite && !locked
  const [state, formAction, pending] = useActionState(saveTicketDetails.bind(null, ticket.id), {} as ActionState)
  const st = ticketStatusMeta(ticket.status)
  const laborHours = labor.filter(l => l.kind !== 'trip').reduce((a, l) => a + Number(l.hours), 0)
  const tripHours = labor.filter(l => l.kind === 'trip').reduce((a, l) => a + Number(l.hours), 0)

  return (
    <div className="space-y-4">
      {/* Status + site header */}
      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-gray-400">{ticket.ticket_number}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${st.className}`}>{st.label}</span>
        </div>
        <div className="mt-1 text-lg font-bold text-gray-900">{ticket.brand ?? 'Customer'} {ticket.store_number ? `· Store ${ticket.store_number}` : ''}</div>
        {ticket.site_address && <div className="text-sm text-gray-500">{ticket.site_address}{ticket.city_state_zip ? `, ${ticket.city_state_zip}` : ''}</div>}
        {locked && <div className="mt-2 text-xs text-green-700">Locked: this ticket is {st.label.toLowerCase()}. Ask the office to reopen it if something is wrong.</div>}
      </div>

      {/* Details */}
      <form action={formAction} className={`${card} space-y-3`}>
        <h2 className="font-semibold text-gray-900">Job details</h2>
        {state?.error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{state.error}</div>}
        {state?.ok && <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">Saved.</div>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl} htmlFor="t-store">Store #</label><input id="t-store" name="store_number" className={inp} defaultValue={ticket.store_number ?? ''} disabled={!editable} /></div>
          <div><label className={lbl} htmlFor="t-csr">CSR / WO #</label><input id="t-csr" name="csr_number" className={inp} defaultValue={ticket.csr_number ?? ''} disabled={!editable} placeholder="WOT1211757" /></div>
          <div><label className={lbl} htmlFor="t-brand">Brand</label>
            <select id="t-brand" name="brand" className={inp} defaultValue={ticket.brand ?? 'Independent'} disabled={!editable}>{BRANDS.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
          <div><label className={lbl} htmlFor="t-po">PO #</label><input id="t-po" name="po_number" className={inp} defaultValue={ticket.po_number ?? ''} disabled={!editable} /></div>
          <div className="col-span-2"><label className={lbl} htmlFor="t-addr">Site address</label><input id="t-addr" name="site_address" className={inp} defaultValue={ticket.site_address ?? ''} disabled={!editable} /></div>
          <div className="col-span-2"><label className={lbl} htmlFor="t-csz">City, State ZIP</label><input id="t-csz" name="city_state_zip" className={inp} defaultValue={ticket.city_state_zip ?? ''} disabled={!editable} /></div>
          <div><label className={lbl} htmlFor="t-truck">Truck (parts come from)</label>
            <select id="t-truck" name="truck_location_id" className={inp} defaultValue={ticket.truck_location_id ?? ''} disabled={!editable}><option value="">— none —</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div><label className={lbl} htmlFor="t-tech">Technician</label>
            <select id="t-tech" name="technician_id" className={inp} defaultValue={ticket.technician_id ?? ''} disabled={!editable}><option value="">— none —</option>{techs.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div><label className={lbl} htmlFor="t-charge">Charge type</label>
            <select id="t-charge" name="charge_type" className={inp} defaultValue={ticket.charge_type ?? 'billable'} disabled={!editable}>{CHARGE_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
          <div><label className={lbl} htmlFor="t-status">Status</label>
            <select id="t-status" name="status" className={inp} defaultValue={ticket.status} disabled={!canWrite}>{TICKET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
        </div>
        <div><label className={lbl} htmlFor="t-problem">Problem reported</label><textarea id="t-problem" name="problem_reported" rows={2} className={inp} defaultValue={ticket.problem_reported ?? ''} disabled={!editable} /></div>
        <div><label className={lbl} htmlFor="t-work">Work performed <span className="text-gray-400">(this becomes the invoice description)</span></label>
          <textarea id="t-work" name="work_performed" rows={4} className={inp} defaultValue={ticket.work_performed ?? ''} disabled={!editable} placeholder="Arrived on site. Found… Replaced… Tested, all functions normal." /></div>
        <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="needs_quote" defaultChecked={!!ticket.needs_quote} disabled={!editable} className="w-4 h-4 rounded border-gray-300" />Needs a quote before more work (over NTE)</label>
        {canWrite && <button type="submit" disabled={pending} className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-2.5 disabled:opacity-50">{pending ? 'Saving…' : 'Save details'}</button>}
      </form>

      {/* Labor */}
      <div className={card}>
        <div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-gray-900">Labor &amp; trips</h2><span className="text-xs text-gray-500 tabular-nums">{laborHours} h labor · {tripHours} h trip</span></div>
        {labor.length === 0 ? <p className="text-sm text-gray-400 mb-2">No hours yet.</p> : (
          <ul className="divide-y divide-gray-100 mb-2">
            {labor.map(l => (
              <li key={l.id} className="flex items-center justify-between py-1.5 text-sm">
                <span><span className="text-gray-900">{l.kind === 'trip' ? 'Trip' : l.kind === 'overtime' ? 'Labor (OT)' : 'Labor'}</span> <span className="text-gray-500">{l.work_date.slice(0, 10)}{l.tech_name ? ` · ${l.tech_name}` : ''}</span></span>
                <span className="flex items-center gap-3 tabular-nums"><b>{Number(l.hours)} h</b>{editable && <RemoveButton action={() => removeLabor(ticket.id, l.id)} />}</span>
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <form action={addLabor.bind(null, ticket.id)} className="grid grid-cols-3 gap-2 items-end">
            <div><label className={lbl} htmlFor="l-date">Date</label><input id="l-date" name="work_date" type="date" className={inp} defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
            <div><label className={lbl} htmlFor="l-hours">On-site hrs</label><input id="l-hours" name="hours" type="number" step="0.5" inputMode="decimal" className={inp} required placeholder="8" /></div>
            <div><label className={lbl} htmlFor="l-trip">Trip hrs</label><input id="l-trip" name="trip_hours" type="number" step="0.5" inputMode="decimal" className={inp} placeholder="2" /></div>
            <div className="col-span-3"><button type="submit" className="w-full rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold py-2">+ Add day</button></div>
          </form>
        )}
      </div>

      {/* Parts */}
      <div className={card}>
        <h2 className="font-semibold text-gray-900 mb-2">Parts used</h2>
        {parts.length === 0 ? <p className="text-sm text-gray-400 mb-2">No parts yet.</p> : (
          <ul className="divide-y divide-gray-100 mb-2">
            {parts.map(p => (
              <li key={p.id} className="flex items-start justify-between py-1.5 text-sm gap-2">
                <span className="min-w-0"><span className="text-gray-900">{p.description}</span>{p.part_number && <span className="ml-1 font-mono text-xs text-blue-700">{p.part_number}</span>}<div className="text-xs text-gray-500">{p.location_name ?? 'no location'}{p.charge_type && p.charge_type !== 'billable' ? ` · ${p.charge_type}` : ''}</div></span>
                <span className="flex items-center gap-3 tabular-nums whitespace-nowrap">{Number(p.quantity)} × {p.sell_price != null ? money(p.sell_price) : <span className="text-pink-600">price?</span>}{editable && <RemoveButton action={() => removePart(ticket.id, p.id)} />}</span>
              </li>
            ))}
          </ul>
        )}
        {editable && <AddPartForm ticketId={ticket.id} trucks={trucks} defaultTruck={ticket.truck_location_id} />}
      </div>

      {/* Photos */}
      <div className={card}>
        <h2 className="font-semibold text-gray-900 mb-2">Photos</h2>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {photos.map(ph => (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={ph.id} href={ph.url} target="_blank" rel="noopener"><img src={ph.url} alt={ph.kind ?? 'photo'} className="w-full aspect-square object-cover rounded-lg border border-gray-200" /></a>
            ))}
          </div>
        )}
        {editable && <PhotoButton ticketId={ticket.id} />}
      </div>

      {/* Signatures */}
      <div className={compact ? 'space-y-3' : 'grid grid-cols-1 md:grid-cols-2 gap-3'}>
        <SignaturePad title="Technician signature" existingUrl={ticket.tech_signature_url} signedLabel={ticket.tech_signed_at ? `Signed ${new Date(ticket.tech_signed_at).toLocaleString()}` : null}
          onSave={(d) => signTicket(ticket.id, 'tech', d)} disabled={!canWrite} />
        <SignaturePad title="Site signature" askName existingUrl={ticket.site_signature_url}
          signedLabel={ticket.site_signed_at ? `${ticket.site_signer_name ?? ''}${ticket.site_signer_title ? `, ${ticket.site_signer_title}` : ''} · ${new Date(ticket.site_signed_at).toLocaleString()}` : null}
          onSave={(d, n, t) => signTicket(ticket.id, 'site', d, n, t)} disabled={!canWrite} />
      </div>
    </div>
  )
}

function RemoveButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition()
  return <button type="button" onClick={() => start(action)} disabled={pending} className="text-gray-300 hover:text-red-500" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
}

function AddPartForm({ ticketId, trucks, defaultTruck }: { ticketId: string; trucks: Opt[]; defaultTruck: string | null }) {
  const [desc, setDesc] = useState('')
  const [partId, setPartId] = useState<string | null>(null)
  const [price, setPrice] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  return (
    <form ref={formRef} action={async (fd) => { await addPart(ticketId, fd); setDesc(''); setPartId(null); setPrice(''); formRef.current?.reset() }} className="space-y-2">
      <input type="hidden" name="part_id" value={partId ?? ''} />
      <input type="hidden" name="description" value={desc} />
      <PartPicker prefer="sell" value={desc} onChange={t => { setDesc(t); setPartId(null) }} onPick={(p: PickedPart) => { setDesc(p.part_number ? `${p.description} (${p.part_number})` : p.description); setPartId(p.id); setPrice(p.suggested_price != null ? String(p.suggested_price) : '') }} className={inp} placeholder="Part number or description" />
      <div className="grid grid-cols-3 gap-2">
        <div><label className={lbl} htmlFor="p-qty">Qty</label><input id="p-qty" name="quantity" type="number" step="any" inputMode="decimal" className={inp} defaultValue="1" /></div>
        <div><label className={lbl} htmlFor="p-sell">Sell $</label><input id="p-sell" name="sell_price" type="number" step="any" inputMode="decimal" className={inp} value={price} onChange={e => setPrice(e.target.value)} placeholder="auto" /></div>
        <div><label className={lbl} htmlFor="p-loc">From</label><select id="p-loc" name="from_location" className={inp} defaultValue={defaultTruck ?? ''}><option value="">—</option>{trucks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      </div>
      <button type="submit" disabled={!desc.trim()} className="w-full rounded-xl border border-blue-200 bg-blue-50 text-blue-700 text-sm font-semibold py-2 disabled:opacity-50">+ Add part</button>
    </form>
  )
}

function PhotoButton({ ticketId }: { ticketId: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [, start] = useTransition()
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBusy(true); setErr(null)
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('bucket', 'ticket-attachments')
      const r = await fetch('/api/upload', { method: 'POST', body: fd }); const j = await r.json()
      if (!r.ok || !j.url) throw new Error(j.error ?? 'Upload failed')
      start(() => addPhoto(ticketId, j.url, 'after'))
    } catch (x) { setErr((x as Error).message) } finally { setBusy(false); e.target.value = '' }
  }
  return (
    <label className="flex items-center justify-center gap-2 w-full rounded-xl border border-dashed border-gray-300 py-3 text-sm text-gray-600 cursor-pointer hover:border-blue-300">
      {busy ? <RingLoader /> : <Camera className="w-4 h-4" />}{busy ? 'Uploading…' : 'Take or add a photo'}
      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} disabled={busy} />
      {err && <span className="text-red-600 text-xs">{err}</span>}
    </label>
  )
}
