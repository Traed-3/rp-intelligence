/**
 * The aerial side of the site plan (server only): find the site from its address, fetch the picture from above, and
 * have Claude read the picture for the store, canopy, dispensers and tank pad.
 *
 * Picture source: Esri World Imagery (the same satellite / aerial pictures Google Earth licenses for most of the US),
 * fetched by coordinates with no API key. Google's own imagery cannot be copied into another app without a paid Maps
 * key, so the form links out to Google Earth for looking and uses this for the picture it draws on.
 * Address lookup: US Census geocoder (free, no key), then OpenStreetMap as a second try.
 */
import Anthropic from '@anthropic-ai/sdk'
import { type PlanElement, type PlanShape, type ShapeType, type SurveyData, BOARD, newShape, planInventory, tanksInPad } from '@/lib/site-survey'

export const AERIAL_SPANS = [60, 90, 130, 180]   // meters of ground across the picture
export const AERIAL_PX = 1024
const MODEL = process.env.SITE_PLAN_SCAN_MODEL ?? process.env.BILLING_EXTRACT_MODEL ?? 'claude-sonnet-5'
const FALLBACK_MODEL = 'claude-sonnet-4-6'

export type LatLng = { lat: number; lng: number }

/** "38.9072, -77.0369" pasted from a maps app. */
export function parseLatLng(text: string | null | undefined): LatLng | null {
  const m = /(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/.exec(text ?? '')
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

export async function geocode(address: string): Promise<LatLng | null> {
  const q = address.trim()
  if (q.length < 6) return null
  try {
    const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(12_000) })
    const j = await r.json() as { result?: { addressMatches?: { coordinates?: { x: number; y: number } }[] } }
    const c = j.result?.addressMatches?.[0]?.coordinates
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return { lat: c.y, lng: c.x }
  } catch { /* try the next one */ }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'site-survey-form/1.0' }, signal: AbortSignal.timeout(12_000) })
    const j = await r.json() as { lat: string; lon: string }[]
    if (j[0]) return { lat: Number(j[0].lat), lng: Number(j[0].lon) }
  } catch { /* no match */ }
  return null
}

const R = 6378137
const mercX = (lng: number) => (R * lng * Math.PI) / 180
const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** A square picture `spanM` meters across, centered on the point, north up. */
export async function fetchAerial(center: LatLng, spanM: number): Promise<Buffer> {
  const half = spanM / 2 / Math.cos((center.lat * Math.PI) / 180)   // Web Mercator stretches with latitude
  const x = mercX(center.lng), y = mercY(center.lat)
  const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${x - half},${y - half},${x + half},${y + half}&bboxSR=3857&imageSR=3857&size=${AERIAL_PX},${AERIAL_PX}&format=jpg&f=image`
  const r = await fetch(url, { signal: AbortSignal.timeout(25_000) })
  if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('The aerial picture service did not answer. Try again in a minute.')
  return Buffer.from(await r.arrayBuffer())
}

/** The point on the ground under a spot on the board (used by "center here"). */
export function boardToLatLng(center: LatLng, spanM: number, bx: number, by: number): LatLng {
  const dx = ((bx - BOARD / 2) / BOARD) * spanM, dy = ((BOARD / 2 - by) / BOARD) * spanM
  return { lat: center.lat + (dy / R) * (180 / Math.PI), lng: center.lng + ((dx / R) * (180 / Math.PI)) / Math.cos((center.lat * Math.PI) / 180) }
}

export const googleEarthUrl = (c: LatLng) => `https://earth.google.com/web/@${c.lat.toFixed(6)},${c.lng.toFixed(6)},0a,250d,35y,0h,0t,0r`

const SCAN_TYPES = ['building', 'canopy', 'dispenser', 'tank_pad', 'vent'] as const
const SCAN_TOOL: Anthropic.Tool = {
  name: 'record_site',
  description: 'Record where each thing is in the aerial picture of the fuel station.',
  input_schema: {
    type: 'object',
    properties: {
      found: {
        type: 'array',
        description: 'One entry per thing. Boxes are fractions of the picture: 0,0 is the top left corner and 1,1 the bottom right.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...SCAN_TYPES] },
            cx: { type: 'number', description: 'center, across (0-1)' }, cy: { type: 'number', description: 'center, down (0-1)' },
            w: { type: 'number', description: 'length of the long or first side (0-1 of the picture width)' }, h: { type: 'number', description: 'length of the other side (0-1)' },
            turn: { type: 'number', description: 'degrees the box is turned clockwise from level; 0 when its sides line up with the picture' },
            sure: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['type', 'cx', 'cy', 'w', 'h', 'turn', 'sure'],
        },
      },
      note: { type: 'string', description: 'One short sentence on anything that could not be made out (trees, shadows, the wrong lot in view).' },
    },
    required: ['found', 'note'],
  },
}
const SCAN_SYSTEM = `You read aerial pictures of retail fuel stations for a petroleum contractor that is drawing a site plan. North is up. Find, in this order:
- building: the store. One box around the roof.
- canopy: each fuel canopy (a large flat rectangular roof over the pumps, usually white, grey or with a coloured fascia). A separate diesel canopy gets its own box.
- dispenser: the dispensers under a canopy cannot be seen from above. Place them from what can be seen: the canopy columns, the concrete islands at the canopy edges, the oil-stain pattern and parked cars. They stand in rows along the length of the canopy, evenly spaced. Each box is about 1.2 m by 0.8 m.
- tank_pad: the concrete slab over the underground tanks. Look for a lighter rectangular concrete pad set in the asphalt, usually beside the canopy or at the edge of the lot, with small round manhole covers in rows. One box around the slab.
- vent: the cluster of vent pipes, if it can be made out (a small spot near the tank pad, a lot edge or the building).
Only record what the picture supports. If the tank pad cannot be made out, leave it out rather than guess. Use record_site.`

type Found = { type: (typeof SCAN_TYPES)[number]; cx: number; cy: number; w: number; h: number; turn: number; sure: string }
export type ScanResult = { elements: PlanElement[]; note: string; summary: string }

/** Claude looks at the picture; the survey's own tank and dispenser list names what it finds and fills in what cannot be seen from above. */
export async function scanAerial(jpeg: Buffer, spanM: number, data: SurveyData | null): Promise<ScanResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Reading the picture is not set up here (ANTHROPIC_API_KEY missing).')
  const inv = planInventory(data)
  const client = new Anthropic()
  const content: Anthropic.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
    { type: 'text', text: `The picture is ${spanM} m (${Math.round(spanM * 3.281)} ft) across and tall. The survey lists ${inv.dispensers.length || 'an unknown number of'} dispensers${inv.dispensers.length ? ` (${inv.dispensers.join(', ')})` : ''} and ${inv.tanks.length || 'an unknown number of'} underground tanks${inv.tanks.length ? ` (${inv.tanks.join(', ')})` : ''}. Record the site.` },
  ]
  const call = (model: string) => client.messages.create({ model, max_tokens: 3000, system: SCAN_SYSTEM, tools: [SCAN_TOOL], tool_choice: { type: 'tool', name: 'record_site' }, messages: [{ role: 'user', content }] })
  let res: Anthropic.Message
  try { res = await call(MODEL) }
  catch (e) { if (/not_found|model/i.test((e as Error).message) && MODEL !== FALLBACK_MODEL) res = await call(FALLBACK_MODEL); else throw e }
  const block = res.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  const input = (block?.input ?? {}) as { found?: Found[]; note?: string }
  return buildFromScan(Array.isArray(input.found) ? input.found : [], String(input.note ?? ''), data)
}

const frac = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.min(1.1, Math.max(-0.1, n)) : 0.5 }

/** Turn what was seen into plan shapes, then add what the survey knows and the picture cannot show. */
export function buildFromScan(found: Found[], note: string, data: SurveyData | null): ScanResult {
  const inv = planInventory(data)
  const box = (f: Found, type: ShapeType, label: string): PlanShape => newShape(type, frac(f.cx) * BOARD, frac(f.cy) * BOARD, label, { w: Math.max(8, frac(f.w) * BOARD), h: Math.max(8, frac(f.h) * BOARD), rot: Number(f.turn) || 0 })
  const of = (t: Found['type']) => found.filter(f => f && f.type === t)
  const els: PlanElement[] = []
  of('building').slice(0, 3).forEach((f, i) => els.push(box(f, 'building', i ? `Building ${i + 1}` : 'Store')))
  const canopies = of('canopy').slice(0, 4).map((f, i) => box(f, 'canopy', i ? `Canopy ${i + 1}` : 'Canopy'))
  els.push(...canopies)

  // Dispensers: keep the ones seen, in reading order (top row first, left to right), named from the survey.
  let disp = of('dispenser').slice(0, 40).map(f => box(f, 'dispenser', ''))
  disp.sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x))
  if (!disp.length && canopies.length && inv.dispensers.length) {
    // None could be placed from the picture: space the survey's dispensers along the first canopy.
    const c = canopies[0], n = inv.dispensers.length, rad = (c.rot * Math.PI) / 180
    disp = inv.dispensers.map((_, i) => { const t = (i + 0.5) / n - 0.5; return newShape('dispenser', c.x + t * c.w * 0.85 * Math.cos(rad), c.y + t * c.w * 0.85 * Math.sin(rad), '', { rot: c.rot }) })
  }
  disp.forEach((d, i) => { d.label = inv.dispensers[i] ?? `${i * 2 + 1}/${i * 2 + 2}`; d.w = Math.max(d.w, 22); d.h = Math.max(d.h, 14) })
  els.push(...disp)

  const pads = of('tank_pad').slice(0, 3).map((f, i) => box(f, 'tank_pad', i ? `Tank pad ${i + 1}` : 'Tank pad'))
  const tanks = inv.tanks.length ? inv.tanks : []
  if (pads.length) { els.push(...pads); if (tanks.length) els.push(...tanksInPad(pads[0], tanks)) }
  else if (tanks.length) {
    // Tank pad not found in the picture: park it in a corner, clearly marked, for the tech to drag onto the real pad.
    const pad = newShape('tank_pad', 170, 870, 'Tank pad (move me)', { w: 280, h: Math.max(120, tanks.length * 60) })
    els.push(pad, ...tanksInPad(pad, tanks))
  }
  of('vent').slice(0, 2).forEach(f => els.push(box(f, 'vent', 'Vents')))

  const summary = [
    `${of('building').length ? 'store' : 'no store'}`, `${canopies.length} canop${canopies.length === 1 ? 'y' : 'ies'}`, `${disp.length} dispenser${disp.length === 1 ? '' : 's'}`,
    pads.length ? 'tank pad' : 'tank pad NOT found (placed bottom left, drag it into place)',
  ].join(', ')
  return { elements: els, note: note.slice(0, 300), summary }
}
