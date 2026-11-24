'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { generateTicketNumber } from '@/lib/gmail-parser'

type Admin = ReturnType<typeof createAdminClient>

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

function canManage(role?: string) {
  return ['owner', 'manager', 'shop_manager'].includes(role ?? '')
}

async function buildTicketNumber(admin: Admin, companyId: string, date: Date, unit: string): Promise<string> {
  const m = date.getMonth() + 1
  const d = date.getDate()
  const y = date.getFullYear().toString().slice(-2)
  // All of that day's numbers — generateTicketNumber adds a dash for units like "Shop Work"
  const { data } = await admin
    .from('repair_tickets')
    .select('ticket_number')
    .eq('company_id', companyId)
    .like('ticket_number', `${m}${d}${y}%`)
  const existing = (data ?? []).map((t: any) => t.ticket_number)
  return generateTicketNumber(date, unit, existing)
}

/** Create a ticket from a pending import and mark the import converted. */
async function convert(admin: Admin, companyId: string, importId: string, assetId: string, unitNumber: string) {
  const { data: imp } = await admin.from('gmail_imports').select('*').eq('id', importId).single()
  if (!imp) return

  const payload = (imp.raw_payload ?? {}) as { title?: string; body?: string }
  const date = new Date(imp.received_at ?? Date.now())
  const ticketNumber = await buildTicketNumber(admin, companyId, date, unitNumber)

  const { data: ticket } = await admin.from('repair_tickets').insert({
    company_id:       companyId,
    asset_id:         assetId,
    ticket_number:    ticketNumber,
    title:            payload.title || imp.subject || 'Email ticket',
    description:      payload.body || imp.body_preview || null,
    source:           'gmail',
    priority:         'normal',
    status:           'open',
    gmail_message_id: imp.gmail_message_id,
    gmail_thread_id:  imp.gmail_thread_id,
    created_at:       date.toISOString(),
  }).select('id').single()

  if (!ticket) return

  await admin.from('gmail_imports')
    .update({ status: 'converted', converted_ticket_id: ticket.id, detected_asset: unitNumber })
    .eq('id', importId)
}

/** Assign a pending email to an existing asset and create its ticket. */
export async function assignImport(importId: string, assetId: string) {
  const profile = await getProfile()
  if (!profile || !canManage(profile.role)) return
  const admin = createAdminClient()

  const { data: asset } = await admin
    .from('assets').select('id, unit_number').eq('id', assetId).eq('company_id', profile.company_id).single()
  if (!asset) return

  await convert(admin, profile.company_id, importId, asset.id, asset.unit_number)
  revalidatePath('/review'); revalidatePath('/tickets'); revalidatePath('/dashboard'); revalidatePath('/maintenance')
}

/** Create a brand-new asset from the email, then create the ticket. */
export async function createAssetForImport(importId: string, unitNumber: string, assetTypeId: string) {
  const profile = await getProfile()
  if (!profile || !canManage(profile.role)) return
  const admin = createAdminClient()

  const unit = unitNumber.trim().toUpperCase()
  if (!unit) return

  // Reuse if an asset with that unit already exists
  const { data: existingAsset } = await admin
    .from('assets').select('id, unit_number').eq('company_id', profile.company_id).ilike('unit_number', unit).maybeSingle()

  let assetId = existingAsset?.id
  let finalUnit = existingAsset?.unit_number ?? unit
  if (!assetId) {
    const { data: created } = await admin.from('assets').insert({
      company_id:    profile.company_id,
      unit_number:   unit,
      status:        'active',
      asset_type_id: assetTypeId || null,
    }).select('id, unit_number').single()
    if (!created) return
    assetId = created.id
    finalUnit = created.unit_number
  }

  await convert(admin, profile.company_id, importId, assetId, finalUnit)
  revalidatePath('/review'); revalidatePath('/tickets'); revalidatePath('/dashboard'); revalidatePath('/maintenance'); revalidatePath('/assets')
}

/** Dismiss an email — no ticket created. */
export async function rejectImport(importId: string) {
  const profile = await getProfile()
  if (!profile || !canManage(profile.role)) return
  const admin = createAdminClient()
  await admin.from('gmail_imports').update({ status: 'rejected' }).eq('id', importId).eq('company_id', profile.company_id)
  revalidatePath('/review')
}
