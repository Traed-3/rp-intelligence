/**
 * Construction focus dashboard — the five tiles the department is run from.
 * They mirror the Job List legend in Trae's "1 - Master schedule.xlsm" (same
 * stage names and fill colors) and answer one question each:
 *
 *   needs_scheduled   open projects / heavy-maintenance calls that need to be scheduled and completed
 *   parts_in          material has arrived and the job is waiting for a slot on the schedule
 *   in_progress       crews are on it now
 *   started           work began but the job is parked (on hold, return trip needed, start date passed with no movement)
 *   needs_invoicing   field work complete, waiting on close-out / final invoice
 *
 * Everything here is pure: it takes the rows the page already loads and returns
 * the tile lists, so the rules are easy to read and easy to change.
 *
 * "Parts are here" (Trae, 9/30/26): when material is received the warehouse emails
 * econstruction a packing slip, subject "<site> <VENDOR> PACKING SLIP". The billing
 * inbox sync files those as billing_inbox_documents.kind = 'packing_slip', so a slip
 * for the job's site received on/after the job came in means the parts are on the shelf.
 */
import { classifySite } from '@/lib/site-number'

export type FocusJob = {
  id: string
  site_number: string | null
  job_number?: string | null
  work_order_number: string | null
  stage: string
  status_detail: string | null
  scope_of_work: string | null
  gas_brand: string | null
  priority: string | null
  date_received: string | null
  project_start_date: string | null
  updated_at: string | null
  customer_name?: string | null
  /** set by buildFocusTiles: why the job sits on its tile (e.g. "Packing slip 9/29 · Morgan Brothers") */
  signal?: string | null
}

export type PackingSlip = {
  id: string; subject: string; received_at: string; vendor: string | null; site_key: string | null; status: string; note: string | null
  /** the slip, a reply or the note says stock ("Stock. Give to PW", "CONSTRUCTION STOCK") */
  stock: boolean
  /** texts of the replies in the slip's Gmail thread, oldest first (billing_inbox_documents.thread_replies) */
  replies: string[]
}

export type MaterialTally = { total: number; needed: number; ordered: number; received: number; in_stock: number }

export type FocusTileKey = 'needs_scheduled' | 'parts_in' | 'in_progress' | 'started' | 'needs_invoicing'

export const FOCUS_TILES: {
  key: FocusTileKey
  title: string
  blurb: string
  /** stage the "view all" link filters on (the jobs table takes one stage) */
  linkStage: string
  /** exact fill + font color of the matching legend cell in 1 - Master schedule.xlsm (Job List, B1:D4) */
  band: string
}[] = [
  { key: 'needs_scheduled', title: 'Needs Scheduled',        blurb: 'Open projects and heavy-maintenance calls that need a date and a crew.', linkStage: 'needs_scheduled', band: 'rp-stage rp-stage-needs-scheduled' },
  { key: 'parts_in',        title: 'Parts In, Waiting to Schedule', blurb: 'Material has been ordered and is here. Put it on the calendar.',   linkStage: 'material_ordering', band: 'rp-stage rp-stage-material-ordering' },
  { key: 'in_progress',     title: 'In Progress',            blurb: 'Crews are on these now.',                                             linkStage: 'in_progress', band: 'rp-stage rp-stage-in-progress' },
  { key: 'started',         title: 'Started, Not Complete',  blurb: 'Work began but the job is parked: on hold, return trip, or the start date passed.', linkStage: 'on_hold', band: 'rp-stage rp-stage-on-hold' },
  { key: 'needs_invoicing', title: 'Complete, Needs Invoicing', blurb: 'Field work is done. Close out and send the final invoice.',      linkStage: 'invoicing', band: 'rp-stage rp-stage-invoicing' },
]

export function emptyTally(): MaterialTally {
  return { total: 0, needed: 0, ordered: 0, received: 0, in_stock: 0 }
}

/** Fold con_job_materials rows into one tally per job. */
export function tallyMaterials(rows: { job_id: string; status: string | null }[]): Map<string, MaterialTally> {
  const map = new Map<string, MaterialTally>()
  for (const r of rows) {
    const t = map.get(r.job_id) ?? emptyTally()
    t.total += 1
    if (r.status === 'needed') t.needed += 1
    else if (r.status === 'ordered') t.ordered += 1
    else if (r.status === 'received') t.received += 1
    else if (r.status === 'in_stock') t.in_stock += 1
    map.set(r.job_id, t)
  }
  return map
}

/** Normalize a job's site number the way classifySite does, so slips and jobs compare equal. "45967/58802" yields both keys. */
export function jobSiteKeys(site: string | null | undefined): string[] {
  if (!site) return []
  return site.split('/').map(part => classifySite(part.trim()).siteNumber).filter(Boolean)
}

/**
 * Pull the site number out of a packing-slip email.
 * The warehouse convention is a leading site token: "46619 MORGAN METAL PACKING SLIP", "SU-4710 ICON PACKING SLIP".
 * The body is trusted only for a prefixed key (SU-8605, IP295) or an explicit "site 24234" / "store #24234".
 * Never the PO number: Shannon's POs are five digits too (24195, 24217, 24220, 24234 …) and would collide with store numbers.
 */
export function packingSlipSiteKey(subject: string, bodyPreview?: string | null, replies: string[] = []): string | null {
  const head = subject.replace(/^\s*((re|fwd?):\s*)+/i, '')
  const lead = head.match(/^\s*((?:SU|IP|CP|CPG)[\s-]?\d{3,5}|\d{5}|\d{4})\b/i)
  if (lead) return classifySite(lead[1]).siteNumber || null
  const body = bodyPreview ?? ''
  const prefixed = body.match(/\b((?:SU|IP)[\s-]?\d{3,5})\b/i)
  if (prefixed) return classifySite(prefixed[1]).siteNumber || null
  const explicit = body.match(/\b(?:site|store|job)\s*#?\s*(\d{4,5})\b/i)
  if (explicit) return classifySite(explicit[1]).siteNumber || null
  // a prefixed key anywhere in the thread beats a bare number anywhere in the thread
  for (const r of replies) { const k = replySiteKey(r, 'prefixed'); if (k) return k }
  for (const r of replies) { const k = replySiteKey(r); if (k) return k }
  return null
}

/**
 * Site named in a thread reply: "SU-8605 material", "SU-4710 is the order off PO # 24220", "goes to 40013".
 * Questions ("What site is 54080 PO# for?") are not answers and are skipped. PO / S.O. / order numbers and
 * "the 54080 is their order number" are blanked first. A bare five-digit number counts only when it is the only
 * one left, so "either 40013 or 40041" stays unresolved for a human.
 */
export function replySiteKey(text: string, mode: 'any' | 'prefixed' = 'any'): string | null {
  if (/\?/.test(text)) return null
  const t = text
    .replace(/\b(?:P\.?O\.?|S\.?O\.?|order|inv(?:oice)?)\s*#?\s*:?\s*\d+/gi, ' ')   // "PO # 24220", "S.O. 54080"
    .replace(/(?<![A-Za-z]-?)\b\d{3,}\s*(?:P\.?O\.?|S\.?O\.?)\s*#?/gi, ' ')          // "54080 PO#" (not the 4710 in "SU-4710")
    .replace(/(?<![A-Za-z]-?)\b\d{3,}\b(?=\s+is\s+(?:their|the|our)\s+(?:\w+\s+){0,2}?(?:order|po|s\.?o\.?|vendor|invoice|number)\b)/gi, ' ')  // "the 54203 is their order number", not "40013 is the site"
  const prefixed = t.match(/\b((?:SU|IP|CP|CPG)[\s-]?\d{3,5})\b/i)
  if (prefixed) return classifySite(prefixed[1]).siteNumber || null
  if (mode === 'prefixed') return null
  const bare = t.match(/\b\d{5}\b/g)
  if (bare && bare.length === 1) return classifySite(bare[0]).siteNumber || null
  return null
}

const fmtShort = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${d.getMonth() + 1}/${d.getDate()}` }

/**
 * Is the material for this job on the shelf, so the only thing left is a schedule slot?
 * Returns the reason when yes (shown on the tile), null when no.
 *   1. A packing slip for the site reached econstruction on/after the job came in (the rule Trae gave 9/30/26).
 *   2. Every Materials row on the job is received / in stock.
 *   3. The status text says so ("received", "ready to schedule", "parts here") and does not say "waiting" / "ordered" / "ship".
 */
export function partsAreHere(job: FocusJob, tally: MaterialTally, slips: PackingSlip[]): string | null {
  const keys = jobSiteKeys(job.site_number)
  const since = job.date_received ?? '1970-01-01'
  const slip = slips
    .filter(sl => sl.site_key && keys.includes(sl.site_key) && sl.received_at.slice(0, 10) >= since)
    .sort((a, b) => b.received_at.localeCompare(a.received_at))[0]
  if (slip) return `Packing slip ${fmtShort(slip.received_at)}${slip.vendor ? ` · ${slip.vendor}` : ''}`
  if (tally.total > 0 && tally.needed === 0 && tally.ordered === 0) return `All ${tally.total} material line${tally.total === 1 ? '' : 's'} received`
  const text = (job.status_detail ?? '').toLowerCase()
  if (/\b(rec(?:ei|ie)ved|ready to schedule|parts (?:are )?here|arrived|in stock)\b/.test(text) && !/\b(waiting|ordered|ship(?:ping|ped|ment)?|back ?order)\b/.test(text)) return 'Status says received'
  return null
}

export function daysSince(iso: string | null | undefined, today: Date): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.floor((today.getTime() - d.getTime()) / 86_400_000))
}

const byOldestTouch = (a: FocusJob, b: FocusJob) => String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? ''))

/** Split open jobs into the five focus lists. A job appears on at most one tile. */
export function buildFocusTiles(jobs: FocusJob[], tallies: Map<string, MaterialTally>, slips: PackingSlip[], todayIso: string): Record<FocusTileKey, FocusJob[]> {
  const out: Record<FocusTileKey, FocusJob[]> = { needs_scheduled: [], parts_in: [], in_progress: [], started: [], needs_invoicing: [] }
  for (const j of jobs) {
    const tally = tallies.get(j.id) ?? emptyTally()
    if (j.stage === 'close_out' || j.stage === 'invoicing') { out.needs_invoicing.push(j); continue }
    if (j.stage === 'in_progress') { out.in_progress.push(j); continue }
    if (j.stage === 'on_hold' || j.stage === 'return_needed') { out.started.push(j); continue }
    if (j.stage === 'scheduled' && j.project_start_date && j.project_start_date < todayIso) { out.started.push(j); continue }
    if (j.stage === 'material_ordering' || j.stage === 'needs_scheduled') {
      const why = partsAreHere(j, tally, slips)
      if (why) { out.parts_in.push({ ...j, signal: why }); continue }
    }
    if (j.stage === 'needs_scheduled' || j.stage === 'scheduled') { out.needs_scheduled.push(j); continue }
    // survey / quoting / permitting / material_ordering (parts not here) / overspill stay in the pipeline chips below the tiles
  }
  for (const k of Object.keys(out) as FocusTileKey[]) out[k].sort(byOldestTouch)
  return out
}
