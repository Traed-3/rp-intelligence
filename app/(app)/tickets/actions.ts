'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { findSimilarOpenTicket } from '@/lib/ticket-dedup'
import { detectStatus } from '@/lib/gmail-parser'
import { applyCompletedWork } from '@/lib/fleet-service'

type ActionState = { error: string } | null

function str(val: FormDataEntryValue | null) {
  const s = (val as string)?.trim()
  return s || null
}
function bool(val: FormDataEntryValue | null) {
  return val === 'on'
}

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

// ── Create ticket ─────────────────────────────────────────────────────────────

export async function createTicket(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const title = str(formData.get('title'))
  if (!title) return { error: 'Title is required.' }

  const admin = createAdminClient()

  // Block accidental duplicates: same asset + same problem already open
  const assetId = str(formData.get('asset_id'))
  const allowDuplicate = formData.get('allow_duplicate') === 'on'
  if (assetId && !allowDuplicate) {
    const dup = await findSimilarOpenTicket(admin, profile.company_id, assetId, title)
    if (dup) {
      return { error: `Possible duplicate of ${dup.ticket_number} — “${dup.title}”. If it's the same problem, update that ticket instead. If it's genuinely different, reword the title and try again.` }
    }
  }

  // Support multiple assignees — getAll returns all values for the same key
  const assigneeIds = formData.getAll('assigned_to').map(v => (v as string).trim()).filter(Boolean)
  const primaryAssignee = assigneeIds[0] ?? null

  const { data: ticket, error } = await admin.from('repair_tickets').insert({
    company_id:    profile.company_id,
    asset_id:      str(formData.get('asset_id')),
    created_by:    profile.id,
    assigned_to:   primaryAssignee,
    title,
    description:   str(formData.get('description')),
    source:        str(formData.get('source')) ?? 'manual',
    priority:      str(formData.get('priority')) ?? 'normal',
    safety_status: str(formData.get('safety_status')) ?? 'none',
    status:        assigneeIds.length > 0 ? 'assigned' : 'new',
    parts_needed:  bool(formData.get('parts_needed')),
    parts_notes:   str(formData.get('parts_notes')),
  }).select('id').single()

  if (error) return { error: error.message }

  // Record all assignees in repair_ticket_assignments
  if (assigneeIds.length > 0 && ticket) {
    await admin.from('repair_ticket_assignments').insert(
      assigneeIds.map(id => ({
        ticket_id:   ticket.id,
        profile_id:  id,
        assigned_by: profile.id,
      }))
    )
  }

  revalidatePath('/tickets')
  redirect(`/tickets/${ticket!.id}`)
}

// ── Update ticket ─────────────────────────────────────────────────────────────

export async function updateTicket(id: string, _state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['owner', 'manager', 'shop_manager'].includes(profile.role)) {
    return { error: 'You do not have permission to edit tickets.' }
  }

  const title = str(formData.get('title'))
  if (!title) return { error: 'Title is required.' }

  const admin = createAdminClient()
  const assigneeIds = formData.getAll('assigned_to').map(v => (v as string).trim()).filter(Boolean)
  const primaryAssignee = assigneeIds[0] ?? null

  const waitingOnParts = bool(formData.get('waiting_on_parts'))
  // If waiting on parts, parts have already been ordered — clear the "needs ordering" flag
  const partsNeeded = waitingOnParts ? false : bool(formData.get('parts_needed'))

  const { error } = await admin.from('repair_tickets').update({
    asset_id:      str(formData.get('asset_id')),
    assigned_to:   primaryAssignee,
    title,
    description:   str(formData.get('description')),
    source:        str(formData.get('source')) ?? 'manual',
    priority:      str(formData.get('priority')) ?? 'normal',
    safety_status: str(formData.get('safety_status')) ?? 'none',
    parts_needed:  partsNeeded,
    parts_ordered: bool(formData.get('parts_ordered')),
    waiting_on_parts: waitingOnParts,
    parts_notes:   str(formData.get('parts_notes')),
    vendor:        str(formData.get('vendor')),
  }).eq('id', id).eq('company_id', profile.company_id)

  if (error) return { error: error.message }

  // Replace all active assignments with the new selection
  await admin.from('repair_ticket_assignments').update({ is_active: false }).eq('ticket_id', id)
  if (assigneeIds.length > 0) {
    await admin.from('repair_ticket_assignments').insert(
      assigneeIds.map(pid => ({
        ticket_id:   id,
        profile_id:  pid,
        assigned_by: profile.id,
      }))
    )
  }

  revalidatePath('/tickets')
  revalidatePath(`/tickets/${id}`)
  redirect(`/tickets/${id}`)
}

// ── Change status ─────────────────────────────────────────────────────────────

export async function changeTicketStatus(id: string, nextStatus: string) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()
  const updates: Record<string, unknown> = { status: nextStatus }

  if (nextStatus === 'waiting_parts') {
    // Sync the flag: clicking "Waiting on Parts" button means we're waiting — clear the ordering list
    updates.waiting_on_parts = true
    updates.parts_needed = false
  } else if (['in_progress', 'completed', 'closed'].includes(nextStatus)) {
    // Parts arrived / work resumed / ticket done — clear the waiting flag
    updates.waiting_on_parts = false
  }

  if (nextStatus === 'completed') {
    updates.date_completed = new Date().toISOString().split('T')[0]
    updates.completed_by = profile.id
  }

  const { data: changed } = await admin.from('repair_tickets').update(updates)
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .select('id').maybeSingle()

  // Finished oil change / state inspection → move the vehicle's dates forward
  if (nextStatus === 'completed' && changed) {
    await applyCompletedWork(admin, id, { performedBy: profile.id, companyId: profile.company_id }).catch(() => {})
    revalidatePath('/maintenance'); revalidatePath('/assets')
  }

  revalidatePath(`/tickets/${id}`)
  revalidatePath('/tickets')
}

// ── Assign ticket ─────────────────────────────────────────────────────────────

export async function assignTicket(id: string, assigneeId: string | null) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()

  // Deactivate old assignments
  await admin.from('repair_ticket_assignments')
    .update({ is_active: false })
    .eq('ticket_id', id)

  if (assigneeId) {
    await admin.from('repair_ticket_assignments').insert({
      ticket_id: id, profile_id: assigneeId, assigned_by: profile.id,
    })
    // Only bump status to "assigned" if the work hasn't started yet — don't
    // knock an in-progress / waiting-parts ticket back a step on reassignment.
    const { data: cur } = await admin.from('repair_tickets').select('status').eq('id', id).single()
    const updates: Record<string, unknown> = { assigned_to: assigneeId }
    if (['new', 'open'].includes(cur?.status ?? '')) updates.status = 'assigned'
    await admin.from('repair_tickets').update(updates).eq('id', id).eq('company_id', profile.company_id)
  } else {
    await admin.from('repair_tickets').update({ assigned_to: null })
      .eq('id', id).eq('company_id', profile.company_id)
  }

  revalidatePath('/tickets')
  revalidatePath('/dashboard'); revalidatePath('/maintenance')
  revalidatePath(`/tickets/${id}`)
}

// ── Toggle parts flags ────────────────────────────────────────────────────────

export async function togglePartsFlag(
  id: string,
  field: 'parts_needed' | 'parts_ordered' | 'waiting_on_parts',
  value: boolean
) {
  const profile = await getProfile()
  if (!profile) return

  const admin = createAdminClient()
  const updates: Record<string, unknown> = { [field]: value }
  if (field === 'waiting_on_parts' && value) {
    updates.status = 'waiting_parts'
  }
  if (field === 'waiting_on_parts' && !value) {
    // revert from waiting_parts if it was set
    const { data } = await admin.from('repair_tickets').select('status').eq('id', id).single()
    if (data?.status === 'waiting_parts') updates.status = 'in_progress'
  }

  await admin.from('repair_tickets').update(updates)
    .eq('id', id).eq('company_id', profile.company_id)

  revalidatePath(`/tickets/${id}`)
}

// ── Delete ticket (owner / manager only) ───────────────────────────────────────

export async function deleteTicket(id: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !['owner', 'manager'].includes(profile.role)) return

  const admin = createAdminClient()

  // Remove dependent rows first so FK constraints don't block the delete
  await admin.from('repair_ticket_comments').delete().eq('ticket_id', id)
  await admin.from('repair_ticket_attachments').delete().eq('ticket_id', id)
  await admin.from('repair_ticket_assignments').delete().eq('ticket_id', id)
  await admin.from('labor_entries').delete().eq('ticket_id', id)
  // Detach any imported emails that point at this ticket
  await admin.from('gmail_imports').update({ converted_ticket_id: null, status: 'pending' }).eq('converted_ticket_id', id)
  // Clear it from any employee's "currently working on" pointer
  await admin.from('employee_statuses').update({ current_ticket_id: null }).eq('current_ticket_id', id)

  await admin.from('repair_tickets').delete().eq('id', id).eq('company_id', profile.company_id)

  revalidatePath('/tickets')
  revalidatePath('/dashboard'); revalidatePath('/maintenance')
  redirect('/tickets')
}

// ── Add comment ───────────────────────────────────────────────────────────────

export async function addComment(_state: ActionState, formData: FormData): Promise<ActionState> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const ticketId = str(formData.get('ticket_id'))
  const comment = str(formData.get('comment'))
  if (!comment) return { error: 'Comment cannot be empty.' }

  const admin = createAdminClient()
  const { error } = await admin.from('repair_ticket_comments').insert({
    ticket_id:   ticketId,
    author_id:   profile.id,
    comment,
    is_internal: bool(formData.get('is_internal')),
  })

  if (error) return { error: error.message }

  // Auto-flag state from comment text. Keeps the dashboard accurate when staff
  // write notes like "need to order one" or "complete" instead of clicking a
  // status button. Same rule lives in lib/gmail-sync.ts for incoming emails.
  const detected = detectStatus(comment)
  const shouldReact = detected.isComplete || detected.partsReceived || detected.partsOrdered || detected.partsNeeded
  if (shouldReact) {
    const { data: cur } = await admin
      .from('repair_tickets')
      .select('status')
      .eq('id', ticketId)
      .eq('company_id', profile.company_id)
      .maybeSingle()

    const finalized = cur && ['completed', 'closed', 'deferred'].includes(cur.status)
    if (cur && !finalized) {
      const updates: Record<string, unknown> = {}
      // "complete" wins — closes the ticket and records who wrote it
      if (detected.isComplete) {
        updates.status           = 'completed'
        updates.date_completed   = new Date().toISOString().split('T')[0]
        updates.completed_by     = profile.id
        if (comment.trim()) updates.completion_notes = comment.trim().slice(0, 1000)
      } else if (detected.partsReceived) {
        updates.parts_needed     = false
        updates.parts_ordered    = true
        updates.waiting_on_parts = false
      } else if (detected.partsOrdered) {
        updates.parts_needed     = false
        updates.parts_ordered    = true
        updates.waiting_on_parts = true
        if (['new', 'open', 'assigned'].includes(cur.status)) updates.status = 'waiting_parts'
      } else {
        updates.parts_needed     = true
        updates.waiting_on_parts = true
        if (['new', 'open', 'assigned'].includes(cur.status)) updates.status = 'waiting_parts'
      }
      await admin.from('repair_tickets').update(updates)
        .eq('id', ticketId).eq('company_id', profile.company_id)
      if (detected.isComplete && ticketId) {
        await applyCompletedWork(admin, ticketId, { text: comment, performedBy: profile.id, companyId: profile.company_id }).catch(() => {})
      }
      revalidatePath('/tickets')
      revalidatePath('/dashboard'); revalidatePath('/maintenance')
    }
  }

  revalidatePath(`/tickets/${ticketId}`)
  return null
}
