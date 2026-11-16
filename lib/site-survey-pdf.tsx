/**
 * The site survey as a PDF: header, every section that has answers (plain sections as label / answer boxes, list
 * sections as one block per tank / sump / dispenser), the site plan drawn to the page (clean, and again over the aerial
 * picture when there is one), then the photos four to a page under the section they were taken for.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Document, Page, Text, View, Image, Svg, Rect, Ellipse, Polyline, G, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'
import {
  type SiteSurveyRow, type Section, type Item, type Extra, type SitePlan, type PlanShape, type SurveyPhoto,
  SECTIONS, BOARD, itemFilled, itemName, photoRef, surveyTitle, surveyCounts, fmtDate, shapeDef, lineDef, feet, fmtFeet,
} from '@/lib/site-survey'

export const SITE_SURVEY_BUCKET = 'construction-docs'

export async function loadSiteSurvey(admin: SupabaseClient, id: string, companyId: string): Promise<SiteSurveyRow | null> {
  const { data } = await admin.from('site_surveys').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  return (data as SiteSurveyRow | null) ?? null
}

Font.registerHyphenationCallback(word => [word])

const INK = '#111827', RED = '#D71920', SOFT = '#f3f4f6'
const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 40, paddingHorizontal: 34, fontSize: 9, fontFamily: 'Helvetica', color: INK, lineHeight: 1.25 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', lineHeight: 1.15, marginBottom: 2 },
  sub: { fontSize: 9, color: '#4b5563', marginTop: 2 },
  rule: { borderBottomWidth: 2, borderBottomColor: RED, marginTop: 6, marginBottom: 8 },
  band: { backgroundColor: INK, color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 9.5, paddingVertical: 3.5, paddingHorizontal: 6, marginTop: 10, marginBottom: 4 },
  itemHead: { backgroundColor: SOFT, fontFamily: 'Helvetica-Bold', fontSize: 9, paddingVertical: 2.5, paddingHorizontal: 6, marginTop: 5, borderLeftWidth: 3, borderLeftColor: RED },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '33.33%', paddingVertical: 2.5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
  wide: { width: '100%', paddingVertical: 2.5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
  k: { fontSize: 7, color: '#6b7280' },
  v: { fontSize: 9.5 },
  foot: { position: 'absolute', bottom: 16, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: '#6b7280' },
  photoCell: { width: '50%', padding: 5 },
  photo: { width: '100%', height: 240, objectFit: 'contain', backgroundColor: SOFT },
  cap: { fontSize: 8, marginTop: 2, color: '#374151' },
})

const yn = (v: string) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v)

function Answers({ sec, v, extra }: { sec: Section; v: Record<string, string>; extra?: Extra[] }) {
  const rows = sec.fields.filter(f => v[f.key]).map(f => ({ k: f.label, v: f.type === 'yn' ? yn(v[f.key]) : v[f.key], wide: f.wide || f.type === 'textarea' || v[f.key].length > 44 }))
  for (const e of extra ?? []) rows.push({ k: e.label || 'Other', v: e.value, wide: e.value.length > 44 })
  return (
    <View style={s.grid}>
      {rows.map((r, i) => (
        <View key={i} style={r.wide ? s.wide : s.cell} wrap={r.wide}>
          <Text style={s.k}>{r.k}</Text><Text style={s.v}>{r.v}</Text>
        </View>
      ))}
    </View>
  )
}

/** The plan on the page. `over` = draw on top of the aerial picture (lighter fills so the ground shows through). */
function PlanDrawing({ plan, size, aerial }: { plan: SitePlan; size: number; aerial?: Buffer }) {
  const k = size / BOARD
  const shapes = plan.elements.filter((e): e is PlanShape => e.kind === 'shape')
  const order = ['building', 'canopy', 'tank_pad', 'tank']
  // Big boxes first (store, canopy, pad, tanks) so the small marks sit on top of them.
  const big = shapes.filter(e => order.includes(e.type)).sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
  const small = shapes.filter(e => !order.includes(e.type))
  const scaleFt = feet(BOARD, plan)
  const barFt = scaleFt ? [100, 50, 25, 10].find(n => n < scaleFt / 3) ?? 10 : null
  return (
    <View style={{ width: size, height: size, borderWidth: 1, borderColor: INK, position: 'relative', overflow: 'hidden' }}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
      {aerial ? <Image src={{ data: aerial, format: 'jpg' }} style={{ position: 'absolute', top: 0, left: 0, width: size, height: size }} /> : null}
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', top: 0, left: 0 }}>
        {plan.elements.filter(e => e.kind === 'line').map(e => {
          if (e.kind !== 'line') return null
          const d = lineDef(e.type)
          return <Polyline key={e.id} points={e.pts.map(p => `${p[0] * k},${p[1] * k}`).join(' ')} stroke={d.color} strokeWidth={d.width * k * 1.6} fill="none" strokeDasharray={d.dash ? d.dash.split(' ').map(n => Number(n) * k * 1.4).join(' ') : undefined} />
        })}
        {[...big, ...small].map(e => {
          const d = shapeDef(e.type)
          if (e.type === 'label') return null
          const w = e.w * k, h = e.h * k
          const fill = d.fill === 'none' ? undefined : d.fill
          return (
            <G key={e.id} transform={`translate(${e.x * k}, ${e.y * k}) rotate(${e.rot})`}>
              {d.round && !['tank'].includes(e.type)
                ? <Ellipse cx={0} cy={0} rx={w / 2} ry={h / 2} fill={fill} fillOpacity={aerial ? 0.75 : 1} stroke={d.stroke} strokeWidth={1} />
                : <Rect x={-w / 2} y={-h / 2} width={w} height={h} rx={e.type === 'tank' ? h / 2 : 0} fill={fill} fillOpacity={aerial ? (order.includes(e.type) && e.type !== 'tank' ? 0.25 : 0.75) : 1} stroke={d.stroke} strokeWidth={order.includes(e.type) ? 1.4 : 1} />}
            </G>
          )
        })}
      </Svg>
      {/* Labels as page text (crisper than SVG text, and they never rotate upside down). */}
      {[...big, ...small].map(e => {
        const d = shapeDef(e.type)
        // Sizes print on the store, canopy and tank pad only: those are what the picture measures.
        const sized = ['building', 'canopy', 'tank_pad'].includes(e.type)
        const fa = feet(e.w, plan), fb = feet(e.h, plan)
        const text = `${e.label}${sized && fa && fb ? ` ${fmtFeet(Math.max(fa, fb))} x ${fmtFeet(Math.min(fa, fb))}` : ''}`.trim()
        if (!text) return null
        const fs = e.type === 'label' ? 8 : d.small ? 5.5 : e.type === 'dispenser' ? 6 : 7
        const boxW = text.length * fs * 0.56 + 6
        // Small marks are labelled underneath; the tank pad along its top edge so the tanks inside stay readable.
        const rad = (e.rot * Math.PI) / 180
        const halfTall = (Math.abs(e.w * Math.sin(rad)) + Math.abs(e.h * Math.cos(rad))) * k / 2
        const top = d.small || e.type === 'dispenser' ? e.y * k + halfTall + 1 : e.type === 'tank_pad' || e.type === 'canopy' ? e.y * k - halfTall - fs - 3 : e.y * k - fs / 1.6
        return (
          <Text key={`t${e.id}`} style={{ position: 'absolute', left: e.x * k - boxW / 2, top, width: boxW, textAlign: 'center', fontSize: fs, fontFamily: 'Helvetica-Bold', color: aerial ? '#fff' : INK, backgroundColor: aerial ? '#111827' : undefined }}>{text}</Text>
        )
      })}
      {/* North arrow and scale bar */}
      <View style={{ position: 'absolute', top: 6, right: 8, alignItems: 'center' }}>
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: aerial ? '#fff' : INK }}>N</Text>
        <Svg width={10} height={16} viewBox="0 0 10 16"><Polyline points="5,0 10,16 5,12 0,16 5,0" fill={aerial ? '#fff' : INK} stroke={aerial ? '#fff' : INK} strokeWidth={0.5} /></Svg>
      </View>
      {barFt && scaleFt ? (
        <View style={{ position: 'absolute', bottom: 6, left: 8 }}>
          <View style={{ width: (barFt / scaleFt) * size, height: 4, backgroundColor: aerial ? '#fff' : INK }} />
          <Text style={{ fontSize: 7, color: aerial ? '#fff' : INK, fontFamily: 'Helvetica-Bold' }}>{barFt} ft</Text>
        </View>
      ) : null}
    </View>
  )
}

type Loaded = { photo: SurveyPhoto; bytes: Buffer }

const Foot = ({ text }: { text: string }) => (
  <View style={s.foot} fixed>
    <Text>{text}</Text>
    <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
  </View>
)

export function SiteSurveyPdfDoc({ r, photos, aerial }: { r: SiteSurveyRow; photos: Loaded[]; aerial?: Buffer }) {
  const d = r.data ?? { one: {}, lists: {}, extra: {} }
  const plan = r.plan
  const hasPlan = !!plan?.elements?.length || !!aerial
  const title = surveyTitle(r)
  const foot = `Rappahannock Petroleum LLC · Site Survey · ${title} · ${fmtDate(r.survey_date)}`
  // Photos grouped the way the form shows them: by section, then by the tank / sump / dispenser inside it.
  const groups: { head: string; list: Loaded[] }[] = []
  const used = new Set<string>()
  const take = (ref: string, head: string) => { const list = photos.filter(p => p.photo.ref === ref); if (list.length) { groups.push({ head, list }); list.forEach(p => used.add(p.photo.id)) } }
  for (const sec of SECTIONS) {
    take(photoRef(sec.key), sec.title)
    if (sec.list) (d.lists[sec.key] ?? []).forEach((it, i) => take(photoRef(sec.key, it.id), `${sec.title} · ${itemName(sec, it, i)}`))
  }
  take('plan', 'Site drawing (photo of the sketch)')
  const rest = photos.filter(p => !used.has(p.photo.id))
  if (rest.length) groups.push({ head: 'Other photos', list: rest })

  return (
    <Document title={`${title} Site Survey`} author="Rappahannock Petroleum LLC">
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>SITE SURVEY</Text>
        <Text style={s.sub}>Rappahannock Petroleum LLC · 225 Ritter Rd, Winchester, VA 22602 · (540) 869-5033</Text>
        <View style={s.rule} />
        <View style={s.grid}>
          {[['Site', r.site_number], ['Brand / name', r.site_name], ['Survey date', fmtDate(r.survey_date)], ['Surveyed by', r.tech_name], ['Company', r.survey_company], ['On the survey', surveyCounts(d)]].filter(x => x[1]).map(([k, v]) => (
            <View key={k as string} style={s.cell}><Text style={s.k}>{k}</Text><Text style={s.v}>{v}</Text></View>
          ))}
          {r.address ? <View style={s.wide}><Text style={s.k}>Address</Text><Text style={s.v}>{r.address}</Text></View> : null}
        </View>

        {SECTIONS.map(sec => {
          if (sec.list) {
            const items = (d.lists[sec.key] ?? []).map((it, i) => ({ it, i })).filter(x => itemFilled(x.it))
            if (!items.length) return null
            return (
              <View key={sec.key}>
                {items.map(({ it, i }: { it: Item; i: number }, n) => (
                  <View key={it.id} wrap={false}>
                    {n === 0 ? <Text style={s.band}>{sec.title.toUpperCase()} · {items.length}</Text> : null}
                    <Text style={s.itemHead}>{itemName(sec, it, i)}</Text>
                    <Answers sec={sec} v={it.v} extra={it.extra} />
                  </View>
                ))}
              </View>
            )
          }
          const v = d.one[sec.key] ?? {}, extra = d.extra[sec.key]
          if (!Object.values(v).some(Boolean) && !extra?.length) return null
          return (
            <View key={sec.key}>
              <Text style={s.band} minPresenceAhead={40}>{sec.title.toUpperCase()}</Text>
              <Answers sec={sec} v={v} extra={extra} />
            </View>
          )
        })}
        <Foot text={foot} />
      </Page>

      {hasPlan && plan ? (
        <Page size="LETTER" style={s.page}>
          <Text style={s.title}>SITE PLAN</Text>
          <Text style={s.sub}>{title}{r.address ? ` · ${r.address}` : ''} · Field sketch for reference, not a survey of record.{plan.aerial ? ` Sizes are scaled from the aerial picture (${Math.round(plan.aerial.span_m * 3.281)} ft across).` : ' Not to scale.'}</Text>
          <View style={s.rule} />
          <View style={{ alignItems: 'center' }}><PlanDrawing plan={plan} size={540} /></View>
          <View style={[s.grid, { marginTop: 8 }]}>
            {['building', 'canopy', 'tank_pad', 'tank', 'dispenser', 'stp', 'fill', 'vent', 'estop', 'atg', 'well'].filter(t => plan.elements.some(e => e.kind === 'shape' && e.type === t)).map(t => {
              const def = shapeDef(t as PlanShape['type'])
              return <View key={t} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 3 }}><View style={{ width: 10, height: 8, backgroundColor: def.fill === 'none' ? '#fff' : def.fill, borderWidth: 0.8, borderColor: def.stroke, marginRight: 3 }} /><Text style={{ fontSize: 7.5 }}>{def.label}</Text></View>
            })}
            {['product', 'vapor', 'conduit', 'property'].filter(t => plan.elements.some(e => e.kind === 'line' && e.type === t)).map(t => {
              const def = lineDef(t as 'product')
              return <View key={t} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 12, marginBottom: 3 }}><View style={{ width: 14, height: 2, backgroundColor: def.color, marginRight: 3 }} /><Text style={{ fontSize: 7.5 }}>{def.label}</Text></View>
            })}
          </View>
          {plan.note ? <Text style={{ fontSize: 8, color: '#4b5563', marginTop: 4 }}>{plan.note}</Text> : null}
          <Foot text={foot} />
        </Page>
      ) : null}

      {aerial && plan ? (
        <Page size="LETTER" style={s.page}>
          <Text style={s.title}>SITE PLAN OVER THE AERIAL</Text>
          <Text style={s.sub}>{title} · North is up · Picture: {plan.aerial?.source ?? 'aerial imagery'}</Text>
          <View style={s.rule} />
          <View style={{ alignItems: 'center' }}><PlanDrawing plan={plan} size={540} aerial={aerial} /></View>
          <Foot text={foot} />
        </Page>
      ) : null}

      {groups.length ? (
        <Page size="LETTER" style={s.page}>
          <Text style={s.title}>PHOTOS</Text>
          <View style={s.rule} />
          {groups.map((g, gi) => (
            <View key={gi}>
              <Text style={s.band} minPresenceAhead={260}>{g.head.toUpperCase()} · {g.list.length}</Text>
              <View style={s.grid}>
                {g.list.map(({ photo, bytes }) => (
                  <View key={photo.id} style={s.photoCell} wrap={false}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
                    <Image src={{ data: bytes, format: 'jpg' }} style={s.photo} />
                    {photo.caption ? <Text style={s.cap}>{photo.caption}</Text> : null}
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Foot text={foot} />
        </Page>
      ) : null}
    </Document>
  )
}

/** Photos and the aerial picture are shrunk on the way in so a survey with a hundred pictures still makes a PDF that can be emailed. */
export async function renderSiteSurveyPdf(admin: SupabaseClient, r: SiteSurveyRow): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const list = r.photos ?? []
  const px = list.length > 60 ? 800 : 1100
  const photos: Loaded[] = []
  for (let i = 0; i < list.length; i += 6) {
    const got = await Promise.all(list.slice(i, i + 6).map(async photo => {
      const { data } = await admin.storage.from(SITE_SURVEY_BUCKET).download(photo.path)
      if (!data) return null
      try { return { photo, bytes: await sharp(Buffer.from(await data.arrayBuffer())).rotate().resize({ width: px, height: px, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer() } }
      catch { return null }
    }))
    photos.push(...got.filter((x): x is Loaded => !!x))
  }
  let aerial: Buffer | undefined
  if (r.plan?.aerial?.path) {
    const { data } = await admin.storage.from(SITE_SURVEY_BUCKET).download(r.plan.aerial.path)
    if (data) { try { aerial = await sharp(Buffer.from(await data.arrayBuffer())).jpeg({ quality: 80 }).toBuffer() } catch { aerial = undefined } }
  }
  return renderToBuffer(<SiteSurveyPdfDoc r={r} photos={photos} aerial={aerial} />)
}
