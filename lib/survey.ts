/**
 * Field surveys recorded in the app from the phone. The first form is ICON's Sump Survey Worksheet (the blank Trae
 * uploaded 10/1/26): a fittings sheet per sump (P1–P6 product, V1–V2 vapor/vent, C1–C4 conduit; bolted / thread nut /
 * other; pipe make & size or OD; notes), the sump-type boxes (Tank / Disp · Poly / Fiberglass · Flat / Curved), the
 * active-water-leak question, the tank-sump-lid measurements (a–e) and the structural-damage description.
 * Everything here is pure: option lists, labels, and the shape the form, the PDF and the email all share.
 */

export type EntryKind = 'P' | 'V' | 'C'
export type Fitting = 'bolted' | 'thread_nut' | 'other'
export type SurveyEntry = { kind: EntryKind; n: number; fitting: Fitting | null; bolts: number | null; pipe: string | null; od: string | null; notes: string | null }
export type LidMeasure = { a?: string; b?: string; c?: string; d?: string; e?: string }
export type Worksheet = 'fittings' | 'lid' | 'damage'

export type SurveyType = 'icon_fittings' | 'spill_bucket' | 'tank_top'
export const SURVEY_TYPES: { value: SurveyType; label: string; ready: boolean; blurb: string }[] = [
  { value: 'icon_fittings', label: 'ICON Fittings Survey', ready: true, blurb: 'Entry boots per sump on ICON\'s worksheet, photos, PDF to ICON for part numbers.' },
  { value: 'spill_bucket', label: 'Spill Bucket Survey', ready: false, blurb: 'Coming after the ICON survey is right.' },
  { value: 'tank_top', label: 'Tank Top Survey', ready: false, blurb: 'Coming after the ICON survey is right.' },
]
export const surveyTypeLabel = (v: string | null | undefined) => SURVEY_TYPES.find(t => t.value === v)?.label ?? 'Survey'

export type SumpType = 'udc' | 'stp' | 'other'
/** What a sump is called in the field: the type pick plus a number or product, composed into the worksheet's Sump ID. */
export const SUMP_TYPES: { value: SumpType; label: string; prompt: string; numbers: string[]; location: 'disp' | 'tank' }[] = [
  { value: 'udc', label: 'UDC (dispenser)', prompt: 'Dispenser #', numbers: ['1/2', '3/4', '5/6', '7/8', '9/10', '11/12', '13/14', '15/16', '17/18', '19/20'], location: 'disp' },
  { value: 'stp', label: 'STP (tank sump)', prompt: 'Product', numbers: ['RUL', 'PUL', 'MUL', 'DSL', 'RUL 2', 'PUL 2', 'DSL 2', 'KERO', 'E85', 'DEF'], location: 'tank' },
  { value: 'other', label: 'Other (vent / probe / transition)', prompt: 'Which', numbers: ['Vent sump', 'Probe sump', 'Transition sump', 'Fill sump', 'Interstitial', 'Remote fill'], location: 'tank' },
]
export function composeSumpLabel(type: SumpType | null | undefined, number: string | null | undefined): string {
  const n = (number ?? '').trim()
  if (type === 'udc') return n ? `UDC ${n}` : 'UDC'
  if (type === 'stp') return n ? `STP ${n}` : 'STP'
  if (type === 'other') return n || 'Other sump'
  return n || 'Sump'
}

export type SurveyRow = {
  id: string; company_id: string; job_id: string | null; survey_type: string; site_number: string | null; site_name: string | null; address: string | null
  survey_date: string; tech_name: string | null; tech_phone: string | null; tech_email: string | null; status: 'draft' | 'complete' | 'sent'; notes: string | null
  pdf_document_id: string | null; sent_to: string | null; sent_at: string | null; created_at: string; updated_at: string
}
export type SumpRow = {
  id: string; survey_id: string; sort_order: number; sump_label: string; sump_type: SumpType | null; sump_number: string | null; location: 'tank' | 'disp' | null; material: 'poly' | 'fiberglass' | null; profile: 'flat' | 'curved' | null
  active_leak: boolean | null; worksheets: Worksheet[]; entries: SurveyEntry[]; lid: LidMeasure | null; damage: string | null; notes: string | null
}
export type PhotoRow = { id: string; survey_id: string; sump_id: string | null; storage_path: string; file_name: string | null; caption: string | null; entry_ref: string | null; sort_order: number; taken_at: string | null }

export const ENTRY_KINDS: { kind: EntryKind; label: string; max: number }[] = [
  { kind: 'P', label: 'Product pipe entry', max: 6 },
  { kind: 'V', label: 'Vapor / vent pipe entry', max: 2 },
  { kind: 'C', label: 'Conduit entry', max: 4 },
]
export const FITTINGS: { value: Fitting; label: string }[] = [
  { value: 'bolted', label: 'Bolted' }, { value: 'thread_nut', label: 'Thread nut' }, { value: 'other', label: 'Other / none' },
]
export const BOLT_COUNTS = [4, 5, 6, 8, 10, 12]
/** Product lines the crews meet in the field; "Other" keeps a free-text box. Pipe OD is what ICON sizes the fitting from. */
export const PIPE_OPTIONS = [
  'OPW Flexworks 1.5 in (light blue, 1st gen)', 'OPW Flexworks 1.5 in DW', 'OPW Flexworks 2 in DW', 'OPW Pisces 2 in',
  'Environ / GeoFlex 1.5 in', 'Environ / GeoFlex 2 in', 'NOV / Ameron 2 in fiberglass', 'NOV / Ameron 3 in fiberglass', 'NOV 3 over 2 (coaxial)',
  'Smith fiberglass 2 in', 'APT / Total Containment 1.5 in', 'APT / Total Containment 2 in', 'UPP 63 mm (2 in)', 'UPP 50 mm (1.5 in)', 'Western Fiberglass 2 in',
  'Rigid conduit 3/4 in', 'Rigid conduit 1 in', 'Rigid conduit 1.25 in', 'PVC conduit 3/4 in', 'PVC conduit 1 in', 'Other',
]
export const OD_OPTIONS = ['1.0 in', '1.4 in', '1.5 in', '1.9 in', '2.0 in', '2.2 in', '2.5 in', '2.7 in', '3.0 in', '3.1 in', '3.2 in', '3.5 in', '4.0 in', 'measure']
export const NOTE_OPTIONS = ['angled entry', 'offset entry', 'no fitting', 'fitting backwards', 'test boot needed', 'boot torn', 'leaking at fitting', 'pipe cut short', 'shallow pan', 'needs Schrader / test port']
export const SUMP_LOCATIONS = [{ value: 'tank', label: 'Tank sump' }, { value: 'disp', label: 'Dispenser (UDC)' }]
export const SUMP_MATERIALS = [{ value: 'poly', label: 'Poly' }, { value: 'fiberglass', label: 'Fiberglass' }]
export const SUMP_PROFILES = [{ value: 'flat', label: 'Flat wall' }, { value: 'curved', label: 'Curved wall' }]
export const WORKSHEETS: { value: Worksheet; label: string }[] = [
  { value: 'fittings', label: 'Fittings (entry boots)' }, { value: 'lid', label: 'Tank sump lid' }, { value: 'damage', label: 'Structural damage' },
]
export const LID_FIELDS: { key: keyof LidMeasure; label: string }[] = [
  { key: 'a', label: 'a. Manhole opening ID' }, { key: 'b', label: 'b. Largest outside diameter, sump top' }, { key: 'c', label: 'c. Smallest outside diameter, sump top' },
  { key: 'd', label: 'd. Smallest space between sump and skirt' }, { key: 'e', label: 'e. Sump top to manhole lid bottom' },
]

export const fittingLabel = (f: Fitting | null) => FITTINGS.find(x => x.value === f)?.label ?? ''
export const entryRef = (e: Pick<SurveyEntry, 'kind' | 'n'>) => `${e.kind}${e.n}`
export function sumpTypeLine(s: Pick<SumpRow, 'location' | 'material' | 'profile'>): string {
  return [SUMP_LOCATIONS.find(x => x.value === s.location)?.label, SUMP_MATERIALS.find(x => x.value === s.material)?.label, SUMP_PROFILES.find(x => x.value === s.profile)?.label].filter(Boolean).join(' · ')
}
export function surveyTitle(s: Pick<SurveyRow, 'site_number' | 'site_name'>): string {
  return [s.site_number, s.site_name].filter(Boolean).join(' · ') || 'Survey'
}
/** Starting rows for a sump card: one product, one vapor, one conduit; the form adds more. */
export function blankEntries(): SurveyEntry[] {
  return [{ kind: 'P', n: 1, fitting: null, bolts: null, pipe: null, od: null, notes: null }]
}
