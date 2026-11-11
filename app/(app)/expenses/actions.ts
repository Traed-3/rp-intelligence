'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { learnCardFromExpense, cleanLast4 } from '@/lib/receipt-scan'

type State = { error: string } | null

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

function str(v: FormDataEntryValue | null) { return (v as string)?.trim() || null }
function num(v: FormDataEntryValue | null) {
  if (!v || v === '') return null
  const n = parseFloat(v as string)
  return isNaN(n) ? null : n
}

// ── Create expense ────────────────────────────────────────────────────────────

export async function createExpense(_state: State, formData: FormData): Promise<State> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const amount = num(formData.get('amount'))
  if (!amount || amount <= 0) return { error: 'Amount must be more than $0.' }

  const expenseDate = str(formData.get('expense_date'))
  if (!expenseDate) return { error: 'Date is required.' }

  const expenseType = str(formData.get('expense_type')) ?? 'general'
  const admin = createAdminClient()

  // Resolve payment method id from code
  const pmCode = str(formData.get('payment_method_code'))
  let pmId: string | null = null
  if (pmCode) {
    const { data: pm } = await admin
      .from('payment_methods')
      .select('id')
      .eq('company_id', profile.company_id)
      .eq('code', pmCode.toUpperCase())
      .maybeSingle()
    pmId = pm?.id ?? null
  }

  const cardLast4 = cleanLast4(formData.get('card_last4'))
  let aiExtracted: unknown = null
  try { const raw = str(formData.get('ai_extracted')); aiExtracted = raw ? JSON.parse(raw) : null } catch { aiExtracted = null }
  const aiFilled = (str(formData.get('ai_filled')) ?? '').split(',').map(x => x.trim()).filter(Boolean)

  const { data: expense, error } = await admin.from('expenses').insert({
    company_id:          profile.company_id,
    submitted_by:        profile.id,
    expense_date:        expenseDate,
    amount,
    description:         str(formData.get('description')),
    vendor:              str(formData.get('vendor')),
    expense_type:        expenseType,
    asset_id:            expenseType === 'asset' ? str(formData.get('asset_id')) : null,
    store_number:        expenseType === 'store' ? str(formData.get('store_number')) : null,
    project_number:      expenseType === 'project' ? str(formData.get('project_number')) : null,
    con_job_id:          expenseType === 'project' ? str(formData.get('con_job_id')) : null,
    category_id:         str(formData.get('category_id')),
    category_custom:     str(formData.get('category_custom')),
    payment_method_id:   pmId,
    payment_method_code: pmCode?.toUpperCase() ?? null,
    // Linked shop ticket only applies to non-project expenses
    repair_ticket_id:    expenseType === 'project' ? null : str(formData.get('repair_ticket_id')),
    receipt_url:         str(formData.get('receipt_url')),
    notes:               str(formData.get('notes')),
    card_last4:          cardLast4,
    ai_extracted:        aiExtracted,
    ai_filled:           aiFilled,
  }).select('id').single()

  if (error) return { error: error.message }

  // Teach the app which card number belongs to which code/person (each tech has their own TEC card).
  await learnCardFromExpense(admin, {
    company_id: profile.company_id, last4: cardLast4, brand: str(formData.get('card_brand')),
    code: pmCode, submitted_by: profile.id,
  }).catch(() => {})

  revalidatePath('/expenses')
  redirect(`/expenses/${expense.id}`)
}

// ── Create fuel entry ─────────────────────────────────────────────────────────

export async function createFuelEntry(_state: State, formData: FormData): Promise<State> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const assetId = str(formData.get('asset_id'))
  if (!assetId) return { error: 'Asset is required.' }

  const mileage = num(formData.get('mileage'))
  if (!mileage) return { error: 'Mileage is required.' }

  const gallons = num(formData.get('gallons'))
  if (!gallons) return { error: 'Gallons is required.' }

  const totalCost = num(formData.get('total_cost'))
  const oilLevel = num(formData.get('oil_level'))

  const admin = createAdminClient()

  const { error } = await admin.from('fuel_entries').insert({
    company_id:          profile.company_id,
    asset_id:            assetId,
    submitted_by:        profile.id,
    entry_date:          str(formData.get('entry_date')) ?? new Date().toISOString().split('T')[0],
    mileage,
    gallons,
    total_cost:          totalCost,
    price_per_gallon:    totalCost && gallons ? Math.round((totalCost / gallons) * 1000) / 1000 : null,
    oil_level:           oilLevel,
    payment_method_code: str(formData.get('payment_method_code'))?.toUpperCase() ?? null,
    station_name:        str(formData.get('station_name')),
    notes:               str(formData.get('notes')),
  })

  if (error) return { error: error.message }

  // Update asset mileage if higher
  const { data: asset } = await admin
    .from('assets')
    .select('current_mileage, oil_change_interval_miles, last_oil_change_mileage')
    .eq('id', assetId)
    .single()

  if (asset && (asset.current_mileage === null || mileage > asset.current_mileage)) {
    const updates: Record<string, unknown> = { current_mileage: mileage }
    if (asset.oil_change_interval_miles && asset.last_oil_change_mileage) {
      updates.next_oil_change_mileage = asset.last_oil_change_mileage + asset.oil_change_interval_miles
    }
    await admin.from('assets').update(updates).eq('id', assetId)
  }

  // Oil level warning — notify if low (1 or 3)
  if (oilLevel && oilLevel <= 3) {
    const { data: assetInfo } = await admin
      .from('assets')
      .select('unit_number, company_id')
      .eq('id', assetId)
      .single()
    if (assetInfo) {
      await admin.from('notifications').insert({
        company_id:      assetInfo.company_id,
        type:            'oil_level_low',
        title:           `Low oil level — ${assetInfo.unit_number}`,
        message:         `Oil level reported at ${oilLevel}/9 during fuel stop. Check immediately.`,
        link:            `/assets/${assetId}`,
        related_asset_id: assetId,
      })
    }
  }

  revalidatePath('/expenses')
  revalidatePath('/expenses/fuel')
  redirect('/expenses')
}

// ── Add payment method ────────────────────────────────────────────────────────

export async function addPaymentMethod(_state: State, formData: FormData): Promise<State> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return { error: 'Access denied.' }

  const code = str(formData.get('code'))?.toUpperCase()
  const name = str(formData.get('name'))
  if (!code || code.length < 2 || code.length > 6) return { error: 'Code must be 2–6 characters.' }
  if (!name) return { error: 'Name is required.' }

  const admin = createAdminClient()
  const { error } = await admin.from('payment_methods').insert({
    company_id: profile.company_id,
    code,
    name,
  })

  if (error) return { error: error.message }
  revalidatePath('/settings/payment-methods')
  return null
}

// ── Toggle payment method active ──────────────────────────────────────────────

export async function togglePaymentMethod(id: string, isActive: boolean) {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return
  const admin = createAdminClient()
  await admin.from('payment_methods').update({ is_active: isActive }).eq('id', id)
  revalidatePath('/settings/payment-methods')
}
