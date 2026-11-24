// ── Permits data loader + alert engine (server-side only) ──
// One round of queries builds the whole permit graph; the board and the five
// alerts are both computed from it so they never disagree.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isInHandOrLater, isPermitComplete, permitDueDate, daysUntil, businessDaysBetween,
} from './permits'

export type Jurisdiction = {
  id: string; name: string; state: string | null; is_independent_city: boolean
  requires_building_with_electrical: string; requires_mechanical_with_electrical: string
  [k: string]: unknown
}
export type Site = {
  id: string; site_number: string; name: string | null; state: string | null
  brand: string | null; jurisdiction_id: string | null; [k: string]: unknown
}
export type Project = {
  id: string; site_id: string; project_type: string; scheduled_work_date: string | null
  permit_due_date: string | null; ready_to_work: boolean; [k: string]: unknown
}
export type Permit = {
  id: string; project_id: string; permit_key: string | null; permit_type: string
  pulled_by: string; requirement_status: string; status: string; notes: string | null
  date_submitted_to_hash: string | null; updated_at: string | null; [k: string]: unknown
}
export type License = {
  contractor_name: string; state: string | null; expiration_date: string | null; [k: string]: unknown
}

export type EnrichedPermit = Permit & {
  site: Site | null
  jurisdiction: Jurisdiction | null
  project: Project | null
  dueDate: string | null
  daysUntilDue: number | null
}

export type PermitGraph = {
  permits: Permit[]
  projects: Project[]
  sites: Site[]
  jurisdictions: Jurisdiction[]
  licenses: License[]
  enrich: (p: Permit) => EnrichedPermit
  enriched: EnrichedPermit[]
}

export async function loadPermitGraph(
  admin: SupabaseClient, companyId: string,
): Promise<PermitGraph> {
  const [permitsR, projectsR, sitesR, jurR, licR] = await Promise.all([
    admin.from('con_permits').select('*').eq('company_id', companyId),
    admin.from('con_permit_projects').select('*').eq('company_id', companyId),
    admin.from('con_permit_sites').select('*').eq('company_id', companyId),
    admin.from('con_jurisdictions').select('*').eq('company_id', companyId),
    admin.from('con_contractor_licenses').select('*').eq('company_id', companyId),
  ])
  const permits = (permitsR.data ?? []) as Permit[]
  const projects = (projectsR.data ?? []) as Project[]
  const sites = (sitesR.data ?? []) as Site[]
  const jurisdictions = (jurR.data ?? []) as Jurisdiction[]
  const licenses = (licR.data ?? []) as License[]

  const projById = new Map(projects.map(p => [p.id, p]))
  const siteById = new Map(sites.map(s => [s.id, s]))
  const jurById = new Map(jurisdictions.map(j => [j.id, j]))

  const enrich = (p: Permit): EnrichedPermit => {
    const project = projById.get(p.project_id) ?? null
    const site = project ? siteById.get(project.site_id) ?? null : null
    const jurisdiction = site?.jurisdiction_id ? jurById.get(site.jurisdiction_id) ?? null : null
    const dueDate = project ? (project.permit_due_date ?? permitDueDate(project.scheduled_work_date)) : null
    return { ...p, project, site, jurisdiction, dueDate, daysUntilDue: daysUntil(dueDate) }
  }

  return {
    permits, projects, sites, jurisdictions, licenses,
    enrich, enriched: permits.map(enrich),
  }
}

// Required permits only — the default board view (25 rows on import).
export function boardPermits(graph: PermitGraph): EnrichedPermit[] {
  return graph.enriched.filter(p => p.requirement_status === 'Required')
}

// Does this contractor hold an active (unexpired) license in this state?
function hasActiveLicense(licenses: License[], contractor: string, state: string | null, now: Date): boolean {
  if (!state) return true // unknown site state — don't false-alarm
  return licenses.some(l =>
    l.contractor_name === contractor &&
    (l.state ?? '').toUpperCase() === state.toUpperCase() &&
    (!l.expiration_date || new Date(l.expiration_date) >= now))
}

export type AlertKey = 'unknown-window' | 'past-due' | 'stalled-hash' | 'license-mismatch' | 'expiring-license'

export type PermitAlert = {
  key: AlertKey
  label: string
  description: string
  permits: EnrichedPermit[]
  count: number
}

// The five checks from the plan. `hashEnteredAt` maps permit id → the time it
// last entered "Submitted to Hash" (from permit_events); falls back to updated_at.
export function computeAlerts(
  graph: PermitGraph,
  opts: { now?: Date; hashEnteredAt?: Map<string, string> } = {},
): PermitAlert[] {
  const now = opts.now ?? new Date()
  const hashEnteredAt = opts.hashEnteredAt ?? new Map()

  // group permits by project for the electrical-issued check
  const byProject = new Map<string, EnrichedPermit[]>()
  for (const p of graph.enriched) {
    const arr = byProject.get(p.project_id) ?? []
    arr.push(p); byProject.set(p.project_id, arr)
  }
  const electricalIssued = (projectId: string) =>
    (byProject.get(projectId) ?? []).some(p => p.permit_type === 'Electrical' && isInHandOrLater(p.status))

  // 1. Unknown inside the 28-day window, electrical not yet in hand.
  // A completed permit never raises an alert of any kind.
  const unknownWindow = graph.enriched.filter(p => {
    if (isPermitComplete(p.status)) return false
    if (p.requirement_status !== 'Unknown') return false
    if (electricalIssued(p.project_id)) return false
    const d = daysUntil(p.project?.scheduled_work_date, now)
    return d != null && d <= 28
  })

  // 2. Required permit past its due date and not yet in hand.
  const pastDue = graph.enriched.filter(p =>
    p.requirement_status === 'Required' &&
    !isInHandOrLater(p.status) &&
    p.daysUntilDue != null && p.daysUntilDue < 0)

  // 3. Stalled at "Submitted to Hash" more than 5 business days.
  const stalledHash = graph.enriched.filter(p => {
    if (p.status !== 'Submitted to Hash') return false
    const since = hashEnteredAt.get(p.id) ?? p.date_submitted_to_hash ?? p.updated_at
    if (!since) return false
    return businessDaysBetween(new Date(since), now) > 5
  })

  // 4. License mismatch — pulled_by has no active license in the site's state.
  const licenseMismatch = graph.enriched.filter(p => {
    if (isPermitComplete(p.status)) return false // closed out — nothing left to flag
    if (p.requirement_status === 'Not Required') return false
    if (p.pulled_by === 'Engineering Firm') return false // firm licensing tracked elsewhere
    return !hasActiveLicense(graph.licenses, p.pulled_by, p.site?.state ?? null, now)
  })

  // 5. Expiring license within 60 days — surfaced as the permits that rely on it.
  const soon = new Date(now); soon.setDate(soon.getDate() + 60)
  const expiringContractors = new Set(
    graph.licenses
      .filter(l => l.expiration_date && new Date(l.expiration_date) <= soon && new Date(l.expiration_date) >= now)
      .map(l => l.contractor_name))
  const expiringLicense = graph.enriched.filter(p =>
    p.requirement_status === 'Required' && !isPermitComplete(p.status) && expiringContractors.has(p.pulled_by))

  const mk = (key: AlertKey, label: string, description: string, permits: EnrichedPermit[]): PermitAlert =>
    ({ key, label, description, permits, count: permits.length })

  return [
    mk('unknown-window', 'Unknown permit inside the 28-day window',
       'A project starts within 28 days but still has a permit nobody has confirmed is needed, and the electrical is not in hand yet.', unknownWindow),
    mk('past-due', 'Past due',
       'A required permit is past its due date and still not in hand.', pastDue),
    mk('stalled-hash', 'Stalled at Hash',
       'A permit has sat at "Submitted to Hash" for more than five business days with no confirmation.', stalledHash),
    mk('license-mismatch', 'License mismatch',
       'A permit is assigned to a contractor with no active license in that job’s state.', licenseMismatch),
    mk('expiring-license', 'Expiring license',
       'A contractor license expires within 60 days.', expiringLicense),
  ]
}

// Last time each permit entered "Submitted to Hash", from the event log.
export async function loadHashEnteredAt(
  admin: SupabaseClient, companyId: string,
): Promise<Map<string, string>> {
  const { data } = await admin.from('con_permit_events')
    .select('permit_id, changed_at, to_status')
    .eq('company_id', companyId).eq('to_status', 'Submitted to Hash')
    .order('changed_at', { ascending: true })
  const m = new Map<string, string>()
  for (const e of data ?? []) m.set(e.permit_id as string, e.changed_at as string) // last write wins → most recent
  return m
}
