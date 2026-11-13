'use server'

import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { applyReceiptCost } from '@/lib/inventory-costing'
import { syncAllInboxes, extractPending, extractDocument } from '@/lib/billing-inbox-sync'
import type { ActionState } from './actions'

export type SyncState = ActionState & { summary?: string }

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null }
function refresh(id?: string) {
  for (const p of ['/inventory', '/inventory/receive', '/inventory/receive/queue', '/inventory/stock', '/settings']) revalidatePath(p)
  if (id) revalidatePath(`/inventory/receive/queue/${id}`)
}

/** Manual "sync now": pull the last two weeks from every connected inbox, then read a few pending documents. */
export async function runInboxSync(): Promise<SyncState> {
  const { canEditCatalog } = await requireInventory()
  if (!canEditCatalog) return { error: 'No permission.' }
  try {
    const sync = await syncAllInboxes({ maxResults: 30, sinceDays: 14 })
    const ex = await extractPending(3)
    refresh()
    if (!sync.length) return { ok: true, summary: 'No inboxes are connected yet — see Settings → Billing inboxes.' }
    const per = sync.map(s => `${s.inbox}: ${s.new} new of ${s.listed}${s.errors.length ? ` (${s.errors.length} error${s.errors.length > 1 ? 's' : ''}: ${s.errors[0].slice(0, 80)})` : ''}`)
    return { ok: true, summary: `${per.join(' · ')} · read ${ex.ok}/${ex.processed} document${ex.processed === 1 ? '' : 's'}` }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** Ask Claude to read this document (again). */
export async function reextractDocument(id: string): Promise<ActionState> {
  const { company_id, canEditCatalog } = await requireInventory()
  if (!canEditCatalog) return { error: 'No permission.' }
  const admin = createAdminClient()
  await admin.from('billing_inbox_documents').update({ extract_status: 'pending', extract_error: null }).eq('id', id).eq('company_id', company_id)
  const r = await extractDocument(id)
  refresh(id)
  return r.ok ? { ok: true } : { error: r.error ?? 'Extraction failed' }
}

export async function dismissDocument(id: string, _s: ActionState, formData: FormData): Promise<ActionState> {
  const { company_id, id: userId, canEditCatalog } = await requireInventory()
  if (!canEditCatalog) return { error: 'No permission.' }
  const admin = createAdminClient()
  const { error } = await admin.from('billing_inbox_documents').update({ status: 'dismissed', note: str(formData, 'note'), processed_by: userId, processed_at: new Date().toISOString() }).eq('id', id).eq('company_id', company_id).eq('status', 'new')
  if (error) return { error: error.message }
  refresh(id)
  return { ok: true }
}

export async function reopenDocument(id: string): Promise<ActionState> {
  const { company_id, canEditCatalog } = await requireInventory()
  if (!canEditCatalog) return { error: 'No permission.' }
  const admin = createAdminClient()
  await admin.from('billing_inbox_documents').update({ status: 'new', processed_by: null, processed_at: null }).eq('id', id).eq('company_id', company_id).eq('status', 'dismissed')
  refresh(id)
  return { ok: true }
}

type PostLine = { part_id?: string | null; part_number?: string | null; description: string; qty: number; unit_cost: number | null; include: boolean; create?: boolean }

/**
 * Confirm the extracted lines into the system.
 *   mode=receive    → +qty ledger rows on a location, costs refreshed from the paperwork
 *   mode=cost_only  → costs refreshed only (parts went straight to a job, nothing hits a shelf)
 */
export async function postInboxDocument(id: string, _s: ActionState, formData: FormData): Promise<ActionState> {
  const { company_id, id: userId, canEditCatalog } = await requireInventory()
  if (!canEditCatalog) return { error: 'You do not have permission to receive stock.' }
  const mode = str(formData, 'mode') === 'cost_only' ? 'cost_only' : 'receive'
  const location_id = str(formData, 'location_id')
  let lines: PostLine[] = []
  try { lines = JSON.parse(str(formData, 'lines') ?? '[]') } catch { return { error: 'Bad line data.' } }
  const included = lines.filter(l => l.include && Number(l.qty) > 0)
  if (!included.length) return { error: 'Tick at least one line with a quantity.' }
  if (mode === 'receive' && !location_id) return { error: 'Choose where the parts were put.' }
  const unmatched = included.filter(l => !l.part_id && !l.create)
  if (unmatched.length) return { error: `${unmatched.length} ticked line${unmatched.length > 1 ? 's have' : ' has'} no catalog part. Pick one from the catalog or tick "new part".` }

  const admin = createAdminClient()
  const { data: doc } = await admin.from('billing_inbox_documents').select('id, kind, vendor, reference, document_date, status, inbox').eq('id', id).eq('company_id', company_id).single()
  if (!doc) return { error: 'Document not found.' }
  if (doc.status !== 'new') return { error: 'This document was already processed.' }

  const today = new Date().toISOString().slice(0, 10)
  const vendor = str(formData, 'vendor') ?? doc.vendor
  const reference = str(formData, 'reference') ?? doc.reference
  const docDate = str(formData, 'document_date') ?? doc.document_date ?? today
  const refType = doc.kind === 'receipt' ? 'counter_pickup' : doc.kind === 'vendor_invoice' ? 'vendor_invoice' : 'packing_slip'
  const group = randomUUID()
  let posted = 0

  for (const l of included) {
    const qty = Number(l.qty)
    const unit_cost = l.unit_cost != null && isFinite(Number(l.unit_cost)) && Number(l.unit_cost) > 0 ? Number(l.unit_cost) : null
    let part_id = l.part_id ?? null
    if (!part_id && l.create) {
      const { data: np, error } = await admin.from('parts').insert({
        company_id, sku: 'RECEIVED_2026', part_number: l.part_number?.trim() || null, description: (l.description || l.part_number || 'Part').trim().slice(0, 200),
        category: 4, category_name: 'PUMP & TANK MATERIALS', subcategory: vendor ? `From ${vendor}` : null, item_type: 'material', taxable: true,
        is_stocked: mode === 'receive', unit_cost, cost_source: unit_cost != null ? 'receipt' : null, cost_vendor: vendor, cost_invoice_ref: reference,
        cost_date: unit_cost != null ? docDate : null, last_cost: unit_cost, avg_cost: unit_cost, price_status: unit_cost != null ? 'ok' : 'price_needed', freight_per_unit: 0,
        notes: `Created from ${doc.kind.replace('_', ' ')} email (${doc.inbox})`,
      }).select('id').single()
      if (error || !np) return { error: `Could not create part "${l.description}": ${error?.message}` }
      part_id = np.id
      if (unit_cost != null) await admin.from('part_price_history').insert({ part_id, kind: 'cost_receipt', price: unit_cost, vendor, reference, observed_on: docDate, source_note: 'first seen on paperwork' })
    }
    if (!part_id) continue

    if (mode === 'receive') {
      const { error } = await admin.from('inventory_transactions').insert({
        company_id, txn_type: 'receive', part_id, location_id, qty, unit_cost, ref_type: refType, ref_label: reference,
        note: vendor ? `from ${vendor}` : null, created_by: userId, inbox_document_id: id,
      })
      if (error) return { error: `Ledger insert failed: ${error.message}` }
      posted++
    }
    if (!l.create) {
      if (unit_cost != null) await applyReceiptCost(admin, { company_id, part_id, unit_cost, qty: mode === 'receive' ? qty : 0, vendor, reference, date: docDate, stocked: mode === 'receive' })
      else if (mode === 'receive') await admin.from('parts').update({ is_stocked: true }).eq('id', part_id).eq('company_id', company_id).eq('is_stocked', false)
    }
  }

  await admin.from('billing_inbox_documents').update({
    status: mode === 'receive' ? 'received' : 'cost_updated', location_id: mode === 'receive' ? location_id : null, txn_group: group,
    vendor, reference, document_date: docDate, note: str(formData, 'note'), processed_by: userId, processed_at: new Date().toISOString(),
  }).eq('id', id).eq('company_id', company_id)
  refresh(id)
  if (location_id) revalidatePath(`/inventory/stock/${location_id}`)
  return { ok: true }
}
