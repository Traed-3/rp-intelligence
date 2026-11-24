'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { brandFromWorkOrder, canWriteServiceTickets } from '@/lib/service-tickets'
import { extractWorkOrderDocument } from '@/lib/svc-work-order-docs-extract'

export type ActionState = { error?: string } | null

async function me() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role, full_name').eq('id', user.id).single()
  return data
}

function paths(id?: string) {
  revalidatePath('/service/tickets/inbox')
  if (id) revalidatePath(`/service/tickets/inbox/${id}`)
}

/** Save the reviewer's edited transcript and the manager-signature checkbox.
 * Ready only once both a transcript exists and the signature is confirmed —
 * the checkbox is always a deliberate human action, never inferred from the
 * AI's draft guess. */
export async function saveWorkOrderDocumentReview(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return { error: 'You do not have permission to review these.' }
  const admin = createAdminClient()

  const { data: doc } = await admin.from('svc_work_order_documents').select('status, manager_signature_verified').eq('id', id).eq('company_id', p.company_id).single()
  if (!doc || doc.status === 'linked' || doc.status === 'dismissed') return { error: 'This document is already closed out.' }

  const transcript = (formData.get('transcript') as string | null)?.trim() || null
  const verifiedNow = formData.get('manager_signature_verified') === 'on'

  const updates: Record<string, unknown> = { transcript }
  if (verifiedNow && !doc.manager_signature_verified) {
    updates.manager_signature_verified = true
    updates.verified_by = p.id
    updates.verified_at = new Date().toISOString()
  } else if (!verifiedNow) {
    updates.manager_signature_verified = false
    updates.verified_by = null
    updates.verified_at = null
  }
  updates.status = verifiedNow && transcript ? 'ready' : 'needs_review'

  const { error } = await admin.from('svc_work_order_documents').update(updates).eq('id', id).eq('company_id', p.company_id)
  if (error) return { error: error.message }
  paths(id)
  return null
}

export async function dismissWorkOrderDocument(id: string): Promise<void> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return
  const admin = createAdminClient()
  await admin.from('svc_work_order_documents').update({ status: 'dismissed', reviewed_by: p.id, reviewed_at: new Date().toISOString() }).eq('id', id).eq('company_id', p.company_id)
  paths()
  redirect('/service/tickets/inbox')
}

export async function reopenWorkOrderDocument(id: string): Promise<void> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return
  const admin = createAdminClient()
  await admin.from('svc_work_order_documents').update({ status: 'needs_review' }).eq('id', id).eq('company_id', p.company_id)
  paths(id)
}

/** Manually point a document at the right work order — for anything that
 * arrived without a matching WO# (typo, or the tech skipped the WO number). */
export async function relinkWorkOrderDocument(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return { error: 'No permission.' }
  const admin = createAdminClient()
  const q = (formData.get('site_or_wo') as string | null)?.trim()
  if (!q) return { error: 'Type a site number or WO#.' }
  const { data: wo } = await admin.from('svc_work_orders').select('id')
    .eq('company_id', p.company_id).or(`portal_wo_number.ilike.%${q}%,site_number.ilike.%${q}%`)
    .order('dispatched_at', { ascending: false }).limit(1).maybeSingle()
  if (!wo) return { error: `No work order matches "${q}".` }
  await admin.from('svc_work_order_documents').update({ work_order_id: wo.id }).eq('id', id).eq('company_id', p.company_id)
  paths(id)
  return null
}

export async function runDocumentExtraction(id: string): Promise<void> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return
  const admin = createAdminClient()
  await admin.from('svc_work_order_documents').update({ extract_status: 'pending', extract_error: null }).eq('id', id).eq('company_id', p.company_id)
  await extractWorkOrderDocument(id)
  paths(id)
}

/** The actual invoicing hand-off: a reviewed, signature-verified document
 * becomes (or attaches to) a real service ticket, carrying the transcript
 * into work_performed — the field that already becomes the invoice's
 * project description. From here the normal ticket flow (labor, parts,
 * tech/site signatures) takes over on the way to a real invoice. */
export async function createTicketFromDocument(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const p = await me()
  if (!p || !canWriteServiceTickets(p.role)) return { error: 'No permission.' }
  const admin = createAdminClient()

  const { data: doc } = await admin.from('svc_work_order_documents').select('*').eq('id', id).eq('company_id', p.company_id).single()
  if (!doc) return { error: 'Document not found.' }
  if (!doc.manager_signature_verified) return { error: "Confirm the manager's signature before sending this to invoicing." }
  if (!doc.transcript?.trim()) return { error: 'Type up the ticket before sending it on.' }

  const existingTicketId = (formData.get('existing_ticket_id') as string | null)?.trim() || null
  let ticketId = existingTicketId

  if (!ticketId) {
    if (!doc.work_order_id) return { error: 'Link this to a work order first.' }
    const { data: w } = await admin.from('svc_work_orders').select('*').eq('id', doc.work_order_id).eq('company_id', p.company_id).single()
    if (!w) return { error: 'Linked work order not found.' }

    const { data: tech } = await admin.from('svc_technicians').select('id').eq('company_id', p.company_id).eq('profile_id', p.id).maybeSingle()
    const { data: created, error } = await admin.from('service_tickets').insert({
      company_id: p.company_id, department: 'service', status: 'complete', created_by: p.id,
      work_order_id: w.id, store_number: w.site_number, csr_number: w.portal_wo_number, portal_wo_number: w.portal_wo_number,
      brand: brandFromWorkOrder(w.source_portal, w.client_name),
      site_address: w.site_address, city_state_zip: [w.site_city, w.site_state].filter(Boolean).join(', ') || null,
      problem_reported: w.description || w.subject_raw || null,
      work_performed: doc.transcript,
      technician_id: tech?.id ?? w.assigned_technician_id ?? null,
    }).select('id').single()
    if (error || !created) return { error: error?.message ?? 'Could not create the ticket.' }
    ticketId = created.id
  } else {
    const { data: existing } = await admin.from('service_tickets').select('work_performed').eq('id', ticketId).eq('company_id', p.company_id).single()
    if (!existing) return { error: 'Selected ticket not found.' }
    const merged = existing.work_performed ? `${existing.work_performed}\n\n${doc.transcript}` : doc.transcript
    await admin.from('service_tickets').update({ work_performed: merged }).eq('id', ticketId).eq('company_id', p.company_id)
  }

  await admin.from('svc_work_order_documents').update({
    status: 'linked', service_ticket_id: ticketId, reviewed_by: p.id, reviewed_at: new Date().toISOString(),
  }).eq('id', id).eq('company_id', p.company_id)

  paths(id)
  revalidatePath('/service/tickets')
  revalidatePath(`/service/tickets/${ticketId}`)
  redirect(`/service/tickets/${ticketId}`)
}
