/**
 * Auto-creates repair tickets for overdue maintenance items.
 * Called from the dashboard. Skips if an open ticket already exists
 * for the same asset + maintenance type.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { calcDateDue, calcOilChangeDue } from '@/lib/maintenance'

type AdminClient = ReturnType<typeof createAdminClient>

const CHECKS = [
  { key: 'oil',          label: 'Oil Change',        priority: 'normal'  },
  { key: 'brakes',       label: 'Brake Inspection',  priority: 'high'    },
  { key: 'tires',        label: 'Tire Inspection',   priority: 'normal'  },
  { key: 'inspection',   label: 'State Inspection',  priority: 'high'    },
  { key: 'registration', label: 'Registration',      priority: 'normal'  },
]

export async function createOverdueMaintenanceTickets(
  admin: AdminClient,
  companyId: string
) {
  const { data: assets } = await admin
    .from('assets')
    .select(`id, unit_number, current_mileage, next_oil_change_mileage,
      next_brake_inspection_date, next_tire_inspection_date,
      inspection_due_date,
      registration_due_date,
      auto_ticket_inspection, auto_ticket_registration, auto_ticket_oil_change`)
    .eq('company_id', companyId)
    .not('status', 'in', '(retired,down,unsafe)')

  for (const asset of assets ?? []) {
    const overdueItems: { label: string; priority: string }[] = []

    const oil = calcOilChangeDue(asset.current_mileage, asset.next_oil_change_mileage)
    if (oil.status === 'overdue' && (asset as any).auto_ticket_oil_change !== false) {
      overdueItems.push({ label: 'Oil Change', priority: 'normal' })
    }

    // Per-asset toggles control which due-date types auto-create tickets
    const dateChecks = [
      { r: calcDateDue(asset.next_brake_inspection_date),  label: 'Brake Inspection', priority: 'high',   enabled: true },
      { r: calcDateDue(asset.next_tire_inspection_date),   label: 'Tire Inspection',  priority: 'normal', enabled: true },
      { r: calcDateDue(asset.inspection_due_date),         label: 'State Inspection', priority: 'high',   enabled: (asset as any).auto_ticket_inspection   !== false },
      { r: calcDateDue(asset.registration_due_date),       label: 'Registration',     priority: 'normal', enabled: (asset as any).auto_ticket_registration !== false },
    ]

    for (const { r, label, priority, enabled } of dateChecks) {
      if (!enabled) continue
      // Create tickets for anything due within the next 30 days or already overdue
      if (r.status !== 'ok' && r.status !== 'no_data') {
        overdueItems.push({ label, priority })
      }
    }

    for (const item of overdueItems) {
      // Synonyms so we don't duplicate a manually-entered ticket for the same thing
      // (e.g. a manual "Service Due" already covers the auto "Oil Change").
      const SYNONYMS: Record<string, string[]> = {
        'Oil Change':       ['oil change', 'service due', 'service needed', 'ocd'],
        'State Inspection': ['state inspection', 'inspection due', 'needs inspect', 'failed inspection', 'va inspection'],
        'Registration':     ['registration', 'tag due', 'license'],
        'Brake Inspection': ['brake'],
        'Tire Inspection':  ['tire'],
      }
      const patterns = SYNONYMS[item.label] ?? [item.label]

      // Check if an open ticket already exists for this asset + (any synonym of) type
      let existing: { id: string } | null = null
      for (const pat of patterns) {
        const { data } = await admin
          .from('repair_tickets')
          .select('id')
          .eq('asset_id', asset.id)
          .eq('company_id', companyId)
          .ilike('title', `%${pat}%`)
          .not('status', 'in', '(completed,closed,deferred)')
          .limit(1)
          .maybeSingle()
        if (data) { existing = data; break }
      }

      if (existing) continue // already has an open ticket for this (or an equivalent) item

      // Just finished one (closing it updates the vehicle's due date, but a hand-closed
      // ticket may not carry the new mileage/date) — don't re-open it straight away.
      const recentCutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
      let recentlyDone = false
      for (const pat of patterns) {
        const { data } = await admin
          .from('repair_tickets')
          .select('id')
          .eq('asset_id', asset.id)
          .eq('company_id', companyId)
          .ilike('title', `%${pat}%`)
          .in('status', ['completed', 'closed'])
          .gte('date_completed', recentCutoff)
          .limit(1)
          .maybeSingle()
        if (data) { recentlyDone = true; break }
      }
      if (recentlyDone) continue

      // Create the ticket
      await admin.from('repair_tickets').insert({
        company_id:  companyId,
        asset_id:    asset.id,
        title:       `${item.label} — ${asset.unit_number}`,
        description: `Auto-generated: ${item.label} is overdue for ${asset.unit_number}.`,
        source:      'preventive',
        priority:    item.priority,
        status:      'new',
      })
    }
  }
}
