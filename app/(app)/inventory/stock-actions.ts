'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { applyReceiptCost } from '@/lib/inventory-costing'
import type { ActionState } from './actions'

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null }
const num = (fd: FormData, k: string) => { const v = str(fd, k); if (v == null) return null; const n = Number(v.replace(/[$,]/g, '')); return isFinite(n) ? n : null }
function refresh(...extra: string[]) { for (const p of ['/inventory', '/inventory/stock', '/inventory/receive', '/inventory/transfers', ...extra]) revalidatePath(p) }

/**
 * RECEIVE: parts arrive (packing slip, vendor invoice, counter pickup) and land on a shelf or truck.
 * Posts one +qty ledger row and refreshes the part's last/avg cost when a cost is given.
 */
export async function receiveStock(_s: ActionState, formData: FormData): Promise<ActionState> {
  // Receiving sets the part's cost and lives on /inventory/receive, which is closed to techs, mechanics and shop employees.
  const { company_id, id: userId, canEditCatalog: canWrite } = await requireInventory()
  if (!canWrite) return { error: 'You do not have permission to receive stock.' }
  const part_id = str(formData, 'part_id'), location_id = str(formData, 'location_id'), qty = num(formData, 'qty')
  if (!part_id) return { error: 'Pick a part from the catalog (type a part number or description and choose a result).' }
  if (!location_id) return { error: 'Choose where it was put.' }
  if (!qty || qty <= 0) return { error: 'Quantity must be more than zero.' }
  const admin = createAdminClient()
  const unit_cost = num(formData, 'unit_cost')
  const { error } = await admin.from('inventory_transactions').insert({
    company_id, txn_type: 'receive', part_id, location_id, qty, unit_cost,
    ref_type: str(formData, 'ref_type') ?? 'packing_slip', ref_label: str(formData, 'ref_label'), note: str(formData, 'note'), created_by: userId,
  })
  if (error) return { error: error.message }
  if (unit_cost != null) {
    // cost from the receipt beats anything else on file (RPS rule) — and keep the running average.
    await applyReceiptCost(admin, { company_id, part_id, unit_cost, qty, vendor: str(formData, 'vendor'), reference: str(formData, 'ref_label'), date: new Date().toISOString().slice(0, 10) })
  } else {
    await admin.from('parts').update({ is_stocked: true }).eq('id', part_id).eq('company_id', company_id).eq('is_stocked', false)
  }
  refresh(`/inventory/parts/${part_id}`, `/inventory/stock/${location_id}`)
  return { ok: true }
}

/** Manual adjustment (found one on the shelf, broke one, gave one away). Signed qty. */
export async function adjustStock(_s: ActionState, formData: FormData): Promise<ActionState> {
  const { company_id, id: userId, canWrite } = await requireInventory()
  if (!canWrite) return { error: 'No permission.' }
  const part_id = str(formData, 'part_id'), location_id = str(formData, 'location_id'), qty = num(formData, 'qty')
  if (!part_id || !location_id || !qty) return { error: 'Part, location and a non-zero quantity are required.' }
  const txn_type = str(formData, 'txn_type') ?? 'adjust'
  const { error } = await createAdminClient().from('inventory_transactions').insert({ company_id, txn_type, part_id, location_id, qty: txn_type === 'scrap' || txn_type === 'warranty_return' ? -Math.abs(qty) : qty, note: str(formData, 'note'), ref_type: 'manual', created_by: userId })
  if (error) return { error: error.message }
  refresh(`/inventory/stock/${location_id}`, `/inventory/parts/${part_id}`)
  return { ok: true }
}

/** TRANSFER: office → truck (or truck → truck). Two-legged: pending → picked → received. */
export async function createTransfer(_s: ActionState, formData: FormData): Promise<ActionState> {
  const { company_id, id: userId, canWrite } = await requireInventory()
  if (!canWrite) return { error: 'No permission.' }
  const from_location = str(formData, 'from_location'), to_location = str(formData, 'to_location')
  if (!from_location || !to_location || from_location === to_location) return { error: 'Choose two different locations.' }
  let lines: { part_id: string; qty: number }[] = []
  try { lines = (JSON.parse(str(formData, 'lines') ?? '[]') as { part_id?: string; qty?: number }[]).filter(l => l.part_id && Number(l.qty) > 0).map(l => ({ part_id: l.part_id!, qty: Number(l.qty) })) } catch { /* ignore */ }
  if (!lines.length) return { error: 'Add at least one part.' }
  const admin = createAdminClient()
  const { data: t, error } = await admin.from('stock_transfers').insert({ company_id, from_location, to_location, status: 'pending', requested_by: userId, note: str(formData, 'note') }).select('id').single()
  if (error || !t) return { error: error?.message ?? 'Could not create transfer.' }
  const { error: le } = await admin.from('stock_transfer_lines').insert(lines.map(l => ({ transfer_id: t.id, ...l })))
  if (le) return { error: le.message }
  refresh()
  redirect('/inventory/transfers')
}

export async function setTransferStatus(id: string, status: 'picked' | 'received' | 'cancelled'): Promise<void> {
  const { company_id, id: userId, canWrite } = await requireInventory()
  if (!canWrite) return
  const admin = createAdminClient()
  const { data: t } = await admin.from('stock_transfers').select('*, stock_transfer_lines(part_id, qty)').eq('id', id).eq('company_id', company_id).single()
  if (!t || t.status === 'received' || t.status === 'cancelled') return
  if (status === 'received') {
    // Post both legs under one group so the movement can always be traced end to end.
    const group = randomUUID()
    const rows = (t.stock_transfer_lines as { part_id: string; qty: number }[]).flatMap(l => [
      { company_id, txn_type: 'transfer_out', part_id: l.part_id, location_id: t.from_location, qty: -Number(l.qty), transfer_group: group, ref_type: 'transfer', ref_id: id, created_by: userId },
      { company_id, txn_type: 'transfer_in',  part_id: l.part_id, location_id: t.to_location,   qty:  Number(l.qty), transfer_group: group, ref_type: 'transfer', ref_id: id, created_by: userId },
    ])
    const { error } = await admin.from('inventory_transactions').insert(rows)
    if (error) return
    await admin.from('stock_transfers').update({ status, received_by: userId, received_at: new Date().toISOString() }).eq('id', id).eq('company_id', company_id)
  } else {
    await admin.from('stock_transfers').update({ status }).eq('id', id).eq('company_id', company_id)
  }
  refresh(`/inventory/stock/${t.from_location}`, `/inventory/stock/${t.to_location}`)
}

/** Min/max (and bin) for one part at one location — the truck-stock template. */
export async function setStockLevel(_s: ActionState, formData: FormData): Promise<ActionState> {
  const { canWrite } = await requireInventory()
  if (!canWrite) return { error: 'No permission.' }
  const part_id = str(formData, 'part_id'), location_id = str(formData, 'location_id')
  if (!part_id || !location_id) return { error: 'Part and location are required.' }
  const { error } = await createAdminClient().from('stock_levels').upsert({ location_id, part_id, min_qty: num(formData, 'min_qty') ?? 0, max_qty: num(formData, 'max_qty') ?? 0, bin: str(formData, 'bin') }, { onConflict: 'location_id,part_id' })
  if (error) return { error: error.message }
  refresh(`/inventory/stock/${location_id}`)
  return { ok: true }
}

/**
 * COUNT: the tech counts a truck; every line whose count differs from on-hand posts a
 * 'count' row for the difference, so the ledger stays append-only and the variance is visible.
 */
export async function postCount(locationId: string, _s: ActionState, formData: FormData): Promise<ActionState> {
  const { company_id, id: userId, canWrite } = await requireInventory()
  if (!canWrite) return { error: 'No permission.' }
  let counts: { part_id: string; counted: number }[] = []
  try { counts = (JSON.parse(str(formData, 'counts') ?? '[]') as { part_id?: string; counted?: number | string }[]).filter(c => c.part_id && c.counted !== '' && c.counted != null).map(c => ({ part_id: c.part_id!, counted: Number(c.counted) })) } catch { /* ignore */ }
  if (!counts.length) return { error: 'Enter at least one count.' }
  const admin = createAdminClient()
  const { data: onHand } = await admin.from('stock_on_hand').select('part_id, on_hand').eq('location_id', locationId)
  const have = new Map((onHand ?? []).map(r => [r.part_id, Number(r.on_hand)]))
  const rows = counts.map(c => ({ part_id: c.part_id, diff: c.counted - (have.get(c.part_id) ?? 0), counted: c.counted })).filter(r => r.diff !== 0)
    .map(r => ({ company_id, txn_type: 'count', part_id: r.part_id, location_id: locationId, qty: r.diff, ref_type: 'count', note: `counted ${r.counted}; ${str(formData, 'note') ?? 'cycle count'}`, created_by: userId }))
  if (rows.length) { const { error } = await admin.from('inventory_transactions').insert(rows); if (error) return { error: error.message } }
  refresh(`/inventory/stock/${locationId}`)
  return { ok: true }
}
