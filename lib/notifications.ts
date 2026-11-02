/**
 * In-app notification helpers.
 * All notifications are inserted into the notifications table.
 * Deduplication: skip if same type + entity was notified in the last 20 hours.
 * Email / push delivery: driven by each user's alert_preferences row.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { calcDateDue, calcOilChangeDue } from '@/lib/maintenance'
import { projectNotificationStatus } from '@/lib/construction'
import { sendAlertEmail } from '@/lib/email'
import { sendPushNotification } from '@/lib/push'

type AdminClient = ReturnType<typeof createAdminClient>

// ── Low-level insert with dedup ───────────────────────────────────────────────

async function notify(
  admin: AdminClient,
  {
    companyId,
    recipientId,
    type,
    title,
    message,
    link,
    relatedAssetId,
    relatedTicketId,
    dedupAssetId,
  }: {
    companyId: string
    recipientId?: string | null
    type: string
    title: string
    message?: string
    link?: string
    relatedAssetId?: string | null
    relatedTicketId?: string | null
    dedupAssetId?: string
  }
): Promise<boolean> {
  // Dedup: don't re-notify for the same asset + type within 20 hours
  if (dedupAssetId) {
    const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('company_id', companyId)
      .eq('type', type)
      .eq('related_asset_id', dedupAssetId)
      .gte('created_at', cutoff)
      .limit(1)
      .maybeSingle()

    if (existing) return false
  }

  await admin.from('notifications').insert({
    company_id:        companyId,
    recipient_id:      recipientId ?? null,
    type,
    title,
    message:           message ?? null,
    link:              link ?? null,
    related_asset_id:  relatedAssetId ?? null,
    related_ticket_id: relatedTicketId ?? null,
  })

  return true
}

// ── Deliver via email + push based on user prefs ──────────────────────────────

async function deliverAlert(
  admin: AdminClient,
  {
    recipientIds,
    type,
    title,
    message,
    link,
  }: {
    recipientIds: string[]
    type: string
    title: string
    message?: string
    link?: string
  }
) {
  for (const profileId of recipientIds) {
    const [{ data: prefs }, { data: profile }] = await Promise.all([
      admin.from('alert_preferences')
        .select('email_enabled, push_enabled')
        .eq('profile_id', profileId)
        .eq('alert_type', type)
        .maybeSingle(),
      admin.from('profiles')
        .select('email')
        .eq('id', profileId)
        .single(),
    ])

    if (prefs?.email_enabled && profile?.email) {
      sendAlertEmail({ to: profile.email, subject: title, title, message: message ?? '', link }).catch(() => {})
    }

    if (prefs?.push_enabled) {
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key')
        .eq('profile_id', profileId)

      for (const sub of subs ?? []) {
        sendPushNotification(sub, { title, message: message ?? '', link }).catch(() => {})
      }
    }
  }
}

async function getManagerIds(admin: AdminClient, companyId: string): Promise<string[]> {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', companyId)
    .in('role', ['owner', 'manager', 'shop_manager'])
    .eq('is_active', true)
  return data?.map((p: { id: string }) => p.id) ?? []
}

// ── Rule: Gmail sync failure (e.g. revoked refresh token) ─────────────────────

export async function notifyGmailSyncError(
  admin: AdminClient,
  companyId: string,
  errorMessage: string,
) {
  // Dedup: at most one notification per 4 hours so the 3-min cron doesn't spam
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: existing } = await admin
    .from('notifications')
    .select('id')
    .eq('company_id', companyId)
    .eq('type', 'gmail_sync_error')
    .gte('created_at', cutoff)
    .limit(1)
    .maybeSingle()

  if (existing) return false

  const managerIds = await getManagerIds(admin, companyId)
  const title   = 'Gmail sync is broken'
  const message = `New emails are NOT being imported. Run "npm run refresh-gmail" locally and then update Vercel. (${errorMessage})`
  const link    = '/settings'

  for (const recipientId of managerIds) {
    await notify(admin, {
      companyId,
      recipientId,
      type: 'gmail_sync_error',
      title,
      message,
      link,
    })
  }

  await deliverAlert(admin, { recipientIds: managerIds, type: 'gmail_sync_error', title, message, link })
  return true
}

// ── Rule: overdue maintenance ─────────────────────────────────────────────────

export async function checkOverdueMaintenanceNotifications(
  admin: AdminClient,
  companyId: string
) {
  const { data: assets } = await admin
    .from('assets')
    .select(`id, unit_number, status,
      current_mileage, next_oil_change_mileage,
      next_brake_inspection_date, next_tire_inspection_date,
      inspection_due_date,
      registration_due_date`)
    .eq('company_id', companyId)
    .not('status', 'in', '(retired,down,unsafe)')

  const managerIds = await getManagerIds(admin, companyId)

  for (const a of assets ?? []) {
    const checks = [
      { r: calcOilChangeDue(a.current_mileage, a.next_oil_change_mileage), label: 'Oil Change' },
      { r: calcDateDue(a.next_brake_inspection_date),   label: 'Brake Inspection' },
      { r: calcDateDue(a.next_tire_inspection_date),    label: 'Tire Inspection' },
      { r: calcDateDue(a.inspection_due_date),          label: 'State Inspection' },
      { r: calcDateDue(a.registration_due_date),        label: 'Registration' },
    ]

    for (const { r, label } of checks) {
      if (r.status === 'overdue' || r.status === 'due_today') {
        const title   = `${label} overdue — ${a.unit_number}`
        const message = r.label
        const inserted = await notify(admin, {
          companyId,
          type:           'maintenance_overdue',
          title,
          message,
          link:           `/assets/${a.id}`,
          relatedAssetId: a.id,
          dedupAssetId:   `${a.id}_${label}`,
        })

        if (inserted) {
          await deliverAlert(admin, { recipientIds: managerIds, type: 'maintenance_overdue', title, message, link: `/assets/${a.id}` })
        }
      }
    }
  }
}

// ── Rule: unsafe / down asset ─────────────────────────────────────────────────

export async function notifyAssetUnsafe(
  admin: AdminClient,
  companyId: string,
  assetId: string,
  unitNumber: string,
  newStatus: string
) {
  const title   = `${unitNumber} marked ${newStatus.toUpperCase()}`
  const message = `${unitNumber} has been set to "${newStatus}" and may need immediate attention.`
  const link    = `/assets/${assetId}`

  const inserted = await notify(admin, {
    companyId,
    type:           'asset_unsafe',
    title,
    message,
    link,
    relatedAssetId: assetId,
    dedupAssetId:   assetId,
  })

  if (inserted) {
    const managerIds = await getManagerIds(admin, companyId)
    await deliverAlert(admin, { recipientIds: managerIds, type: 'asset_unsafe', title, message, link })
  }
}

// ── Rule: same tool/supply bought again for the same truck within its window ──
// Sent per manager (not company-wide) so field staff never see "why did you re-buy X?".

export async function notifyRepeatToolPurchase(
  admin: AdminClient,
  companyId: string,
  args: {
    assetId: string
    unitNumber: string
    itemName: string
    windowMonths: number
    newCost: number
    newDate: string
    previous: { purchased_on: string; total_cost: number; quantity: number }[]
  },
) {
  const { data: mgrs } = await admin
    .from('profiles')
    .select('id')
    .eq('company_id', companyId)
    .in('role', ['owner', 'manager', 'shop_manager', 'construction_manager'])
    .eq('is_active', true)
  const recipientIds = mgrs?.map((p: { id: string }) => p.id) ?? []
  if (recipientIds.length === 0) return

  const fmtDate = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const last = args.previous[0]
  const title = `Repeat purchase — ${args.itemName} for ${args.unitNumber}`
  const message =
    `${args.itemName} was bought for ${args.unitNumber} on ${fmtDate(args.newDate)} ($${args.newCost.toFixed(2)}), ` +
    `but it was already bought on ${fmtDate(last.purchased_on)} ($${last.total_cost.toFixed(2)}, qty ${last.quantity})` +
    (args.previous.length > 1 ? ` and ${args.previous.length - 1} other time${args.previous.length > 2 ? 's' : ''}` : '') +
    ` within the ${args.windowMonths}-month watch window. Find out why.`
  const link = `/assets/${args.assetId}/tools`

  for (const recipientId of recipientIds) {
    await notify(admin, {
      companyId,
      recipientId,
      type: 'repeat_purchase',
      title,
      message,
      link,
      relatedAssetId: args.assetId,
    })
  }
  await deliverAlert(admin, { recipientIds, type: 'repeat_purchase', title, message, link })
}

// ── Rule: new repair ticket ───────────────────────────────────────────────────

export async function notifyNewTicket(
  admin: AdminClient,
  companyId: string,
  ticketId: string,
  ticketNumber: string,
  assetUnit: string
) {
  const title   = `New ticket — ${ticketNumber}`
  const message = `A new repair ticket was opened for ${assetUnit}.`
  const link    = `/tickets/${ticketId}`

  const inserted = await notify(admin, {
    companyId,
    type:            'new_ticket',
    title,
    message,
    link,
    relatedTicketId: ticketId,
  })

  if (inserted) {
    const managerIds = await getManagerIds(admin, companyId)
    await deliverAlert(admin, { recipientIds: managerIds, type: 'new_ticket', title, message, link })
  }
}

// ── Rule: ticket assigned ─────────────────────────────────────────────────────

export async function notifyTicketAssigned(
  admin: AdminClient,
  companyId: string,
  ticketId: string,
  ticketNumber: string,
  assigneeId: string
) {
  const title   = `Ticket assigned — ${ticketNumber}`
  const message = `You have been assigned to repair ticket ${ticketNumber}.`
  const link    = `/tickets/${ticketId}`

  const inserted = await notify(admin, {
    companyId,
    recipientId:     assigneeId,
    type:            'ticket_assigned',
    title,
    message,
    link,
    relatedTicketId: ticketId,
  })

  if (inserted) {
    await deliverAlert(admin, { recipientIds: [assigneeId], type: 'ticket_assigned', title, message, link })
  }
}

// ── Rule: forgot to clock out ─────────────────────────────────────────────────

export async function checkForgotClockOut(
  admin: AdminClient,
  companyId: string
) {
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

  const { data: staleEntries } = await admin
    .from('time_clock_entries')
    .select('id, profile_id, clock_in')
    .eq('company_id', companyId)
    .is('clock_out', null)
    .lte('clock_in', cutoff)

  for (const e of staleEntries ?? []) {
    const hoursAgo = Math.floor((Date.now() - new Date(e.clock_in).getTime()) / 3600000)

    const yesterday = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('company_id', companyId)
      .eq('type', 'clock_out_reminder')
      .eq('recipient_id', e.profile_id)
      .gte('created_at', yesterday)
      .maybeSingle()

    if (existing) continue

    const title   = 'Did you forget to clock out?'
    const message = `You've been clocked in for ${hoursAgo}+ hours. Please go to RP Intelligence and clock out now.`
    const link    = '/shop/clock'

    await admin.from('notifications').insert({
      company_id:   companyId,
      recipient_id: e.profile_id,
      type:         'clock_out_reminder',
      title,
      message,
      link,
    })

    await deliverAlert(admin, { recipientIds: [e.profile_id], type: 'clock_out_reminder', title, message, link })
  }
}

// ── Construction: project notification reminders ──────────────────────────────
/**
 * For each construction project whose brand "Project Notification" is now due
 * to be sent (inside the 7→3 day pre-start window, or past it) and hasn't been
 * sent or waived, drop a company-wide bell notification. Deduped per job per day.
 */
export async function checkProjectNotifications(
  admin: AdminClient,
  companyId: string,
): Promise<number> {
  const { data: jobs } = await admin
    .from('con_jobs')
    .select('id, site_number, project_start_date, notification_sent_at, notification_waived, program')
    .eq('company_id', companyId)
    .not('project_start_date', 'is', null)
    .is('notification_sent_at', null)
    .eq('notification_waived', false)

  let created = 0
  const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()

  for (const job of jobs ?? []) {
    const status = projectNotificationStatus(job)
    if (!status.isDue) continue

    const link = `/construction/jobs/${job.id}`
    const { data: existing } = await admin
      .from('notifications')
      .select('id')
      .eq('company_id', companyId)
      .eq('type', 'project_notification')
      .eq('link', link)
      .gte('created_at', cutoff)
      .limit(1)
      .maybeSingle()
    if (existing) continue

    const title = status.state === 'overdue'
      ? `Project notification OVERDUE — ${job.site_number ?? 'site'}`
      : `Send project notification — ${job.site_number ?? 'site'}`
    const message = `Project starts ${job.project_start_date}. The brand notification must be sent by ${status.deadline}.`

    await admin.from('notifications').insert({
      company_id: companyId,
      recipient_id: null,
      type: 'project_notification',
      title,
      message,
      link,
    })
    created++
  }

  return created
}
