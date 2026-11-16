/**
 * Site Survey (Forms -> Site Surveys). One form that holds every kind of site survey RPS has done, built from the
 * surveys on file in Dropbox (cataloged 11/13/26):
 *   - 7-Eleven "Facility Site Survey - Gasoline Project" (REV 11-23-09): ATG, tanks, tank-top sumps, manholes, piping,
 *     dispensers, under-dispenser containment, canopy, emergency controls.
 *   - 7-11 / CSI "Petroleum Survey - Existing Site": per-tank probe / manifold / vent questions, STP sump depths and
 *     collars, retrofit sump-lid and spill-bucket measurements, per-dispenser condition, Bravo UDC, in-store equipment.
 *   - Source / ICON sump worksheets and the crews' boot surveys: penetrations per sump, studs, pipe OD.
 *   - Free-form surveys sent by email (site dimensions, wire and pipe estimates, items of concern) and site drawings.
 *
 * Nothing has a fixed count. Tanks, sumps, buckets, manholes, dispensers and the rest are lists: enter the first one,
 * then add another (or copy the last). Any section and any list item also takes extra fields the form does not have
 * (label + answer), and whole custom sections can be added, so a survey never has to be left out.
 *
 * PURE module: field catalog, data shape and helpers shared by the form, the site plan, the PDF and the server.
 */

export type FieldType = 'text' | 'number' | 'yn' | 'select' | 'textarea' | 'date' | 'rows'
/** `rows` = a table inside a card (one line per penetration): `columns` are its boxes, `rowNoun` names one line. */
export type Field = { key: string; label: string; type?: FieldType; options?: string[]; hint?: string; wide?: boolean; columns?: Field[]; rowNoun?: string }
export type Section = {
  key: string
  title: string
  blurb?: string
  /** A list section: one card per item, "add another" under the last one. `noun` names one item; `nameFrom` are the fields that title it. */
  list?: { noun: string; nameFrom: string[] }
  fields: Field[]
  /** Pictures the old survey sheets ask for in this section (shown as a reminder next to the camera button). */
  photos?: string[]
}

const PRODUCTS = ['RUL', 'MUL', 'PUL', 'DSL', 'KERO', 'E85', 'DEF', 'Off-road DSL']
const COND = ['Good', 'Fair', 'Poor']
const WALL = ['Single wall', 'Double wall']
const SUMP_MAT = ['Poly', 'Fiberglass', 'Steel', 'None', 'Unknown']
const PIPE_MAT = ['Fiberglass', 'Flexible (plastic)', 'Steel', 'Unknown']
const f = (key: string, label: string, type: FieldType = 'text', extra: Partial<Field> = {}): Field => ({ key, label, type, ...extra })
const yn = (key: string, label: string, hint?: string): Field => ({ key, label, type: 'yn', hint })
const pick = (key: string, label: string, options: string[], hint?: string): Field => ({ key, label, type: 'select', options, hint })
const note = (key = 'notes', label = 'Notes'): Field => ({ key, label, type: 'textarea', wide: true })

/**
 * Every pipe and conduit entering a sump gets its own line (Trae, 11/16/26: one "electrical purpose" box is no good when a
 * sump has several conduits). Same idea as ICON's worksheet: P1, P2 ... product, V1 ... vapor / vent, C1, C2 ... conduit,
 * each with its own size, what it carries, fitting and condition.
 */
export const PEN_KINDS: { value: string; letter: string }[] = [{ value: 'Product', letter: 'P' }, { value: 'Vapor / vent', letter: 'V' }, { value: 'Conduit', letter: 'C' }]
const PENS: Field = {
  key: 'pens', label: 'Penetrations: every pipe and conduit entering the sump', type: 'rows', rowNoun: 'penetration',
  columns: [
    pick('kind', 'What', PEN_KINDS.map(k => k.value)),
    f('size', 'Size', 'text', { hint: '3/4", 1 1/2", 2"' }),
    pick('carries', 'What it carries', ['Dispenser power', 'STP power', 'Sump sensor (ATG)', 'Intercom / speaker', 'Data / card reader', 'Spare (empty)', 'Unknown', 'RUL', 'MUL', 'PUL', 'DSL', 'Vapor return', 'Vent', 'Capped'], 'pwr, sensor, spare, RUL'),
    f('pipe', 'Pipe / conduit make', 'text', { hint: 'Ameron FRP, Flexworks, rigid, PVC' }),
    pick('fitting', 'Entry fitting', ['Studded (bolted)', 'Threaded nut', 'Test boot', 'None']),
    f('studs', 'Studs / stud-to-stud', 'text', { hint: '8 stud, 2"' }),
    pick('condition', 'Condition', ['Good', 'Fair', 'Poor', 'Leaking']),
    f('notes', 'Notes', 'text', { hint: 'angled, in use, wire not in conduit' }),
  ],
}
/** "P1", "C2": the line's kind letter and its count among lines of that kind, the way the photos and ICON refer to them. */
export function penRef(rows: Record<string, string>[], i: number): string {
  const kind = rows[i]?.kind ?? ''
  const letter = PEN_KINDS.find(k => k.value === kind)?.letter ?? (kind ? kind.charAt(0).toUpperCase() : '#')
  return `${letter}${rows.slice(0, i + 1).filter(r => (r.kind ?? '') === kind).length}`
}

export const SECTIONS: Section[] = [
  {
    key: 'general', title: 'Site and property',
    blurb: 'What the survey is for and the lay of the site.',
    photos: ['Front of building', 'Right side', 'Rear', 'Left side', 'ID sign', 'Facility from each property line'],
    fields: [
      pick('customer', 'Customer', ['7-Eleven', 'Sunoco', 'Speedway', 'Sheetz', 'Wawa', 'Global', 'Shell', 'Handy Mart', 'Other']),
      f('market', 'Market / zone'), f('work_order', 'Work order / SR #'), f('store_phone', 'Store phone'),
      f('purpose', 'What the survey is for', 'textarea', { wide: true, hint: 'tank top remodel, line replacement, dispenser swap, diesel conversion, bid…' }),
      f('tank_pad_size', 'Tank pad size', 'text', { hint: "13' 6\" x 30'" }), f('canopy_size', 'Canopy size', 'text', { hint: "63' x 31'" }),
      f('island_size', 'Island size', 'text', { hint: "4' x 16'" }), f('canopy_to_building', 'Canopy to building'),
      pick('paving', 'Paving over the work area', ['Concrete', 'Asphalt', 'Both', 'Dirt / gravel']),
      f('monitoring_wells', 'Monitoring wells', 'text', { hint: 'how many, depth, water' }),
      note('notes', 'Site notes'),
    ],
  },
  {
    key: 'atg', title: 'Tank monitor (ATG)',
    photos: ['ATG console', 'Electrical room walls', 'System set-up printout', 'Tank charts'],
    fields: [
      pick('make', 'Manufacturer', ['Veeder-Root', 'Franklin / INCON', 'OPW', 'Other']), f('model', 'Console model #', 'text', { hint: 'TLS-350, 0848290-022' }),
      f('serial', 'Console serial #'), f('software_version', 'Software version'), f('software_number', 'Software #'), f('created_date', 'Created date'),
      f('sensor_module', 'Sensor module #'), f('location', 'Where the console is'),
      yn('periodic', 'Periodic in-tank test?'), yn('annual', 'Annual in-tank test?'), yn('bir', 'BIR?'), yn('csld', 'CSLD?'),
      yn('setup_printed', 'Set-up printed and attached?'), yn('tank_charts', 'Tank charts on site?'), note(),
    ],
  },
  {
    key: 'tanks', title: 'Tanks', list: { noun: 'tank', nameFrom: ['number', 'product'] },
    blurb: 'One card per tank (or per compartment).',
    photos: ['Tank field', 'Full view of this tank', 'Tank vent', 'Vent caps'],
    fields: [
      f('number', 'Tank #'), pick('product', 'Product', PRODUCTS), f('capacity', 'Capacity (gal)', 'text', { hint: '10K' }), f('diameter', 'Diameter (ft)'),
      f('manufacturer', 'Manufacturer', 'text', { hint: 'Xerxes, Owens, Imperial' }), pick('material', 'Material', ['Fiberglass', 'Steel', 'Composite', 'Unknown']),
      pick('wall', 'Wall', WALL), yn('compartment', 'Compartment tank?'), pick('probe', 'Probe type', ['Mag Plus', 'Mag', 'Other', 'None']),
      yn('manifolded', 'Manifolded?'), pick('siphon', 'Siphon', ['Line siphon', 'Tank siphon', 'None']), f('manifolded_with', 'Manifolded with tank(s)'),
      f('last_test', 'Last tank test date'), yn('vent_manifolded', 'Vent riser manifolded?'), f('vent_manifold_tank', 'Vent manifolded to tank'),
      f('collars', 'Existing collars (how many, diameter)'), f('concerns', 'Items of concern', 'textarea', { wide: true }),
    ],
  },
  {
    key: 'stp_sumps', title: 'STP sumps', list: { noun: 'STP sump', nameFrom: ['label', 'tank'] },
    blurb: 'Tank-top containment at each submersible pump.',
    photos: ['Sump from the top', 'Piping into the sump', 'Every entry boot, close up', 'Sump lid and manhole'],
    fields: [
      f('label', 'Sump', 'text', { hint: 'RUL 1' }), f('tank', 'Tank it serves'), yn('present', 'Containment sump present?'),
      f('manufacturer', 'Sump manufacturer', 'text', { hint: 'TCI, Western, Bravo' }), pick('material', 'Material', SUMP_MAT), pick('profile', 'Wall', ['Flat', 'Curved']),
      f('stp', 'STP make / model / HP'), f('leak_detector', 'Leak detector'), pick('exit', 'Product line exit', ['Single', 'Dual']),
      f('depth', 'Depth to sump bottom from grade (in)'), f('width_top', 'Width at top (in)'), f('width_bottom', 'Width at bottom (in)'),
      f('manhole_id', 'Manhole opening ID (in)'), f('cover_to_riser', 'Manhole cover to top of sump riser (in)'), f('cover_to_top', 'Manhole cover to top of sump (in)'),
      f('opening_id', 'ID of sump opening (in)'), yn('manway', 'Tank manway present?'),
      PENS,
      f('sensor', 'Sump sensor make / model'), yn('dry', 'Sump dry?'), pick('condition', 'Sump condition', COND),
      yn('hydro_ok', 'Can it be hydro tested as it sits?'), note(),
    ],
  },
  {
    key: 'other_sumps', title: 'Vent, transition and other sumps', list: { noun: 'sump', nameFrom: ['type', 'label'] },
    blurb: 'Vent sumps, transition sumps, probe or fill sumps, remote fills. Leave empty if the site has none.',
    photos: ['Sump from the top', 'Every penetration'],
    fields: [
      pick('type', 'Type', ['Vent sump', 'Transition sump', 'Probe sump', 'Fill sump', 'Interstitial', 'Remote fill', 'Other']), f('label', 'Which one / where'),
      pick('material', 'Material', SUMP_MAT), f('depth', 'Depth from grade (in)'), f('size', 'Size (in)'),
      PENS,
      f('sensor', 'Sensor make / model'), yn('dry', 'Dry?'), pick('condition', 'Condition', COND), note(),
    ],
  },
  {
    key: 'buckets', title: 'Spill and vapor buckets', list: { noun: 'bucket', nameFrom: ['purpose', 'tank'] },
    photos: ['Top view with lid', 'Top view without lid', 'Anything unusual'],
    fields: [
      pick('purpose', 'Bucket', ['Fill (spill bucket)', 'Vapor (Stage I)', 'Remote fill']), f('tank', 'Tank / product'), f('manufacturer', 'Manufacturer', 'text', { hint: 'OPW, EMCO, Universal' }),
      f('model', 'Model #'), pick('wall', 'Wall', WALL), pick('mount', 'Type', ['Threaded', 'Slip-on', 'Unknown']), pick('condition', 'Condition', COND),
      yn('drain', 'Has a drain?'), yn('drain_works', 'Drain works?'), yn('swivel', 'Swivel adaptor on the riser?'),
      f('drop_tube', 'Drop tube / overfill device', 'text', { hint: '71SO flapper, ball float' }),
      f('manhole_id', 'Smallest inside diameter of manhole (in)'), f('rim_id', 'Inside diameter of rim (in)'), f('rim_od', 'Outside diameter of rim (in)'),
      f('channel_od', 'Outside lip of drain channel (in)'), f('channel_to_riser', 'Top of drain channel to top of riser (in)'), f('channel_to_bottom', 'Top of drain channel to bottom of manhole (in)'),
      f('wall_to_riser', 'Manhole wall to riser ID (in)'), f('protrusions', 'Protrusions on the rim'), note(),
    ],
  },
  {
    key: 'manholes', title: 'Tank-top manholes', list: { noun: 'manhole', nameFrom: ['purpose', 'tank'] },
    blurb: 'Number them the same way on the site plan.',
    photos: ['Tank pad with every manhole', 'Each manhole at grade'],
    fields: [
      pick('purpose', 'Purpose', ['Fill', 'Vapor', 'ATG probe', 'STP', 'Interstitial', 'Extractor', 'Monitoring well', 'Junction box', 'Other']),
      f('tank', 'Tank / product'), f('type', 'Manufacturer / type', 'text', { hint: 'OPW 3100, Fiberlite' }), f('diameter', 'Diameter (in)'), pick('condition', 'Condition at grade', COND), note(),
    ],
  },
  {
    key: 'vents', title: 'Vents',
    photos: ['Vent risers', 'Vent caps'],
    fields: [
      pick('location', 'Where the vents are', ['Stand alone', 'On the building', 'On the canopy']), f('count', 'How many risers'), yn('manifolded', 'Manifolded?'),
      f('caps', 'Vent caps (type, pressure/vacuum)'), pick('material', 'Vent piping material', PIPE_MAT), f('manufacturer', 'Vent piping manufacturer'), f('height', 'Riser height'), note(),
    ],
  },
  {
    key: 'piping', title: 'Product and vapor piping',
    fields: [
      pick('material', 'Product piping material', PIPE_MAT), f('manufacturer', 'Product piping make / model', 'text', { hint: 'Ameron, Smith, OPW Flexworks, Environ' }), f('size', 'Size'),
      pick('wall', 'Wall', WALL), f('tees', 'Tee fittings in use'), f('elbows', '90-degree elbows in use'), f('length', 'Pipe needed for replacement (ft)'),
      yn('duct', 'Duct (chase) pipe present?'), f('duct_size', 'Duct size'), yn('pull_through', 'Can new pipe be pulled through without breaking concrete?'),
      yn('vapor', 'Vapor recovery piping in use?'), pick('vapor_material', 'Vapor piping material', PIPE_MAT), f('vapor_manufacturer', 'Vapor piping manufacturer'),
      yn('vapor_fall', 'Enough fall for vapor piping with dispensers at grade?'), f('vr_wire', 'Sensor (Veeder-Root) wire needed (ft)'), yn('vr_in_conduit', 'Sensor wire in conduit?'), note(),
    ],
  },
  {
    key: 'lines', title: 'Product lines', list: { noun: 'product line', nameFrom: ['product', 'run'] },
    blurb: 'One per line when the runs matter (line replacement, new dispenser). Leave empty otherwise.',
    fields: [pick('product', 'Product', PRODUCTS), f('run', 'From / to', 'text', { hint: 'RUL STP to disp 1/2, 3/4, 5/6' }), f('size', 'Size'), f('material', 'Pipe make / material'), f('length', 'Length (ft)'), note()],
  },
  {
    key: 'dispensers', title: 'Dispensers', list: { noun: 'dispenser', nameFrom: ['number'] },
    photos: ['Both sides, full view', 'Serial number plate', 'Under the dispenser with the lower door open', 'Bezel close up'],
    fields: [
      f('number', 'Fueling positions', 'text', { hint: '1/2' }), pick('manufacturer', 'Manufacturer', ['Gilbarco', 'Wayne', 'Bennett', 'Tokheim', 'Other']),
      f('model', 'Model', 'text', { hint: 'Encore 700, B7DA2G, Ovation' }), f('serial', 'Serial #'), f('products', 'Products', 'text', { hint: 'RUL, MUL, PUL, DSL' }),
      pick('system', 'Suction or pressure', ['Pressure', 'Suction']), pick('blender', 'Blending', ['Mechanical', 'Electrical', 'None']), f('blend_ratio', 'Blend ratio'),
      pick('mount', 'Mounted', ['On an island (curb)', 'At grade']), f('curb_height', 'Island height (in)'), pick('curb_condition', 'Island condition', COND), yn('at_grade_ok', 'Could it be installed at grade?'),
      yn('anchored', 'Anchored properly?'), pick('mounting_box', 'Mounting box condition', COND), f('shear_brand', 'Shear valve brand'), pick('shear_condition', 'Shear valve condition', COND),
      pick('test_boot', 'Test boot condition', COND), yn('conduit_ok', 'Conduit OK?'), f('spare_conduit', 'Spare conduit / spare wires'),
      f('card_reader', 'Card reader / EMV', 'text', { hint: 'FlexPay IV, EMV on' }), yn('speaker', 'Speaker / intercom in the dispenser?'), f('bollards', 'Bollards'),
      f('condition', 'Cabinet, doors and decals', 'textarea', { wide: true }), note(),
    ],
  },
  {
    key: 'udcs', title: 'Under-dispenser containment (UDC)', list: { noun: 'UDC', nameFrom: ['number'] },
    photos: ['Sump with the product lines and conduit', 'Every penetration, bright light'],
    fields: [
      f('number', 'Under dispenser', 'text', { hint: '1/2' }), yn('present', 'UDC present?'), f('manufacturer', 'Manufacturer', 'text', { hint: 'Bravo, OPW, Western' }),
      pick('material', 'Material', SUMP_MAT), pick('style', 'Style', ['Deep sump', 'Shallow pan']), pick('profile', 'Wall', ['Flat', 'Curved']),
      f('depth', 'Depth to bottom from grade (in)'), f('length', 'Length (in)'), f('width', 'Width (in)'),
      PENS, pick('entry', 'Entry', ['Side', 'Bottom']),
      f('sensor', 'Sensor make / model'), yn('dry', 'Sump dry?'), pick('condition', 'Condition', ['Excellent', 'Fair', 'Poor']),
      f('bad_pipe_pens', 'Bad pipe penetrations'), f('bad_conduit_pens', 'Bad conduit penetrations'), yn('deflection', 'Any deflection?'), yn('cracks', 'Cracks or tears?'),
      yn('hydro_ok', 'Can it be hydro tested as it sits?'), f('anchor_bolts', 'Anchor bolts in the pad / island'), f('splash_lip', 'Splash lip / opening (L x W, in)'), note(),
    ],
  },
  {
    key: 'canopy', title: 'Canopy and islands',
    photos: ['Full canopy with dispensers', 'Canopy from a second angle'],
    fields: [
      pick('canopy_condition', 'Canopy condition', COND), f('columns', 'Columns (how many, condition)'),
      yn('intercoms', 'Intercoms on the columns?'), f('intercom_height', 'Intercom height above the island'), yn('intercom_conduit', 'Intercom wire in conduit?'),
      yn('intercom_works', 'Intercom works?'), f('spare_conduits', 'Spare conduits to the columns (quantity, size)'), f('lighting', 'Canopy lighting'), note(),
    ],
  },
  {
    key: 'extinguishers', title: 'Fire extinguishers', list: { noun: 'extinguisher', nameFrom: ['location'] },
    fields: [f('location', 'Where', 'text', { hint: 'column at disp 1/2' }), pick('condition', 'Condition', COND), f('expires', 'Tag expires')],
  },
  {
    key: 'estops', title: 'Emergency stops', list: { noun: 'E-stop', nameFrom: ['where', 'location'] },
    photos: ['Each E-stop'],
    fields: [pick('where', 'Inside or outside', ['Exterior', 'Interior']), f('location', 'Location', 'text', { hint: "store front, 12' from the right" }), yn('works', 'Function verified?'), note()],
  },
  {
    key: 'electrical', title: 'Electrical and in-store equipment',
    photos: ['Fuel panel', 'Back room electrical (D-box, STP control boxes)', 'POS / fuel controller'],
    fields: [
      f('fuel_panel', 'Fuel panel (room for breakers, feeds)', 'textarea', { wide: true }), yn('stp_relays', 'STP relays / control boxes present?'),
      f('controller', 'Fuel controller', 'text', { hint: 'Passport, Nucleus, EDH' }), f('pos', 'POS make / model'), f('dbox', 'Distribution box'),
      yn('car_wash', 'Car wash?'), f('price_sign', 'Price sign controller'), yn('air_vac', 'Air / vac?'), f('network', 'Network / loyalty / Comdata'), note(),
    ],
  },
  {
    key: 'concerns', title: 'Items of concern', list: { noun: 'item', nameFrom: ['item'] },
    photos: ['Each item of concern'],
    fields: [f('item', 'What', 'text', { wide: true }), f('where', 'Where'), pick('severity', 'How bad', ['Fix now', 'Fix with this job', 'Watch']), f('fix', 'What it needs', 'textarea', { wide: true })],
  },
  {
    key: 'scope', title: 'Scope, materials and schedule',
    blurb: 'What the job will take, the way the old surveys list it.',
    fields: [
      f('scope', 'Scope of work', 'textarea', { wide: true }), f('materials', 'Material list', 'textarea', { wide: true }),
      f('schedule', 'Work schedule (day by day)', 'textarea', { wide: true }), f('crew', 'Crew and days'), f('equipment', 'Equipment / rentals'),
    ],
  },
  {
    key: 'custom', title: 'Other sections', list: { noun: 'section', nameFrom: ['name'] },
    blurb: 'Anything this form does not have. Name the section, then add its fields.',
    fields: [f('name', 'Section name', 'text', { wide: true }), note()],
  },
]

/** Who may use this form, checked in every action and route as well as by the page gate: Forms access, not the
 *  locked-down survey-only role (it is held to /construction/surveys), and not a role the lockdown keeps out of /forms. */
export const SITE_SURVEY_PATH = '/forms/site-survey'

export const sectionByKey = (k: string) => SECTIONS.find(s => s.key === k)

/** An answer the form does not have a box for: the tech types the label and the answer. */
export type Extra = { label: string; value: string }
export type Row = Record<string, string>
export type Item = { id: string; v: Record<string, string>; extra?: Extra[]; rows?: Record<string, Row[]> }
/** Everything typed on the survey. `one` = plain sections, `lists` = list sections, `extra` = added fields on plain sections. */
export type SurveyData = { one: Record<string, Record<string, string>>; lists: Record<string, Item[]>; extra: Record<string, Extra[]> }

export type SurveyPhoto = { id: string; path: string; ref: string; caption: string | null; name?: string }

export type SiteSurveyRow = {
  id: string; company_id: string; job_id: string | null; site_number: string | null; site_name: string | null; address: string | null
  survey_date: string; tech_name: string | null; survey_company: string | null; status: 'draft' | 'complete'
  data: SurveyData | null; plan: SitePlan | null; photos: SurveyPhoto[] | null
  completed_at: string | null; emailed_to: string | null; emailed_at: string | null; created_by: string | null; created_at: string; updated_at: string
}

export const newId = () => Math.random().toString(36).slice(2, 10)
export const blankItem = (): Item => ({ id: newId(), v: {} })
/** Lists that open with one blank card (every survey has these); the rest start empty and are added when the site has them. */
export const STARTS_WITH_ONE = ['tanks', 'stp_sumps', 'buckets', 'dispensers', 'udcs']
export function blankData(): SurveyData {
  const lists: Record<string, Item[]> = {}
  for (const s of SECTIONS) if (s.list) lists[s.key] = STARTS_WITH_ONE.includes(s.key) ? [blankItem()] : []
  return { one: {}, lists, extra: {} }
}

const clip = (v: unknown, n = 4000) => (typeof v === 'string' ? v.slice(0, n) : '')
const cleanExtra = (x: unknown): Extra[] => (Array.isArray(x) ? x : []).slice(0, 40).map(e => ({ label: clip((e as Extra)?.label, 120), value: clip((e as Extra)?.value) })).filter(e => e.label || e.value)
/** Whatever the browser posts is rebuilt against the catalog: unknown sections and keys are dropped, strings are clipped. */
export function cleanData(raw: unknown): SurveyData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SurveyData>
  const out: SurveyData = { one: {}, lists: {}, extra: {} }
  for (const s of SECTIONS) {
    const keys = s.fields.filter(x => x.type !== 'rows').map(x => x.key)
    const tables = s.fields.filter(x => x.type === 'rows')
    const vals = (src: unknown) => { const o: Record<string, string> = {}; for (const k of keys) { const v = clip((src as Record<string, string> | undefined)?.[k]); if (v) o[k] = v } return o }
    if (s.list) {
      out.lists[s.key] = (Array.isArray(r.lists?.[s.key]) ? r.lists![s.key] : []).slice(0, 80).map(it => {
        const item: Item = { id: clip(it?.id, 16) || newId(), v: vals(it?.v) }
        const ex = cleanExtra(it?.extra); if (ex.length) item.extra = ex
        for (const t of tables) {
          const cols = t.columns!.map(c => c.key)
          const rows = (Array.isArray(it?.rows?.[t.key]) ? it.rows![t.key] : []).slice(0, 40).map(r => { const o: Row = {}; for (const c of cols) { const v = clip(r?.[c], 300); if (v) o[c] = v } return o }).filter(r => Object.keys(r).length)
          if (rows.length) item.rows = { ...(item.rows ?? {}), [t.key]: rows }
        }
        return item
      })
    } else {
      out.one[s.key] = vals(r.one?.[s.key])
      const ex = cleanExtra(r.extra?.[s.key]); if (ex.length) out.extra[s.key] = ex
    }
  }
  return out
}

export const itemFilled = (it: Item) => Object.values(it.v).some(Boolean) || !!it.extra?.length || Object.values(it.rows ?? {}).some(r => r.length)
export function itemName(s: Section, it: Item, i: number): string {
  const parts = (s.list?.nameFrom ?? []).map(k => it.v[k]).filter(Boolean)
  const noun = s.list?.noun ?? 'item'
  const cap = noun.charAt(0).toUpperCase() + noun.slice(1)
  if (!parts.length) return `${cap} ${i + 1}`
  return s.key === 'custom' || s.key === 'concerns' ? parts.join(' ') : `${cap} ${parts.join(' · ')}`
}
export const photoRef = (sectionKey: string, itemId?: string) => (itemId ? `${sectionKey}:${itemId}` : sectionKey)

export function surveyTitle(r: Pick<SiteSurveyRow, 'site_number' | 'site_name'>): string {
  return [r.site_number, r.site_name].filter(Boolean).join(' · ') || 'Site survey'
}
export function fmtDate(d: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '')
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : ''
}
export const surveyFileName = (r: Pick<SiteSurveyRow, 'site_number' | 'survey_date'>) => `${(r.site_number ?? 'Site').replace(/[^A-Za-z0-9-]+/g, '')} Site Survey ${r.survey_date}.pdf`

/** A quick count for the list page and the header: "3 tanks · 4 dispensers". */
export function surveyCounts(d: SurveyData | null): string {
  if (!d) return ''
  const n = (k: string) => (d.lists[k] ?? []).filter(itemFilled).length
  const bits: string[] = []
  const add = (k: string, one: string, many: string) => { const c = n(k); if (c) bits.push(`${c} ${c === 1 ? one : many}`) }
  add('tanks', 'tank', 'tanks'); add('stp_sumps', 'STP sump', 'STP sumps'); add('buckets', 'bucket', 'buckets'); add('dispensers', 'dispenser', 'dispensers'); add('udcs', 'UDC', 'UDCs')
  return bits.join(' · ')
}

// ── Site plan ────────────────────────────────────────────────────────────────────────────────────────────────────────
// The drawing lives on a 1000 x 1000 board. With an aerial picture behind it the board covers `span_m` meters of ground,
// so every shape has a real size. Shapes are boxes (center x/y, w, h, turn); lines are point lists (pipe runs, pen strokes).

export type ShapeType = 'building' | 'canopy' | 'tank_pad' | 'tank' | 'dispenser' | 'stp' | 'fill' | 'vent' | 'estop' | 'atg' | 'well' | 'label'
export type LineType = 'product' | 'vapor' | 'conduit' | 'pen' | 'property'
export type PlanShape = { id: string; kind: 'shape'; type: ShapeType; x: number; y: number; w: number; h: number; rot: number; label: string }
export type PlanLine = { id: string; kind: 'line'; type: LineType; pts: [number, number][]; label?: string }
export type PlanElement = PlanShape | PlanLine
export type SitePlan = {
  elements: PlanElement[]
  /** Set when an aerial picture is behind the drawing. */
  aerial?: { path: string; lat: number; lng: number; span_m: number; source: string; fetched_at: string } | null
  /** A photo of a hand drawing (the paper sketch), kept alongside or instead of the drawn plan. */
  sketch_refs?: string[]
  scanned_at?: string | null
  note?: string | null
}

export const BOARD = 1000
export const SHAPES: { type: ShapeType; label: string; w: number; h: number; fill: string; stroke: string; round?: boolean; small?: boolean }[] = [
  { type: 'building', label: 'Store', w: 300, h: 180, fill: '#e5e7eb', stroke: '#374151' },
  { type: 'canopy', label: 'Canopy', w: 420, h: 200, fill: '#dbeafe', stroke: '#1d4ed8' },
  { type: 'tank_pad', label: 'Tank pad', w: 320, h: 220, fill: '#fef3c7', stroke: '#b45309' },
  { type: 'tank', label: 'Tank', w: 240, h: 56, fill: '#fde68a', stroke: '#92400e', round: true },
  { type: 'dispenser', label: 'Disp', w: 46, h: 26, fill: '#fecaca', stroke: '#b91c1c' },
  { type: 'stp', label: 'STP', w: 26, h: 26, fill: '#bbf7d0', stroke: '#15803d', round: true, small: true },
  { type: 'fill', label: 'Fill', w: 22, h: 22, fill: '#fff', stroke: '#111827', round: true, small: true },
  { type: 'vent', label: 'Vents', w: 30, h: 18, fill: '#e9d5ff', stroke: '#7e22ce', small: true },
  { type: 'estop', label: 'E-stop', w: 20, h: 20, fill: '#ef4444', stroke: '#7f1d1d', round: true, small: true },
  { type: 'atg', label: 'ATG', w: 26, h: 18, fill: '#cffafe', stroke: '#0e7490', small: true },
  { type: 'well', label: 'MW', w: 18, h: 18, fill: '#fff', stroke: '#0f766e', round: true, small: true },
  { type: 'label', label: 'Note', w: 120, h: 28, fill: 'none', stroke: 'none' },
]
export const LINES: { type: LineType; label: string; color: string; dash?: string; width: number }[] = [
  { type: 'product', label: 'Product line', color: '#dc2626', width: 3 },
  { type: 'vapor', label: 'Vapor / vent line', color: '#7e22ce', dash: '10 6', width: 3 },
  { type: 'conduit', label: 'Conduit', color: '#2563eb', dash: '3 6', width: 3 },
  { type: 'property', label: 'Property / curb line', color: '#111827', dash: '16 6 3 6', width: 2 },
  { type: 'pen', label: 'Pen (freehand)', color: '#111827', width: 2.5 },
]
export const shapeDef = (t: ShapeType) => SHAPES.find(s => s.type === t) ?? SHAPES[0]
export const lineDef = (t: LineType) => LINES.find(l => l.type === t) ?? LINES[LINES.length - 1]

/** Feet covered by a length on the board, when the plan is over an aerial picture. */
export function feet(units: number, plan: Pick<SitePlan, 'aerial'> | null | undefined): number | null {
  const span = plan?.aerial?.span_m
  return span ? (units * span / BOARD) * 3.28084 : null
}
export const fmtFeet = (ft: number | null) => (ft == null ? '' : ft < 10 ? `${Math.round(ft * 10) / 10}'` : `${Math.round(ft)}'`)

const shape = (type: ShapeType, x: number, y: number, label?: string, size?: { w?: number; h?: number; rot?: number }): PlanShape => {
  const d = shapeDef(type)
  return { id: newId(), kind: 'shape', type, x, y, w: size?.w ?? d.w, h: size?.h ?? d.h, rot: size?.rot ?? 0, label: label ?? d.label }
}
export const newShape = shape

/** What the survey says is on the site, in the words the plan labels use. */
export function planInventory(d: SurveyData | null): { tanks: string[]; dispensers: string[]; stps: string[] } {
  const list = (k: string) => (d?.lists[k] ?? []).filter(itemFilled)
  return {
    tanks: list('tanks').map((t, i) => [t.v.capacity, t.v.product].filter(Boolean).join(' ') || `Tank ${t.v.number || i + 1}`),
    dispensers: list('dispensers').map((x, i) => x.v.number || String(i + 1)),
    stps: list('stp_sumps').map((x, i) => x.v.label || x.v.tank || `STP ${i + 1}`),
  }
}

/** Tanks laid side by side inside a tank pad box, each with its STP and fill, the way the pad is usually built. */
export function tanksInPad(pad: Pick<PlanShape, 'x' | 'y' | 'w' | 'h' | 'rot'>, tanks: string[]): PlanShape[] {
  const out: PlanShape[] = []
  const n = Math.max(tanks.length, 1)
  const along = pad.w >= pad.h   // tanks lie along the long side of the pad
  const long = (along ? pad.w : pad.h) * 0.86, across = along ? pad.h : pad.w
  const pitch = across / n, thick = Math.min(pitch * 0.62, long * 0.3)
  const rad = (pad.rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad)
  const place = (lx: number, ly: number): [number, number] => [pad.x + lx * cos - ly * sin, pad.y + lx * sin + ly * cos]
  tanks.forEach((label, i) => {
    const off = -across / 2 + pitch * (i + 0.5)
    const [tx, ty] = along ? place(0, off) : place(off, 0)
    out.push(shape('tank', tx, ty, label, { w: long, h: thick, rot: pad.rot + (along ? 0 : 90) }))
    const [sx, sy] = along ? place(-long * 0.36, off) : place(off, -long * 0.36)
    const [fx, fy] = along ? place(long * 0.36, off) : place(off, long * 0.36)
    out.push(shape('stp', sx, sy, 'STP'), shape('fill', fx, fy, 'Fill'))
  })
  return out
}

/**
 * A plan drawn from the survey alone (no aerial picture): store at the top, canopy with the dispensers in the middle,
 * tank pad with the tanks to one side. A starting point the tech drags into place.
 */
export function planFromSurvey(d: SurveyData | null): PlanElement[] {
  const inv = planInventory(d)
  const disp = inv.dispensers.length ? inv.dispensers : ['1/2', '3/4']
  const tanks = inv.tanks.length ? inv.tanks : ['Tank 1']
  const els: PlanElement[] = [shape('building', 500, 150, 'Store', { w: 380, h: 170 })]
  const cols = Math.min(disp.length, 4), rows = Math.ceil(disp.length / cols)
  const cw = Math.max(260, cols * 120), ch = Math.max(150, rows * 110)
  const canopy = shape('canopy', 380, 520, 'Canopy', { w: cw, h: ch })
  els.push(canopy)
  disp.forEach((label, i) => {
    const c = i % cols, r = Math.floor(i / cols)
    els.push(shape('dispenser', canopy.x - cw / 2 + (cw / cols) * (c + 0.5), canopy.y - ch / 2 + (ch / rows) * (r + 0.5), label))
  })
  const pad = shape('tank_pad', 790, 560, 'Tank pad', { w: 300, h: Math.max(160, tanks.length * 80) })
  els.push(pad, ...tanksInPad(pad, tanks))
  els.push(shape('vent', 930, 380, 'Vents'), shape('estop', 320, 250, 'E-stop'), shape('atg', 640, 110, 'ATG'))
  return els
}

/** Keep a posted plan inside sane bounds before it is stored. */
export function cleanPlan(raw: unknown, keep?: SitePlan | null): SitePlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SitePlan>
  const num = (v: unknown, lo: number, hi: number, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }
  const elements: PlanElement[] = (Array.isArray(r.elements) ? r.elements : []).slice(0, 400).map((e): PlanElement | null => {
    if (!e || typeof e !== 'object') return null
    if (e.kind === 'line') {
      if (!LINES.some(l => l.type === e.type)) return null
      const pts = (Array.isArray(e.pts) ? e.pts : []).slice(0, 600).map(p => [num(p?.[0], -200, 1200), num(p?.[1], -200, 1200)] as [number, number])
      return pts.length > 1 ? { id: clip(e.id, 16) || newId(), kind: 'line', type: e.type, pts, label: clip(e.label, 60) || undefined } : null
    }
    if (!SHAPES.some(s => s.type === e.type)) return null
    return { id: clip(e.id, 16) || newId(), kind: 'shape', type: e.type, x: num(e.x, -200, 1200), y: num(e.y, -200, 1200), w: num(e.w, 6, 1400, 40), h: num(e.h, 6, 1400, 40), rot: num(e.rot, -360, 360), label: clip(e.label, 60) }
  }).filter((e): e is PlanElement => !!e)
  // The aerial picture and scan stamp are set by the server only; the browser cannot point the plan at another file.
  return { elements, aerial: keep?.aerial ?? null, sketch_refs: keep?.sketch_refs ?? [], scanned_at: keep?.scanned_at ?? null, note: clip(r.note, 500) || null }
}
