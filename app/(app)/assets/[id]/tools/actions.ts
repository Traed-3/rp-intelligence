'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { notifyRepeatToolPurchase } from '@/lib/notifications'
import {
  DEFAULT_REPEAT_WINDOW_MONTHS,
  TOOL_STATUSES,
  loadRepeatsForNewItem,
  type ToolStatus,
  type ToolType,
} from '@/lib/asset-tools'

type State = { error: string } | { ok: string } | null

function str(v: FormDataEntryValue | null) {
  return (v as string)?.trim() || null
}
function num(v: FormDataEntryValue | null) {
  if (!v || v === '') return null
  const n = parseFloat(v as string)
  return isNaN(n) ? null : n
}

async function getContext(assetId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, company_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return null
  const { data: asset } = await admin
    .from('assets')
    .select('id, unit_number')
    .eq('id', assetId)
    .eq('company_id', profile.company_id)
    .single()
  if (!asset) return null
  return { admin, profile, asset }
}

function revalidate(assetId: string) {
  revalidatePath(`/assets/${assetId}/tools`)
  revalidatePath(`/assets/${assetId}`)
  revalidatePath('/expenses')
}

export async function addToolItem(assetId: string, _state: State, formData: FormData): Promise<State> {
  const ctx = await getContext(assetId)
  if (!ctx) return { error: 'Not authenticated.' }
  const { admin, profile, asset } = ctx
  if (profile.role === 'viewer') return { error: 'View-only accounts cannot add items.' }

  const typeId = str(formData.get('type_id'))
  let type: ToolType | null = null
  if (typeId) {
    const { data } = await admin
      .from('asset_tool_types')
      .select('id, name, kind, repeat_window_months')
      .eq('id', typeId)
      .eq('company_id', profile.company_id)
      .single()
    type = data as ToolType | null
  }

  const itemName = str(formData.get('item_name')) ?? type?.name ?? null
  if (!itemName) return { error: 'Pick an item type or type what it is.' }

  const kindRaw = str(formData.get('kind'))
  const kind: 'tool' | 'supply' | 'fluid' =
    type?.kind ?? (kindRaw === 'supply' ? 'supply' : kindRaw === 'fluid' ? 'fluid' : 'tool')

  const quantity = num(formData.get('quantity')) ?? 1
  if (quantity <= 0) return { error: 'Quantity must be more than 0.' }
  const totalCost = num(formData.get('total_cost'))
  if (totalCost == null || totalCost < 0) return { error: 'Total cost is required (use 0 if unknown).' }
  const purchasedOn = str(formData.get('purchased_on'))
  if (!purchasedOn) return { error: 'Purchase date is required.' }

  const mileage = num(formData.get('mileage'))
  const vendor = str(formData.get('vendor'))
  const receiptUrl = str(formData.get('receipt_url'))
  const notes = str(formData.get('notes'))

  // One entry, two views: post the matching expense so company expense totals include it.
  let expenseId: string | null = null
  if (formData.get('record_expense') === 'on' && totalCost > 0) {
    const wantedCategory = kind === 'supply' ? 'Truck Supplies' : kind === 'fluid' ? 'Truck Fluids' : 'Truck Tools & Equipment'
    const { data: cats } = await admin
      .from('expense_categories')
      .select('id, name')
      .eq('company_id', profile.company_id)
      .eq('context', 'asset')
      .in('name', [wantedCategory, 'Truck Tools & Equipment'])
    const cat = cats?.find((c) => c.name === wantedCategory) ?? cats?.find((c) => c.name === 'Truck Tools & Equipment')

    const { data: expense, error: expErr } = await admin
      .from('expenses')
      .insert({
        company_id: profile.company_id,
        submitted_by: profile.id,
        expense_date: purchasedOn,
        amount: totalCost,
        description: `${quantity !== 1 ? `${quantity} × ` : ''}${itemName} (${asset.unit_number})`,
        vendor,
        expense_type: 'asset',
        asset_id: asset.id,
        category_id: cat?.id ?? null,
        receipt_url: receiptUrl,
        notes,
      })
      .select('id')
      .single()
    if (expErr) return { error: `Could not record the expense: ${expErr.message}` }
    expenseId = expense.id
  }

  const { data: item, error } = await admin
    .from('asset_tool_items')
    .insert({
      company_id: profile.company_id,
      asset_id: asset.id,
      type_id: type?.id ?? null,
      item_name: itemName,
      kind,
      mileage: mileage != null ? Math.round(mileage) : null,
      quantity,
      total_cost: totalCost,
      purchased_on: purchasedOn,
      vendor,
      receipt_url: receiptUrl,
      notes,
      expense_id: expenseId,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (error) {
    if (expenseId) await admin.from('expenses').delete().eq('id', expenseId)
    return { error: error.message }
  }

  // Repeat-purchase watch
  const windowMonths = type?.repeat_window_months ?? DEFAULT_REPEAT_WINDOW_MONTHS
  let flagged = ''
  if (windowMonths > 0 && kind !== 'fluid') {
    const repeats = await loadRepeatsForNewItem(admin, {
      assetId: asset.id,
      typeId: type?.id ?? null,
      itemName,
      purchasedOn,
      windowMonths,
      excludeId: item.id,
    })
    if (repeats.length > 0) {
      await notifyRepeatToolPurchase(admin, profile.company_id, {
        assetId: asset.id,
        unitNumber: asset.unit_number,
        itemName,
        windowMonths,
        newCost: totalCost,
        newDate: purchasedOn,
        previous: repeats,
      })
      flagged = ` Heads up: this was already bought for ${asset.unit_number} on ${repeats[0].purchased_on} — management has been notified.`
    }
  }

  revalidate(asset.id)
  return { ok: `Added ${itemName}.${flagged}` }
}

export async function setToolStatus(itemId: string, assetId: string, formData: FormData) {
  const ctx = await getContext(assetId)
  if (!ctx || ctx.profile.role === 'viewer') return
  const status = str(formData.get('status')) as ToolStatus | null
  if (!status || !TOOL_STATUSES.includes(status)) return
  await ctx.admin
    .from('asset_tool_items')
    .update({ status })
    .eq('id', itemId)
    .eq('asset_id', assetId)
    .eq('company_id', ctx.profile.company_id)
  revalidate(assetId)
}

export async function deleteToolItem(itemId: string, assetId: string) {
  const ctx = await getContext(assetId)
  if (!ctx || !['owner', 'manager'].includes(ctx.profile.role)) return
  const { admin, profile } = ctx
  const { data: item } = await admin
    .from('asset_tool_items')
    .select('id, expense_id')
    .eq('id', itemId)
    .eq('asset_id', assetId)
    .eq('company_id', profile.company_id)
    .single()
  if (!item) return
  await admin.from('asset_tool_items').delete().eq('id', item.id)
  if (item.expense_id) await admin.from('expenses').delete().eq('id', item.expense_id)
  revalidate(assetId)
}
