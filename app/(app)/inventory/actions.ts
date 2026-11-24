'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { PART_CATEGORIES } from '@/lib/inventory'

export type ActionState = { error?: string; ok?: boolean }

const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : null }
const num = (fd: FormData, k: string) => { const v = str(fd, k); if (v == null) return null; const n = Number(v.replace(/[$,]/g, '')); return isFinite(n) ? n : null }

/** Create or update a catalog part. */
export async function savePart(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const { company_id, canEditCatalog: canWrite } = await requireInventory()
  if (!canWrite) return { error: 'You do not have permission to edit parts.' }

  const description = str(formData, 'description')
  if (!description) return { error: 'Description is required.' }
  const category = num(formData, 'category')
  const catMeta = PART_CATEGORIES.find(c => c.n === category)

  const row = {
    company_id,
    part_number:      str(formData, 'part_number'),
    manufacturer:     str(formData, 'manufacturer'),
    description,
    category:         category != null ? Math.round(category) : null,
    category_name:    catMeta ? `CAT ${catMeta.n} - ${catMeta.label.toUpperCase()}` : null,
    subcategory:      str(formData, 'subcategory'),
    uom:              str(formData, 'uom') ?? 'EA',
    item_type:        str(formData, 'item_type') ?? 'material',
    taxable:          catMeta ? catMeta.taxable : formData.get('taxable') === 'on',
    is_stocked:       formData.get('is_stocked') === 'on',
    unit_cost:        num(formData, 'unit_cost'),
    cost_source:      str(formData, 'cost_source'),
    cost_vendor:      str(formData, 'cost_vendor'),
    cost_invoice_ref: str(formData, 'cost_invoice_ref'),
    cost_date:        str(formData, 'cost_date'),
    price_status:     str(formData, 'price_status') ?? 'ok',
    freight_per_unit: num(formData, 'freight_per_unit') ?? 0,
    markup_pct:       num(formData, 'markup_pct'),
    sell_price:       num(formData, 'sell_price'),
    primary_vendor:   str(formData, 'primary_vendor'),
    notes:            str(formData, 'notes'),
    active:           formData.get('active') !== 'off',
  }
  if (row.unit_cost == null && row.price_status === 'ok' && row.sell_price == null) row.price_status = 'price_needed'

  const admin = createAdminClient()
  let partId = id
  if (id) {
    const { error } = await admin.from('parts').update(row).eq('id', id).eq('company_id', company_id)
    if (error) return { error: error.message }
  } else {
    const { data, error } = await admin.from('parts').insert(row).select('id').single()
    if (error) return { error: error.message }
    partId = data.id
  }

  // Any cost typed in becomes a price-history observation, so the trail stays complete.
  if (row.unit_cost != null && partId) {
    const kind = row.cost_source === 'receipt' ? 'cost_receipt' : row.cost_source === 'vendor_quote' ? 'cost_vendor_quote' : row.cost_source === 'web' ? 'cost_web' : 'cost_book'
    const { data: last } = await admin.from('part_price_history').select('price, kind').eq('part_id', partId).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!last || Number(last.price) !== row.unit_cost || last.kind !== kind) {
      await admin.from('part_price_history').insert({ part_id: partId, kind, price: row.unit_cost, vendor: row.cost_vendor, reference: row.cost_invoice_ref, observed_on: row.cost_date, source_note: 'entered in app' })
    }
  }

  revalidatePath('/inventory/parts')
  if (!id) redirect(`/inventory/parts/${partId}`)
  revalidatePath(`/inventory/parts/${id}`)
  return { ok: true }
}

export async function deletePart(id: string): Promise<void> {
  const { company_id, canEditCatalog: canWrite } = await requireInventory()
  if (!canWrite) return
  const admin = createAdminClient()
  // Parts referenced by ledger rows cannot be deleted (FK RESTRICT); deactivate instead.
  const { error } = await admin.from('parts').delete().eq('id', id).eq('company_id', company_id)
  if (error) await admin.from('parts').update({ active: false }).eq('id', id).eq('company_id', company_id)
  revalidatePath('/inventory/parts')
  redirect('/inventory/parts')
}

/** Create or update a stock location (office shelf, truck, job site, vendor RMA). */
export async function saveLocation(id: string | null, _state: ActionState, formData: FormData): Promise<ActionState> {
  const { company_id, canWrite } = await requireInventory()
  if (!canWrite) return { error: 'You do not have permission to edit locations.' }
  const name = str(formData, 'name')
  if (!name) return { error: 'Name is required.' }
  const row = {
    company_id, name,
    kind:          str(formData, 'kind') ?? 'office',
    department:    str(formData, 'department') ?? 'shared',
    asset_id:      str(formData, 'asset_id'),
    technician_id: str(formData, 'technician_id'),
    active:        formData.get('active') !== 'off',
  }
  const admin = createAdminClient()
  const q = id
    ? admin.from('stock_locations').update(row).eq('id', id).eq('company_id', company_id)
    : admin.from('stock_locations').insert(row)
  const { error } = await q
  if (error) return { error: error.message.includes('duplicate') ? 'A location with that name already exists.' : error.message }
  revalidatePath('/inventory/locations')
  return { ok: true }
}

export async function setLocationActive(id: string, active: boolean): Promise<void> {
  const { company_id, canWrite } = await requireInventory()
  if (!canWrite) return
  await createAdminClient().from('stock_locations').update({ active }).eq('id', id).eq('company_id', company_id)
  revalidatePath('/inventory/locations')
}
