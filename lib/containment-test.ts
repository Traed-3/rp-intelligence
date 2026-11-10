/**
 * Sump / UDC / spill bucket integrity tests filled on the phone at the site. The site's state decides which agency form
 * the finished PDF is printed on:
 *   MD → MDE "Maryland Catchment Basin and Containment Sump Test Report" (March 2017, 3 items per page)
 *   VA → DEQ "Triennial UST Spill Bucket Integrity Testing" + "Triennial UST Containment Sump / UDC Integrity Testing" (3/2023)
 *   WV → WVDEP "Spill and Overfill Testing Report Form" §C (rev 8/5/2019) + "Miscellaneous Testing Report Form" §C (sumps/UDC)
 * PURE module: option lists, labels, state detection and the shapes the form, the PDF and the actions share.
 */

export type TestState = 'MD' | 'VA' | 'WV'
export type ItemKind = 'spill_bucket' | 'stage1_bucket' | 'udc' | 'stp' | 'tank_top' | 'transition' | 'vent_riser' | 'other'
export type YNA = 'yes' | 'no' | 'na'

export const STATES: { value: TestState; label: string; agency: string; form: string }[] = [
  { value: 'MD', label: 'Maryland', agency: 'MDE', form: 'MDE Catchment Basin and Containment Sump Test Report' },
  { value: 'VA', label: 'Virginia', agency: 'DEQ', form: 'DEQ Triennial Spill Bucket / Containment Sump Integrity Testing' },
  { value: 'WV', label: 'West Virginia', agency: 'WVDEP', form: 'WVDEP Spill Testing + Miscellaneous (Sump/UDC) Testing Report' },
]
export const stateInfo = (s: string | null | undefined) => STATES.find(x => x.value === s) ?? STATES[1]

/** Every bucket/sump kind the three forms name (MDE lists them all; VA/WV group them into bucket vs sump). */
export const ITEM_KINDS: { value: ItemKind; label: string; group: 'bucket' | 'sump'; numbers: string[] }[] = [
  { value: 'spill_bucket', label: 'Spill bucket', group: 'bucket', numbers: ['RUL', 'PUL', 'MUL', 'DSL', 'RUL 2', 'PUL 2', 'DSL 2', 'KERO', 'E85'] },
  { value: 'stage1_bucket', label: 'Stage I (vapor) bucket', group: 'bucket', numbers: ['RUL VAP', 'PUL VAP', 'MUL VAP', 'VAP'] },
  { value: 'udc', label: 'Dispenser sump (UDC)', group: 'sump', numbers: ['1/2', '3/4', '5/6', '7/8', '9/10', '11/12', '13/14', '15/16', '17/18', '19/20'] },
  { value: 'stp', label: 'STP sump', group: 'sump', numbers: ['RUL', 'PUL', 'MUL', 'DSL', 'RUL 2', 'PUL 2', 'DSL 2', 'KERO', 'E85'] },
  { value: 'tank_top', label: 'Tank top sump', group: 'sump', numbers: ['RUL', 'PUL', 'DSL'] },
  { value: 'transition', label: 'Transition sump', group: 'sump', numbers: ['TS-1', 'TS-2', 'TS-3'] },
  { value: 'vent_riser', label: 'Vent riser sump', group: 'sump', numbers: ['Vent'] },
  { value: 'other', label: 'Other', group: 'sump', numbers: [] },
]
export const kindInfo = (k: string | null | undefined) => ITEM_KINDS.find(x => x.value === k) ?? ITEM_KINDS[0]
export const isBucket = (k: string | null | undefined) => kindInfo(k).group === 'bucket'

export const METHODS = [{ value: 'hydrostatic', label: 'Hydrostatic' }, { value: 'vacuum', label: 'Vacuum' }, { value: 'pressure', label: 'Pressure' }, { value: 'other', label: 'Other' }] as const
export const METHOD_BY = [{ value: 'manufacturer', label: 'Manufacturer' }, { value: 'industry', label: 'Industry standard (PEI RP1200)' }, { value: 'other', label: 'Other' }] as const
export const REASONS = [{ value: 'routine', label: 'Required routine test' }, { value: 'suspected', label: 'Suspected release' }, { value: 'install', label: 'Installation / repair' }, { value: 'other', label: 'Other' }] as const
export const CERT_TYPES: Record<TestState, { value: string; label: string }[]> = {
  MD: [{ value: 'mde_tech', label: 'MDE Technician' }, { value: 'mde_inspector', label: 'MDE Inspector' }, { value: 'precision', label: 'Precision Tester' }],
  VA: [{ value: 'tester', label: 'Tester' }],
  WV: [{ value: 'wvdep', label: 'WVDEP Certified Worker' }],
}
export const INSTALL_TYPES = [{ value: 'direct', label: 'Direct bury' }, { value: 'direct_liner', label: 'Direct bury w/ liner' }, { value: 'sump', label: 'In containment sump' }] as const

export type TestRow = {
  id: string; company_id: string; job_id: string | null; site_id: string | null; state: TestState
  site_number: string | null; facility_name: string | null; facility_id: string | null; address: string | null; city: string | null; zip: string | null; county: string | null
  facility_contact: string | null; contact_phone: string | null
  owner_name: string | null; owner_address: string | null; owner_city: string | null; owner_state: string | null; owner_zip: string | null; owner_phone: string | null
  test_date: string; weather: string | null; temperature: string | null
  tester_name: string | null; tester_cert: string | null; tester_cert_type: string | null; tester_phone: string | null; tester_email: string | null
  method_by: string | null; method_other: string | null; test_equipment: string | null; equipment_precision: string | null; gauge_range: string | null
  reason: string | null; reason_other: string | null; sump_test_kind: 'full' | 'low_level'
  signature: string | null; signed_at: string | null; comments: string | null; next_due: string | null
  status: 'draft' | 'complete' | 'sent'; pdf_document_id: string | null; pdf_path: string | null; sent_to: string | null; sent_at: string | null
  created_by: string | null; created_at: string; updated_at: string
}
export type ItemRow = {
  id: string; test_id: string; sort_order: number; kind: ItemKind; label: string | null; kind_other: string | null
  tank_size: string | null; product: string | null; manufacturer: string | null
  construction: 'sw' | 'dw' | null; install_type: 'direct' | 'direct_liner' | 'sump' | null; material: 'frp' | 'plastic' | null; installed_after_2008: boolean | null
  method: 'hydrostatic' | 'vacuum' | 'pressure' | 'other' | null
  debris_removed: boolean | null; visual: 'pass' | 'fail' | null; riser_cap: YNA | null; drain_valve: YNA | null
  depth: string | null; penetration_height: string | null; wait_minutes: string | null
  start_time: string | null; start_reading: string | null; end_time: string | null; end_reading: string | null; level_change: string | null; threshold: string | null
  ist_start_time: string | null; ist_start_reading: string | null; ist_end_time: string | null; ist_end_reading: string | null
  sensor_restored: YNA | null; sensor_low: boolean | null; sensor_alarmed: boolean | null; sensor_shutoff: YNA | null; alarm_level: string | null
  result: 'pass' | 'fail' | null; failure_reported_at: string | null; notes: string | null
}

/** Item fields the form posts as plain text (everything not a choice). */
export const ITEM_TEXT_FIELDS = ['label', 'kind_other', 'tank_size', 'product', 'manufacturer', 'depth', 'penetration_height', 'wait_minutes', 'start_time', 'start_reading', 'end_time', 'end_reading', 'level_change', 'threshold', 'ist_start_time', 'ist_start_reading', 'ist_end_time', 'ist_end_reading', 'alarm_level', 'failure_reported_at', 'notes'] as const
export const HEADER_TEXT_FIELDS = ['site_number', 'facility_name', 'facility_id', 'address', 'city', 'zip', 'county', 'facility_contact', 'contact_phone', 'owner_name', 'owner_address', 'owner_city', 'owner_state', 'owner_zip', 'owner_phone', 'test_date', 'weather', 'temperature', 'tester_name', 'tester_cert', 'tester_cert_type', 'tester_phone', 'tester_email', 'method_by', 'method_other', 'test_equipment', 'equipment_precision', 'gauge_range', 'reason', 'reason_other', 'comments', 'next_due'] as const

/** The state-specific pass/fail rule printed next to the readings (and used to suggest a result). */
export function thresholdFor(state: TestState, kind: ItemKind, method: string | null): string {
  if (method === 'vacuum' || method === 'pressure') return state === 'WV' ? 'No loss' : (state === 'VA' && isBucket(kind) ? 'Hold 26" WC 1 min (SW) / 12" WC (DW)' : 'No change')
  return '1/8"'
}
/** What the tech is told on screen for the fill level before the clock starts. */
export function fillRule(state: TestState, kind: ItemKind): string {
  if (isBucket(kind)) return state === 'VA' ? 'Fill to within 1.5" of the top of the bucket. 1 hour. A drop of 1/8" or more fails.' : 'Fill the bucket, wait, then 1 hour. A drop of 1/8" or more fails.'
  if (state === 'MD') return 'Fill 4" above the highest penetration or seam. 1 hour. A drop of 1/8" or more fails. Report a failure to MDE within 2 hours.'
  return 'Fill at least 4" above the highest penetration or sidewall seam, stand 15 min, then 1 hour. A drop of 1/8" or more fails.'
}

/** Change between start and end readings when both are plain numbers (inches, psi, " WC); otherwise leave it to the tech. */
export function computeChange(start: string | null | undefined, end: string | null | undefined): string | null {
  const num = (v: string | null | undefined) => { if (!v) return null; const m = v.replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|-?\d+\/\d+/); if (!m) return null; const t = m[0].trim(); if (t.includes('/')) { const [w, f] = t.includes(' ') ? t.split(/\s+/) : ['0', t]; const [a, b] = f.split('/').map(Number); return Number(w) + (b ? a / b : 0) } return Number(t) }
  const a = num(start), b = num(end)
  if (a == null || b == null) return null
  const d = Math.round((b - a) * 1000) / 1000
  const unit = (start ?? '').match(/(psi|"\s*wc|wc|in|")/i)?.[0] ?? ''
  return `${d}${unit ? (unit === '"' ? '"' : ' ' + unit) : ''}`
}

const STATE_NAMES: [RegExp, TestState][] = [[/\bwest\s+virginia\b/i, 'WV'], [/\bmaryland\b/i, 'MD'], [/\bvirginia\b/i, 'VA']]
/** Picks MD / VA / WV from a site's state column, its address text, or its ZIP. Null when nothing says. */
export function detectState(input: { state?: string | null; address?: string | null; zip?: string | null }): TestState | null {
  const st = (input.state ?? '').trim().toUpperCase()
  if (st === 'MD' || st === 'VA' || st === 'WV') return st
  if (st) { for (const [re, v] of STATE_NAMES) if (re.test(st)) return v }
  const addr = input.address ?? ''
  const abbr = addr.match(/(?:,|\s)\s*(MD|VA|WV)\.?\s*(?:\d{5}(?:-\d{4})?)?\s*$/i) ?? addr.match(/[,\s](MD|VA|WV)[,\s]+\d{5}/i)
  if (abbr) return abbr[1].toUpperCase() as TestState
  for (const [re, v] of STATE_NAMES) if (re.test(addr)) return v
  const zip = (input.zip ?? addr.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? '').slice(0, 3)
  const z = Number(zip)
  if (zip.length === 3 && !Number.isNaN(z)) {
    if (z >= 206 && z <= 219) return 'MD'
    if (z === 201 || (z >= 220 && z <= 246)) return 'VA'
    if (z >= 247 && z <= 268) return 'WV'
  }
  return null
}

export function itemTitle(i: Pick<ItemRow, 'kind' | 'label' | 'kind_other'>): string {
  const k = kindInfo(i.kind)
  const n = (i.label ?? '').trim()
  if (i.kind === 'other') return n || i.kind_other || 'Other sump'
  if (i.kind === 'udc') return n ? `UDC ${n}` : 'UDC'
  if (i.kind === 'stp') return n ? `STP ${n}` : 'STP sump'
  if (i.kind === 'spill_bucket') return n ? `${n} spill bucket` : 'Spill bucket'
  if (i.kind === 'stage1_bucket') return n ? `${n} Stage I bucket` : 'Stage I bucket'
  return n ? `${k.label} ${n}` : k.label
}
export const testTitle = (t: Pick<TestRow, 'site_number' | 'facility_name'>) => [t.site_number, t.facility_name].filter(Boolean).join(' · ') || 'Containment test'
export const overallResult = (items: Pick<ItemRow, 'result'>[]): 'pass' | 'fail' | 'incomplete' => items.some(i => i.result === 'fail') ? 'fail' : items.length && items.every(i => i.result === 'pass') ? 'pass' : 'incomplete'

/** Rows that still block "Finish": the minimum each state's form needs filled in. */
export function missingForFinish(t: TestRow, items: ItemRow[]): string[] {
  const out: string[] = []
  if (!t.site_number && !t.facility_name) out.push('Site # or facility name')
  if (!t.address) out.push('Site address')
  if (!t.tester_name) out.push('Tester name')
  if (t.state === 'MD' && !t.tester_cert) out.push('MDE certification # (MDIC-…)')
  if (t.state === 'WV' && !t.tester_cert) out.push('WVDEP certification #')
  if (!t.signature) out.push('Tester signature')
  if (!items.length) out.push('At least one bucket or sump')
  items.forEach(i => { if (!i.result) out.push(`${itemTitle(i)}: pass or fail`) })
  return out
}

/** Blank 3-year due date from the test date (VA spill form asks for it; MD buckets are annual). */
export function nextDueFrom(testDate: string, state: TestState, hasBuckets: boolean): string {
  const d = new Date(testDate + 'T12:00:00')
  d.setFullYear(d.getFullYear() + (state === 'MD' && hasBuckets ? 1 : 3))
  return d.toISOString().slice(0, 10)
}
export const RPS_COMPANY = { name: 'Rappahannock Petroleum LLC', phone: '540-869-5033', address: '225 Ritter Rd', city: 'Winchester', state: 'VA', zip: '22602', email: 'econstruction.rp@gmail.com' }
export const DEFAULT_SEND_TO = 'econstruction.rp@gmail.com'
