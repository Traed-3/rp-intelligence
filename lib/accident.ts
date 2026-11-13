/**
 * Accident Report (Forms -> Accident Report). Replaces the Smartsheet "RPS Work Vehicle Accident Report" form:
 * same questions (who, when, where, who in management was told, other vehicle, other property, police, damage,
 * what happened, time off), plus injuries, witnesses, the other driver's phone / insurer and photos.
 *
 * One list of fields drives the phone form, the save action, the finish check and the PDF, so they cannot drift.
 * Every field key is a column on `accident_reports`.
 */

export type FieldType = 'text' | 'tel' | 'date' | 'time' | 'textarea' | 'yesno'
export type AccidentField = {
  key: string
  label: string
  type: FieldType
  /** Needed before the report can be finished (only when the field is showing). */
  required?: boolean
  /** Only asked when this yes/no field is answered Yes. */
  showIf?: string
  hint?: string
  /** Takes the full row on a wide screen and on the PDF. */
  wide?: boolean
}
export type AccidentSection = { title: string; note?: string; fields: AccidentField[] }

export const ACCIDENT_TITLE = 'Work Vehicle Accident Report'
export const ACCIDENT_INTRO = 'Fill this out as soon as it is safe to, the same day as the accident. Call management first. Do not admit fault or discuss the accident with anyone except the police, management and our insurance company. Take photos of every vehicle, the damage, the other driver’s license plate and insurance card, and the scene.'

export const ACCIDENT_SECTIONS: AccidentSection[] = [
  {
    title: 'Employee and vehicle',
    fields: [
      { key: 'employee_name', label: 'RPS employee (driver)', type: 'text', required: true },
      { key: 'employee_phone', label: 'Employee phone', type: 'tel' },
      { key: 'accident_date', label: 'Date of accident', type: 'date', required: true },
      { key: 'accident_time', label: 'Time of accident', type: 'time', required: true },
      { key: 'unit_number', label: 'Truck / equipment number', type: 'text', required: true, hint: 'Type N/A if no company vehicle was involved' },
      { key: 'location', label: 'Location of accident', type: 'text', required: true, hint: 'Street address, intersection or store number', wide: true },
    ],
  },
  {
    title: 'Reported to management',
    fields: [
      { key: 'reported_to', label: 'Management the accident was reported to', type: 'text', required: true },
      { key: 'instructions', label: 'Instructions given by management', type: 'textarea', wide: true },
    ],
  },
  {
    title: 'What happened',
    fields: [
      { key: 'description', label: 'Detailed description of the accident', type: 'textarea', required: true, hint: 'Direction of travel, speed, weather, road conditions, what each vehicle did', wide: true },
      { key: 'vehicle_damage', label: 'Detailed description of damage to the work vehicle', type: 'textarea', required: true, hint: 'Write None if there is no damage', wide: true },
    ],
  },
  {
    title: 'Injuries',
    fields: [
      { key: 'injured', label: 'Was anyone injured?', type: 'yesno', required: true },
      { key: 'injury_description', label: 'Who was injured and how', type: 'textarea', required: true, showIf: 'injured', wide: true },
      { key: 'time_off_needed', label: 'Do you need time off work for injuries?', type: 'yesno', required: true, showIf: 'injured' },
      { key: 'return_date', label: 'Expected return date', type: 'date', showIf: 'time_off_needed' },
    ],
  },
  {
    title: 'Other vehicle',
    fields: [
      { key: 'other_vehicle', label: 'Was another vehicle involved?', type: 'yesno', required: true },
      { key: 'other_driver_name', label: 'Driver’s full name', type: 'text', required: true, showIf: 'other_vehicle' },
      { key: 'other_driver_phone', label: 'Driver’s phone', type: 'tel', showIf: 'other_vehicle' },
      { key: 'other_vehicle_desc', label: 'Vehicle (year, make, model, color)', type: 'text', showIf: 'other_vehicle' },
      { key: 'other_plate', label: 'License plate (and state)', type: 'text', showIf: 'other_vehicle' },
      { key: 'other_license', label: 'Driver’s license #', type: 'text', showIf: 'other_vehicle' },
      { key: 'other_insurance_company', label: 'Insurance company', type: 'text', showIf: 'other_vehicle' },
      { key: 'other_policy', label: 'Insurance policy #', type: 'text', showIf: 'other_vehicle' },
    ],
  },
  {
    title: 'Other property',
    fields: [
      { key: 'property_damaged', label: 'Was any other property damaged?', type: 'yesno', required: true },
      { key: 'property_description', label: 'Property description', type: 'text', required: true, showIf: 'property_damaged', hint: 'Canopy, bollard, dispenser, fence, building…' },
      { key: 'property_owner', label: 'Property owner / contact', type: 'text', showIf: 'property_damaged' },
      { key: 'property_damage', label: 'Damage description', type: 'textarea', required: true, showIf: 'property_damaged', wide: true },
    ],
  },
  {
    title: 'Police',
    fields: [
      { key: 'police_called', label: 'Were the police called to the scene?', type: 'yesno', required: true },
      { key: 'police_dept', label: 'Police department', type: 'text', showIf: 'police_called' },
      { key: 'officer_name', label: 'Officer’s name', type: 'text', showIf: 'police_called' },
      { key: 'police_report_number', label: 'Report number', type: 'text', showIf: 'police_called' },
    ],
  },
  {
    title: 'Witnesses',
    fields: [
      { key: 'witnesses', label: 'Witness names and phone numbers', type: 'textarea', hint: 'One per line. Leave blank if there were none.', wide: true },
    ],
  },
]

export const ACCIDENT_FIELDS: AccidentField[] = ACCIDENT_SECTIONS.flatMap(s => s.fields)
const BY_KEY = new Map(ACCIDENT_FIELDS.map(f => [f.key, f]))

export type AccidentPhoto = { path: string; name?: string | null }
export type AccidentValue = string | boolean | null
export type AccidentRow = {
  id: string
  company_id: string
  asset_id: string | null
  photos: AccidentPhoto[] | null
  signature: string | null
  signed_at: string | null
  status: 'draft' | 'complete'
  completed_at: string | null
  emailed_to: string | null
  emailed_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  accident_date: string | null
  employee_name: string | null
  unit_number: string | null
  location: string | null
} & Record<string, unknown>

export const MAX_PHOTOS = 24

/** Everyone here is emailed the PDF automatically the moment a report is submitted (Trae, 2026-11-13). */
export const ACCIDENT_NOTIFY: readonly string[] = ['rpscentral@gmail.com', 'sdodson.rp@gmail.com']

/** A field is asked when it has no condition, or when every yes/no it hangs off (up the chain) is Yes. */
export function isShown(f: AccidentField, values: Record<string, unknown>): boolean {
  let cur: AccidentField | undefined = f
  for (let i = 0; cur?.showIf && i < 5; i++) {
    if (values[cur.showIf] !== true) return false
    cur = BY_KEY.get(cur.showIf)
  }
  return true
}

/** What is still blank before the report can be finished. */
export function missingForFinish(row: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const f of ACCIDENT_FIELDS) {
    if (!f.required || !isShown(f, row)) continue
    const v = row[f.key]
    if (f.type === 'yesno' ? typeof v !== 'boolean' : !String(v ?? '').trim()) out.push(f.label)
  }
  return out
}

export const fmtDate = (d: string | null | undefined) => { if (!d) return ''; const [y, m, dd] = d.slice(0, 10).split('-'); return y && m && dd ? `${Number(m)}/${Number(dd)}/${y}` : d }

/** "14:05" -> "2:05 PM". Anything that isn't HH:MM prints as typed. */
export const fmtTime = (t: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '')
  if (!m) return t ?? ''
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** How a saved value reads on the finished screen and the PDF. */
export function displayValue(f: AccidentField, v: unknown): string {
  if (f.type === 'yesno') return v === true ? 'Yes' : v === false ? 'No' : ''
  if (f.type === 'date') return fmtDate(v as string | null)
  if (f.type === 'time') return fmtTime(v as string | null)
  return String(v ?? '')
}

export const accidentFileName = (r: AccidentRow) =>
  `Accident Report - ${[r.unit_number, r.employee_name, fmtDate(r.accident_date).replace(/\//g, '-')].filter(Boolean).join(' - ') || r.id.slice(0, 8)}.pdf`.replace(/[\\/:*?"<>|]/g, '')

/** The quick facts shown on the list and in the email. */
export function accidentFlags(r: Record<string, unknown>): string[] {
  return [r.injured === true && 'injury', r.other_vehicle === true && 'other vehicle', r.property_damaged === true && 'property damage', r.police_called === true && 'police'].filter((x): x is string => !!x)
}
