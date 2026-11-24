'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { archiveThread, archiveMessage } from '@/lib/svc-gmail-client'
import { canWriteConstruction } from '@/lib/construction'
import { reconcileWorkOrders } from '@/lib/svc-reconcile'
import { woTokens } from '@/lib/svc-construction-link'

async function getProfile() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data } = await admin.from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

type ArchiveResult = { error?: string; archivedCount?: number; gmailFailures?: number }

// Archives one or many work orders at once with a single shared reason —
// updates svc_work_orders AND clears the source dispatch email out of
// rpdispatcher's inbox so the two stay in sync. The Gmail side is
// best-effort: a failure there (expired token, already archived, no id on
// an older row) never blocks the dashboard-side archive.
export async function archiveWorkOrders(ids: string[], reason: string): Promise<ArchiveResult> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const cleanIds = ids.filter(Boolean)
  if (!cleanIds.length) return { error: 'No work orders selected.' }

  const cleanReason = reason.trim()
  if (!cleanReason) return { error: 'A reason is required.' }

  const admin = createAdminClient()

  const { data: rows, error: fetchError } = await admin
    .from('svc_work_orders')
    .select('id, dispatch_gmail_message_id, dispatch_gmail_thread_id')
    .in('id', cleanIds)
    .eq('company_id', profile.company_id)

  if (fetchError) return { error: fetchError.message }
  if (!rows?.length) return { error: 'None of the selected work orders were found.' }

  let gmailFailures = 0
  await Promise.all(rows.map(async (w) => {
    try {
      if (w.dispatch_gmail_thread_id) {
        await archiveThread('dispatcher', w.dispatch_gmail_thread_id)
      } else if (w.dispatch_gmail_message_id) {
        await archiveMessage('dispatcher', w.dispatch_gmail_message_id)
      }
    } catch (err) {
      gmailFailures++
      console.error('[svc-archive] rpdispatcher archive failed for', w.id, err)
    }
  }))

  const { error: updateError, count } = await admin
    .from('svc_work_orders')
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      archived_reason: cleanReason,
      archived_by: profile.id,
    }, { count: 'exact' })
    .in('id', rows.map(r => r.id))
    .eq('company_id', profile.company_id)

  if (updateError) return { error: updateError.message }

  revalidatePath('/service')
  return { archivedCount: count ?? rows.length, gmailFailures }
}

// Undo — the dashboard-side archive is reversible even though the Gmail
// side generally isn't worth un-archiving (the message is still just a
// click away in rpdispatcher's All Mail).
export async function unarchiveWorkOrder(id: string): Promise<{ error?: string }> {
  const profile = await getProfile()
  if (!profile) return { error: 'Not authenticated.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('svc_work_orders')
    .update({ archived: false, archived_at: null, archived_reason: null, archived_by: null })
    .eq('id', id)
    .eq('company_id', profile.company_id)

  if (error) return { error: error.message }

  revalidatePath('/service')
  return {}
}

// Tie a service call to the construction job that is doing the work: puts the call's WO# on the job.
// From then on the call follows the job (completes when the job reaches close-out / invoicing / complete),
// and it is applied right away for this one call rather than waiting for the next sync tick.
export async function linkConstructionJob(workOrderId: string, jobId: string): Promise<void> {
  const profile = await getProfile()
  if (!profile || !canWriteConstruction({ id: profile.id, role: profile.role })) return

  const admin = createAdminClient()
  const { data: wo } = await admin.from('svc_work_orders').select('portal_wo_number').eq('id', workOrderId).eq('company_id', profile.company_id).single()
  const { data: job } = await admin.from('con_jobs').select('id, work_order_number').eq('id', jobId).eq('company_id', profile.company_id).single()
  if (!wo?.portal_wo_number || !job) return

  if (!woTokens(job.work_order_number).includes(wo.portal_wo_number.toUpperCase())) {
    const next = job.work_order_number?.trim() ? `${job.work_order_number.trim()} / ${wo.portal_wo_number}` : wo.portal_wo_number
    await admin.from('con_jobs').update({ work_order_number: next }).eq('id', job.id)
  }
  await reconcileWorkOrders({ dryRun: false, archivedBy: profile.id, onlyWo: wo.portal_wo_number })

  revalidatePath('/service')
  revalidatePath(`/service/${workOrderId}`)
  revalidatePath(`/construction/jobs/${jobId}`)
}
