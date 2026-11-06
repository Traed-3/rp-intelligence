// ============================================================
// Construction module — shared types, constants, money math.
// PURE module: no server-only imports, so it is safe to import
// from both server pages AND client components. The server-side
// page guard lives in lib/construction-guard.ts.
// ============================================================

// ── Access control ──────────────────────────────────────────
// TEMPORARY LOCK: while the Construction module is still being refined it is
// restricted to specific user accounts only (Trae's two logins) so that NO
// other user — including the other family "owner" accounts — can see it yet.
// Gating is by user id (which every permission check already loads) rather
// than by role, so nothing can slip through.
//
// To roll the module out to the team later, replace the body of the two
// helpers below with a role check using these lists:
//   read roles:  ['owner', 'manager', 'construction_manager', 'construction_admin', 'estimator', 'viewer']
//   write roles: ['owner', 'manager', 'construction_manager', 'construction_admin', 'estimator']
// Who may see and change construction data. Mirrors the database policies con_can_read() / con_can_write() exactly,
// so Settings → role is the one place access is decided (Trae 10/1/26, retiring the user-id lock that only let his
// two logins in). Trim CON_READ_ROLES / CON_WRITE_ROLES here if a role should wait.
export const CON_READ_ROLES: readonly string[] = ['owner', 'manager', 'construction_manager', 'construction_admin', 'estimator', 'viewer']
export const CON_WRITE_ROLES: readonly string[] = ['owner', 'manager', 'construction_manager', 'construction_admin', 'estimator']

type ConGateProfile = { id?: string | null; role?: string | null } | null | undefined

export function canReadConstruction(profile?: ConGateProfile) {
  return !!profile?.id && CON_READ_ROLES.includes(profile.role ?? '')
}
export function canWriteConstruction(profile?: ConGateProfile) {
  return !!profile?.id && CON_WRITE_ROLES.includes(profile.role ?? '')
}

export type ConProfile = { id: string; company_id: string; role: string }

// ── Pipeline stages ─────────────────────────────────────────
// Ordered the way a job moves through the shop. `className` follows the
// existing Green/Yellow/Orange/Red/Gray badge bands used elsewhere in the app.
// Stages, labels, and colors mirror the RPS Master Schedule "COLOR CODE" key
// exactly (the legend in the first rows of the workbook's Job List tab). The
// hex values are the resolved fill colors from that key, so a stage badge in
// the app reads the same as the cell color in the spreadsheet.
// Fills and font colors are the Job List legend of Trae's "1 - Master schedule.xlsm" (B1:D4), theme colors resolved:
// accent4 FFC000, accent6 70AD47 (-50% = 385624, +40% = A9CE91), accent1 4472C4 (-50% = 223962), accent2 ED7D31 (+60% = F8CBAD), accent5 5B9BD5 (+40% = 9DC3E6).
export const CON_STAGES = [
  { value: 'survey',            label: 'Survey',              className: 'bg-gray-100 text-gray-700 border border-gray-300' },
  { value: 'quoting',           label: 'Quote',               className: 'bg-[#ED7D31] text-white border border-black/10' },
  { value: 'permitting',        label: 'Permitting',          className: 'bg-[#223962] text-white border border-black/10' },
  { value: 'material_ordering', label: 'Waiting on Material', className: 'bg-[#F8CBAD] text-black border border-black/10' },
  { value: 'needs_scheduled',   label: 'Needs Scheduled',     className: 'bg-[#FFC000] text-black border border-black/10' },
  { value: 'scheduled',         label: 'Scheduled',           className: 'bg-[#385624] text-white border border-black/10' },
  { value: 'in_progress',       label: 'In-Progress',         className: 'bg-[#04FAE1] text-black border border-black/10' },
  { value: 'on_hold',           label: 'On Hold',             className: 'bg-[#C00000] text-white border border-black/10' },
  { value: 'return_needed',     label: 'Return Needed',       className: 'bg-[#FF0000] text-white border border-black/10' },
  { value: 'close_out',         label: 'Close Out/Invoice',   className: 'bg-[#7030A0] text-white border border-black/10' },
  { value: 'invoicing',         label: 'Need Invoiced',       className: 'bg-[#FFFF00] text-black border border-black/10' },
  { value: 'complete',          label: 'Complete',            className: 'bg-[#A9CE91] text-black border border-black/10' },
  { value: 'overspill_program', label: 'Overspill Program',   className: 'bg-[#9DC3E6] text-black border border-black/10' },
] as const

export const CON_STAGE_VALUES = CON_STAGES.map(s => s.value)
export const CON_OPEN_STAGES = CON_STAGE_VALUES.filter(s => s !== 'complete')

export function stageMeta(value: string) {
  return CON_STAGES.find(s => s.value === value) ?? CON_STAGES[0]
}

// ── Priorities ──────────────────────────────────────────────
export const CON_PRIORITIES = [
  { value: 'low',    label: 'Low',    className: 'bg-gray-100 text-gray-500 border-gray-200' },
  { value: 'normal', label: 'Normal', className: 'bg-slate-200 text-slate-700 border-slate-300' },
  { value: 'high',   label: 'High',   className: 'bg-orange-200 text-orange-900 border-orange-400' },
  { value: 'urgent', label: 'Urgent', className: 'bg-red-200 text-red-900 border-red-300' },
] as const

export function priorityMeta(value: string) {
  return CON_PRIORITIES.find(p => p.value === value) ?? CON_PRIORITIES[1]
}

// ── Quote / invoice statuses, money math and formatting live in the shared
// billing engine (lib/billing.ts) — Construction and Service use one copy.
import { fmtDate } from '@/lib/billing'
export {
  QUOTE_STATUSES, INVOICE_STATUSES, statusMeta,
  computeLineItem, computeDocumentTotals,
  money, pctFromDecimal, fmtDate,
} from '@/lib/billing'
export type { LineItemInput, ComputedLineItem, DocumentTotals } from '@/lib/billing'

export const MATERIAL_STATUSES = [
  { value: 'needed',   label: 'Needed',   className: 'bg-red-100 text-red-800 border-red-200' },
  { value: 'ordered',  label: 'Ordered',  className: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: 'received', label: 'Received', className: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'in_stock', label: 'In Stock', className: 'bg-green-100 text-green-800 border-green-200' },
] as const

export const NOTIFY_WINDOW_OPEN_DAYS = 7
export const NOTIFY_DEADLINE_DAYS = 3

export type NotifyState = 'sent' | 'waived' | 'no_start' | 'scheduled' | 'send_now' | 'due_soon' | 'overdue' | 'started' | 'not_applicable'

type NotifyJob = {
  project_start_date: string | null
  notification_sent_at: string | null
  notification_waived: boolean | null
  program?: string | null
}

// The Dispenser Replacement program does not send brand Project Notifications,
// so those jobs are never "due" for one.
export function programSkipsProjectNotification(program: string | null | undefined): boolean {
  return /dispenser\s*replacement/i.test(program ?? '')
}

export type NotifyStatus = {
  state: NotifyState
  label: string
  className: string
  isDue: boolean            // in window (or past) and still needs sending
  startDate: string | null
  windowOpen: string | null // YYYY-MM-DD the window opens
  deadline: string | null   // YYYY-MM-DD the notice must be sent by
  daysToDeadline: number | null
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseYmd(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function dayDiff(a: Date, b: Date) { return Math.round((a.getTime() - b.getTime()) / 86400000) }

export function projectNotificationStatus(job: NotifyJob, now = new Date()): NotifyStatus {
  const base = { startDate: job.project_start_date, windowOpen: null, deadline: null, daysToDeadline: null, isDue: false }
  if (programSkipsProjectNotification(job.program)) return { ...base, state: 'not_applicable', label: 'Not required (Dispenser Replacement)', className: 'bg-gray-100 text-gray-500 border-gray-200' }
  if (job.notification_waived) return { ...base, state: 'waived', label: 'Not required', className: 'bg-gray-100 text-gray-500 border-gray-200' }
  if (job.notification_sent_at) return { ...base, state: 'sent', label: `Sent ${fmtDate(job.notification_sent_at)}`, className: 'bg-green-100 text-green-700 border-green-200' }
  if (!job.project_start_date) return { ...base, state: 'no_start', label: 'No start date', className: 'bg-gray-100 text-gray-400 border-gray-200' }

  const start = parseYmd(job.project_start_date)
  const windowOpen = addDays(start, -NOTIFY_WINDOW_OPEN_DAYS)
  const deadline = addDays(start, -NOTIFY_DEADLINE_DAYS)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const daysToDeadline = dayDiff(deadline, today)
  const out = { startDate: job.project_start_date, windowOpen: ymd(windowOpen), deadline: ymd(deadline), daysToDeadline }

  if (today < windowOpen) {
    const opensIn = dayDiff(windowOpen, today)
    return { ...out, state: 'scheduled', isDue: false, label: `Opens in ${opensIn}d`, className: 'bg-blue-50 text-blue-700 border-blue-200' }
  }
  if (today > start) {
    // The project has already started — its notification was necessarily sent
    // beforehand, so it's never "due" anymore.
    return { ...out, state: 'started', isDue: false, label: 'Project started', className: 'bg-gray-100 text-gray-500 border-gray-200' }
  }
  if (daysToDeadline < 0) {
    return { ...out, state: 'overdue', isDue: true, label: `Overdue ${-daysToDeadline}d`, className: 'bg-red-100 text-red-700 border-red-300' }
  }
  if (daysToDeadline <= 1) {
    return { ...out, state: 'due_soon', isDue: true, label: daysToDeadline === 0 ? 'Due today' : 'Due tomorrow', className: 'bg-orange-100 text-orange-800 border-orange-300' }
  }
  return { ...out, state: 'send_now', isDue: true, label: `Send now · ${daysToDeadline}d left`, className: 'bg-amber-100 text-amber-800 border-amber-200' }
}

// ============================================================
// Document Center (Phase 1) — the 10 fixed filing categories, the
// finer real-world document-type taxonomy, and a deterministic
// classifier shared by the upload UI, the review queue, and the
// rps-doc-ingest importer (so they all agree). PURE: client-safe.
// ============================================================

// The 10 fixed filing categories — the "folders" every project has.
export const CON_DOC_CATEGORIES = [
  { value: 'permits',       label: 'Permits' },
  { value: 'quotes',        label: 'Quotes' },
  { value: 'change_orders', label: 'Change Orders' },
  { value: 'invoices',      label: 'Invoices' },
  { value: 'receipts',      label: 'Receipts' },
  { value: 'photos',        label: 'Photos' },
  { value: 'daily_updates', label: 'Daily Updates' },
  { value: 'closeout',      label: 'Closeout' },
  { value: 'health_safety', label: 'Health & Safety' },
  { value: 'other',         label: 'Other' },
] as const

export type ConDocCategory = (typeof CON_DOC_CATEGORIES)[number]['value']
export const CON_DOC_CATEGORY_VALUES = CON_DOC_CATEGORIES.map(c => c.value) as readonly string[]

export function docCategoryLabel(value: string | null | undefined) {
  return CON_DOC_CATEGORIES.find(c => c.value === value)?.label ?? 'Other'
}

// The finer real-world document types (from the SEI/Sheetz archives), each
// mapped to the fixed category it files under. `match` = lowercase keyword
// fragments the classifier scans for. Ordered specific → generic; the first
// match wins, so keep broad matches (e.g. 'permit', 'cert') last within a group.
export const CON_DOC_TYPES = [
  { value: 'completion_letter',    label: 'Completion Letter',            category: 'closeout',      match: ['completion letter','letter of completion','completion-letter','-completion'] },
  { value: 'lien_waiver',          label: 'Lien Waiver',                  category: 'closeout',      match: ['lien waiver','lien-waiver','lien'] },
  { value: 'permit_application',   label: 'Permit Application',           category: 'permits',       match: ['permit app','permit application','permit-app'] },
  { value: 'temp_closure',         label: 'Temporary Closure Fact Sheet', category: 'permits',       match: ['temp closure','temporary closure','fact sheet'] },
  { value: 'business_license',     label: 'Business License',             category: 'permits',       match: ['business license','business-license','county business'] },
  { value: 'contractors_license',  label: 'Contractors License',          category: 'permits',       match: ['contractors license','va contractors','contractor','lience'] },
  { value: 'permit',               label: 'Issued Permit',                category: 'permits',       match: ['permit'] },
  { value: 'testing_form',         label: 'Testing Form',                 category: 'closeout',      match: ['testing form','test form','spill bucket','spill containment','overfill','sump','udc'] },
  { value: 'drop_tube',            label: 'Drop Tube Verification',       category: 'closeout',      match: ['drop tube','drop-tube'] },
  { value: 'fuel_vendor_cert',     label: 'Fuel Vendor Certification',    category: 'closeout',      match: ['fuel vendor','vendor certification','certification statement'] },
  { value: 'equipment_cert',       label: 'Equipment / Mfr Cert',         category: 'closeout',      match: ['veeder','gilbarco','red jacket','xerxes','bravo','fe petro','passport','opw','cert'] },
  { value: 'project_notification', label: 'Project Notification',         category: 'closeout',      match: ['project notification','notification'] },
  { value: 'source_list',          label: 'Source List',                  category: 'closeout',      match: ['source list','source-list'] },
  { value: 'invoice_worksheet',    label: 'Invoice Work Sheet',           category: 'invoices',      match: ['invoice work sheet','work sheet','worksheet'] },
  { value: 'invoice',              label: 'Itemized Invoice',             category: 'invoices',      match: ['invoice','itemize','itemized'] },
  { value: 'packing_slip',         label: 'Packing Slip',                 category: 'receipts',      match: ['packing slip','packing-slip','packing'] },
  { value: 'receipt',              label: 'Receipt / Expense',            category: 'receipts',      match: ['receipt','expense'] },
  { value: 'change_order',         label: 'Change Order',                 category: 'change_orders', match: ['change order','change-order','chg order'] },
  { value: 'plan_notes',           label: 'Plan Notes Breakdown',         category: 'quotes',        match: ['plan notes','plan-notes','breakdown'] },
  { value: 'quote',                label: 'Quote / Bid',                  category: 'quotes',        match: ['quote','bid','proposal','estimate'] },
  // The assembled closeout package. Last of the closeout rules on purpose — a
  // lien waiver or invoice inside a "Close Out" folder keeps its own type — and
  // filename-only, so site photos in that folder stay photos.
  { value: 'closeout_package',     label: 'Closeout Package',             category: 'closeout',      match: ['close out','closeout','close-out'], filenameOnly: true },
  { value: 'photo',                label: 'Photo',                        category: 'photos',        match: ['.jpg','.jpeg','.png','.heic','.gif','img_','image','photo','pic'] },
] as const

export type ConDocTypeMeta = (typeof CON_DOC_TYPES)[number]

export function docTypeLabel(value: string | null | undefined) {
  return CON_DOC_TYPES.find(t => t.value === value)?.label ?? null
}

// Best-guess a {category, docType} from a filename (+ optional folder hint).
// Deterministic and dependency-free so the importer and the UI agree.
// `confident` is false when nothing matched, so the caller can route to review.
export function classifyDocument(
  filename: string,
  folderHint?: string | null,
): { category: ConDocCategory; docType: string | null; confident: boolean } {
  const hay = `${folderHint ?? ''} ${filename}`.toLowerCase()
  const nameOnly = filename.toLowerCase()
  for (const t of CON_DOC_TYPES) {
    const target = 'filenameOnly' in t && t.filenameOnly ? nameOnly : hay
    if (t.match.some(m => target.includes(m))) {
      return { category: t.category as ConDocCategory, docType: t.value, confident: true }
    }
  }
  return { category: 'other', docType: null, confident: false }
}

// Pull the first 3–5 digit store/job number out of a filename or folder name —
// the spine the importer matches files to jobs on. Ignores runs adjacent to
// other digits so "40037_PD" → 40037 and "Sheetz 155" → 155.
export function extractSiteNumber(name: string): string | null {
  const m = name.match(/(?<!\d)(\d{3,5})(?!\d)/)
  return m ? m[1] : null
}

// ============================================================
// DISPOSABLES (Phase 2, increment 2)
// Sourced from "Disposables Inventory 7.17.26" in Dropbox, which is the
// live list the shop actually restocks from. Sorbs appears on the printed
// form but has dropped off the current spreadsheet — kept here so a crew
// can still report it rather than lose the count.
// ============================================================
export const CON_DISPOSABLE_ITEMS = [
  { code: 'DSP-BRAKLEEN',         label: 'BrakeKleen' },
  { code: 'DSP-CATAPE',           label: 'Caution Tape' },
  { code: 'DSP-CC',               label: 'Concrete Crayons' },
  { code: 'DSP-CORRTAPE',         label: 'Corrosion Tape' },
  { code: 'DSP-DEF PIPE DOPE',    label: 'DEF Pipe Dope' },
  { code: 'DSP-6"BLADE',          label: '6" Diablo Blade' },
  { code: 'DSP-9"BLADE',          label: '9" Diablo Blade' },
  { code: 'DSP-DSPGLOVES',        label: 'Disposable Gloves' },
  { code: 'DSP-EAR',              label: 'Earplugs' },
  { code: 'DSP-ELTAPE',           label: 'Electrical Tape' },
  { code: 'DSP-EZWIRE',           label: 'EZ Pull Wire Lube' },
  { code: 'DSP-FACEMASK',         label: 'Face Masks' },
  { code: 'DSP-LEAK',             label: 'Leak Detector' },
  { code: 'DSP-MOUNTING TAPE',    label: 'Mounting Tape' },
  { code: 'DSP-OSC-BLADE',        label: 'Oscillating Blade' },
  { code: 'DSP-PBBLAST',          label: 'PB Blaster' },
  { code: 'DSP-RAZOR',            label: 'Razor Blades' },
  { code: 'DSP-SHOP-TOWEL',       label: 'Shop Towels' },
  { code: 'DSP-SMPLGREEN',        label: 'Simple Green' },
  { code: 'DSP-SORBS',            label: 'Sorbs' },
  { code: 'DSP-WHT-GREASE',       label: 'White Lithium Grease' },
  { code: 'DSP-WHITEVINEGAR',     label: 'White Vinegar' },
  { code: 'DSP-WGLOVES',          label: 'Work Gloves' },
] as const

// Paper forms the crew carries; tracked by how many copies are left.
export const CON_DISPOSABLE_FORMS = [
  'Drop Tube', "EOD Disposable's", 'HydrX', 'JSA', 'LOTO', 'PTI',
] as const

/**
 * Make a user-typed search box safe to interpolate into a PostgREST filter.
 *
 * Supabase's `.or()` takes a filter LIST as a string — commas separate
 * conditions and parentheses group them — so a search term containing either
 * can close the intended condition and append filters of its own. `%` and `_`
 * are LIKE wildcards and let a term match far more than it looks like it
 * should. None of those characters are useful in a name, email or store
 * number, so they are dropped rather than escaped.
 */
export function safeSearchTerm(raw: string | null | undefined): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[,()%_\\*"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64)
  return cleaned || null
}
