'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('id, company_id, role, full_name')
    .eq('id', user.id)
    .single()
  return data
}

// ── Clock In ──────────────────────────────────────────────────────────────────

export type ClockTarget = { con_job_id?: string | null; store_number?: string | null }

/** Only accept a job from this person's company, and a sane store # format. */
async function cleanTarget(admin: ReturnType<typeof createAdminClient>, company_id: string, t?: ClockTarget) {
  let con_job_id = t?.con_job_id?.trim() || null
  if (con_job_id) {
    const { data: job } = await admin.from('con_jobs').select('id').eq('id', con_job_id).eq('company_id', company_id).maybeSingle()
    if (!job) con_job_id = null
  }
  const store = t?.store_number?.trim().toUpperCase() || null
  return { con_job_id, store_number: con_job_id || !store || !/^[A-Z0-9-]{1,12}$/.test(store) ? null : store }
}

export async function clockIn(target?: ClockTarget) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  // Make sure not already clocked in
  const { data: existing } = await admin
    .from('employee_statuses')
    .select('clock_status')
    .eq('profile_id', profile.id)
    .single()

  if (existing?.clock_status === 'clocked_in') {
    revalidatePath('/shop/clock')
    return
  }

  // Create time clock entry
  const { data: clockEntry } = await admin
    .from('time_clock_entries')
    .insert({
      company_id: profile.company_id,
      profile_id: profile.id,
      clock_in: new Date().toISOString(),
      ...(await cleanTarget(admin, profile.company_id, target)),
    })
    .select('id')
    .single()

  // Upsert employee status
  await admin.from('employee_statuses').upsert(
    {
      profile_id: profile.id,
      company_id: profile.company_id,
      clock_status: 'clocked_in',
      current_status: 'at_shop',
      status_updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' }
  )

  revalidatePath('/shop')
  revalidatePath('/shop/clock')
  revalidatePath('/dashboard'); revalidatePath('/maintenance')
}

// ── Change the job on the open clock entry (receipts default to this job) ────

export async function setClockJob(target: ClockTarget) {
  const profile = await getProfile()
  if (!profile) redirect('/login')
  const admin = createAdminClient()
  await admin.from('time_clock_entries').update(await cleanTarget(admin, profile.company_id, target))
    .eq('profile_id', profile.id).is('clock_out', null)
  revalidatePath('/shop/clock')
}

// ── Clock Out ─────────────────────────────────────────────────────────────────

export async function clockOut() {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()
  const now = new Date()

  // Find open clock entry
  const { data: clockEntry } = await admin
    .from('time_clock_entries')
    .select('id, clock_in, active_labor_entry_id')
    .eq('profile_id', profile.id)
    .is('clock_out', null)
    .order('clock_in', { ascending: false })
    .limit(1)
    .single()

  // Auto-close any active labor entry
  const { data: empStatus } = await admin
    .from('employee_statuses')
    .select('active_labor_entry_id')
    .eq('profile_id', profile.id)
    .single()

  if (empStatus?.active_labor_entry_id) {
    const { data: labor } = await admin
      .from('labor_entries')
      .select('started_at')
      .eq('id', empStatus.active_labor_entry_id)
      .single()

    if (labor) {
      const mins = Math.round((now.getTime() - new Date(labor.started_at).getTime()) / 60000)
      await admin.from('labor_entries').update({
        ended_at: now.toISOString(),
        total_minutes: mins,
        is_active: false,
        notes: 'Auto-closed on clock out',
      }).eq('id', empStatus.active_labor_entry_id)
    }
  }

  // Close the clock entry
  if (clockEntry) {
    const clockIn = new Date(clockEntry.clock_in)
    const totalMins = Math.round((now.getTime() - clockIn.getTime()) / 60000)
    await admin.from('time_clock_entries').update({
      clock_out: now.toISOString(),
      total_minutes: totalMins,
    }).eq('id', clockEntry.id)
  }

  // Upsert employee status to clocked out
  await admin.from('employee_statuses').upsert(
    {
      profile_id: profile.id,
      company_id: profile.company_id,
      clock_status: 'clocked_out',
      current_status: 'clocked_out',
      current_ticket_id: null,
      current_asset_id: null,
      current_task_note: null,
      active_labor_entry_id: null,
      status_updated_at: now.toISOString(),
    },
    { onConflict: 'profile_id' }
  )

  revalidatePath('/shop')
  revalidatePath('/shop/clock')
  revalidatePath('/dashboard'); revalidatePath('/maintenance')
}

// ── Update Status ─────────────────────────────────────────────────────────────

export async function updateStatus(
  newStatus: string,
  ticketId?: string | null,
  taskNote?: string | null
) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const admin = createAdminClient()

  await admin.from('employee_statuses').upsert(
    {
      profile_id: profile.id,
      company_id: profile.company_id,
      current_status: newStatus,
      current_ticket_id: ticketId ?? null,
      current_task_note: taskNote ?? null,
      status_updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' }
  )

  revalidatePath('/shop')
  revalidatePath('/shop/status')
  revalidatePath('/dashboard'); revalidatePath('/maintenance')
}
