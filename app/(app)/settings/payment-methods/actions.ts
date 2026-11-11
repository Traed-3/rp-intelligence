'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

export async function addPaymentMethodDirect(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return

  const code = (formData.get('code') as string)?.trim().toUpperCase()
  const name = (formData.get('name') as string)?.trim()
  if (!code || !name) return

  await admin.from('payment_methods').insert({ company_id: profile.company_id, code, name })
  revalidatePath('/settings/payment-methods')
}

// ── Tech cards (card last-4 → code + cardholder) ─────────────────────────────

async function manager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return null
  return { admin, profile }
}

/** Add or correct a card. A person's entry is marked 'manual' so learning never overwrites it. */
export async function saveExpenseCard(formData: FormData) {
  const m = await manager()
  if (!m) return
  const last4 = String(formData.get('last4') ?? '').replace(/\D/g, '').slice(-4)
  if (last4.length !== 4) return
  const code = String(formData.get('payment_method_code') ?? 'TEC').trim().toUpperCase() || 'TEC'
  const holder = String(formData.get('holder_profile_id') ?? '').trim() || null
  const label = String(formData.get('holder_label') ?? '').trim() || null
  const now = new Date().toISOString()
  await m.admin.from('expense_cards').upsert({
    company_id: m.profile.company_id, last4, payment_method_code: code,
    holder_profile_id: holder, holder_label: holder ? null : label, source: 'manual', conflict_note: null,
    is_active: true, updated_at: now,
  }, { onConflict: 'company_id,last4' })
  revalidatePath('/settings/payment-methods')
}

export async function deleteExpenseCard(formData: FormData) {
  const m = await manager()
  if (!m) return
  const id = String(formData.get('id') ?? '')
  if (id) await m.admin.from('expense_cards').delete().eq('id', id).eq('company_id', m.profile.company_id)
  revalidatePath('/settings/payment-methods')
}

/** Read past TEC receipts from the Construction Receipts inbox and learn each card number. */
export async function learnCardsFromPastReceipts() {
  const m = await manager()
  if (!m) return
  const { backfillCardsFromInbox } = await import('@/lib/receipt-scan')
  await backfillCardsFromInbox(m.admin, m.profile.company_id, 40)
  revalidatePath('/settings/payment-methods')
}
