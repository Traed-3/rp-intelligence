/**
 * Pre-trip inspection (Non CDL): the paper "Rappahannock Petroleum Vehicle / Trailer Pre trip inspection" sheets,
 * filled on the phone. One row per inspection; every checklist line is marked OK, Remark or N/A.
 *
 * PURE module: the two checklists, labels and the shapes the form, the PDF and the actions share.
 * The paper original is docs/reference/Vehicle_Pre_trip_inspection_Non_CDL.pdf.
 */
export type PretripKind = 'vehicle' | 'trailer'
export type Mark = 'ok' | 'remark' | 'na'
export const MARKS: { value: Mark; label: string }[] = [{ value: 'ok', label: 'OK' }, { value: 'remark', label: 'Remark' }, { value: 'na', label: 'N/A' }]

/** One checklist line. `lead` prints bold (as on the paper), `text` follows it. */
export type PretripItem = { key: string; lead?: string; text?: string }
/** A block of lines under a heading. `lead` is the bold part of the heading, `tail` the plain part. */
export type PretripSection = { lead?: string; tail?: string; items: PretripItem[] }

export type PretripRow = {
  id: string; company_id: string; kind: PretripKind; asset_id: string | null
  unit_number: string | null; equipment: string | null; inspection_date: string; checked_by: string | null
  results: Record<string, Mark> | null; remarks: string | null
  signature: string | null; signed_at: string | null
  status: 'draft' | 'complete'; completed_at: string | null; emailed_to: string | null; emailed_at: string | null
  created_by: string | null; created_at: string; updated_at: string
}

const VEHICLE: PretripSection[] = [
  { lead: 'With emergency brake applied and key removed from the ignition', tail: ', check the following:', items: [] },
  { lead: 'Outside of Vehicle', items: [
    { key: 'tire', lead: 'Tire:', text: 'Appearance, tread depth, and air pressure, wheel and lug nuts (where visible), damage and/or loose.' },
    { key: 'spare_tire', lead: 'Spare tire', text: 'appearance, tread depth, air pressure, and wheel damage and/or loose.' },
    { key: 'cargo', lead: 'Cargo', text: 'securement devices, straps, etc.' },
    { key: 'windows', lead: 'Windows', text: ', cleanliness and free of cracks' },
    { key: 'exterior', lead: 'Exterior body and lens', text: '- Check for any damage or broken lenses' },
  ] },
  { lead: 'Engine compartment', tail: ' – check:', items: [
    { key: 'belts_hoses', text: 'Belts and hoses for visible wear' },
    { key: 'coolant', text: 'Coolant level' },
    { key: 'oil', text: 'Oil level' },
    { key: 'washer_fluid', text: 'Windshield washing fluid' },
  ] },
  { lead: 'With emergency brake applied and key in the accessory position', tail: ', check the following:', items: [
    { key: 'turn_signals', text: 'Turn signals' },
    { key: 'hazards', text: 'Hazard warning signal (i.e., 4-ways)' },
    { key: 'low_beams', text: 'Low beams' },
    { key: 'high_beams', text: 'High beams' },
    { key: 'brake_lights', text: 'Brake lights (using an assistant, or reflection off object in the rear)' },
    { key: 'reverse_lights', text: 'Reverse lights (using an assistant, or reflection off object in the rear)' },
    { key: 'plate_light', text: 'License plate light' },
    { key: 'horn', text: 'Horn' },
    { key: 'wipers', text: 'Windshield wipers' },
    { key: 'hvac', text: 'Heat, defrost, and air-conditioning controls' },
    { key: 'seat_belts', text: 'Seat belts' },
    { key: 'mirrors', text: 'Mirror adjustment' },
  ] },
  { lead: 'With emergency brake applied, start engine', tail: ' and check:', items: [
    { key: 'gauges', text: 'Gauges okay and no warning lights on dashboard' },
    { key: 'plate_tag', lead: 'License plate with a current tag' },
    { key: 'registration', lead: 'Registration', text: '- current' },
    { key: 'inspection', lead: 'Inspection - current' },
  ] },
]

const TRAILER: PretripSection[] = [
  { lead: 'Outside of Vehicle', items: [
    { key: 'tire', lead: 'Tire -', text: 'Check appearance, tread depth, and air pressure, wheel and lug nuts (where visible), damage and/or loose.' },
    { key: 'spare_tire', lead: 'Spare tire -', text: 'Check appearance, tread depth, air pressure, and wheel damage and/or loose.' },
    { key: 'cargo', lead: 'Cargo', text: '- Check cargo securement devices, straps, etc. Check your load.' },
    { key: 'exterior', lead: 'Exterior body and lens', text: '- Check for any damage or broken lenses' },
    { key: 'frame', lead: 'Frame', text: '- Check for any frame damage' },
    { key: 'lifting_jack', lead: 'Lifting jack -', text: 'Check the trailer lifting jack for any damage and proper operation' },
    { key: 'coupler', lead: 'Coupler -', text: 'Check the trailer coupler for any damage and proper operation' },
    { key: 'coupler_pin', lead: 'Coupler pin', text: '- Check the coupler pin to assure it is secure' },
    { key: 'turn_signals', lead: 'Turn signals', text: '- Check for proper operation' },
    { key: 'hazards', lead: 'Hazard warning signal (i.e., 4-ways)', text: '- Check for proper operation' },
    { key: 'brake_lights', lead: 'Brake lights', text: '- Check using an assistant, or reflection off object in the rear' },
    { key: 'reverse_lights', lead: 'Reverse lights', text: '- Check using an assistant, or reflection off object in the rear' },
    { key: 'plate_light', lead: 'License plate light', text: '- Check for proper operation' },
    { key: 'plate_tag', lead: 'License plate with a current tag' },
    { key: 'registration', lead: 'Registration', text: '- current' },
    { key: 'inspection', lead: 'Inspection', text: '- current' },
  ] },
]

export const PRETRIP_INTRO = 'All vehicles should be routinely inspected before the start of each workday. For vehicles operated daily by the same driver, some items, such as oil level and tire air pressure, may only need to be checked weekly if there are no indicators that more frequent checks are required. The following checklist is a suggested procedure to inspect a vehicle in a systematic manner. The “Remarks” box should be checked for those items needing attention and details added in the “Remarks” section. Necessary repairs should be made before the vehicle is used.'

export const pretripSections = (kind: PretripKind): PretripSection[] => (kind === 'trailer' ? TRAILER : VEHICLE)
export const pretripItems = (kind: PretripKind): PretripItem[] => pretripSections(kind).flatMap(s => s.items)
export const itemLabel = (i: PretripItem) => [i.lead, i.text].filter(Boolean).join(' ').replace(/ ,/g, ',').replace(/[:\-–]\s*$/, '').trim()
/** Short name for lists and emails: the bold lead when there is one ("Tire", "Coupler pin"), else the whole line. */
export const itemShort = (i: PretripItem) => (i.lead ?? i.text ?? '').replace(/\s*[:\-–]\s*$/, '').replace(/ - current$/, '').trim()
export const kindLabel = (kind: PretripKind) => (kind === 'trailer' ? 'Trailer' : 'Vehicle')
export const pretripTitle = (kind: PretripKind) => `Rappahannock Petroleum ${kindLabel(kind)} Pre trip inspection (Non CDL)`
export const unitLabel = (kind: PretripKind) => (kind === 'trailer' ? 'Trailer number' : 'Vehicle number')

export const remarkItems = (r: Pick<PretripRow, 'kind' | 'results'>) => pretripItems(r.kind).filter(i => r.results?.[i.key] === 'remark')

/** What still has to be filled in before the inspection can be finished. */
export function missingForFinish(r: Pick<PretripRow, 'kind' | 'unit_number' | 'checked_by' | 'results' | 'remarks' | 'inspection_date'>): string[] {
  const out: string[] = []
  if (!r.unit_number?.trim()) out.push(unitLabel(r.kind))
  if (!r.inspection_date) out.push('Date')
  if (!r.checked_by?.trim()) out.push('Checked by')
  const unmarked = pretripItems(r.kind).filter(i => !r.results?.[i.key])
  if (unmarked.length) out.push(unmarked.length > 4 ? `${unmarked.length} checklist lines are not marked` : `Not marked: ${unmarked.map(itemShort).join(', ')}`)
  if (remarkItems(r).length && !r.remarks?.trim()) out.push('Remarks: say what needs attention on the lines marked Remark')
  return out
}

export const fmtDate = (d: string | null | undefined) => { if (!d) return ''; const [y, m, dd] = d.slice(0, 10).split('-'); return y && m && dd ? `${Number(m)}/${Number(dd)}/${y}` : d }
export const pretripFileName = (r: Pick<PretripRow, 'kind' | 'unit_number' | 'inspection_date'>) =>
  `Pre-Trip ${kindLabel(r.kind)} ${(r.unit_number ?? 'unit').replace(/[^A-Za-z0-9 #-]+/g, '').trim() || 'unit'} ${r.inspection_date}.pdf`
