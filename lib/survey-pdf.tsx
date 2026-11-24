/**
 * The ICON Sump Survey package as a PDF: one worksheet page per sump laid out like ICON's own form (header boxes,
 * Product / Vapor-Vent / Conduit entry tables, sump-type boxes, active-leak, tank-lid measurements, structural damage),
 * then the photos two to a page with the sump and entry they belong to, the way Trae's "Sump Survey Photos" packages read.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { type SurveyRow, type SumpRow, type PhotoRow, type SurveyEntry, ENTRY_KINDS, LID_FIELDS, sumpTypeLine, surveyTitle, surveyTypeLabel } from '@/lib/survey'

const BUCKET = 'construction-docs'
export type SurveyBundle = { survey: SurveyRow; sumps: SumpRow[]; photos: (PhotoRow & { bytes?: Buffer })[] }

export async function loadSurveyBundle(admin: SupabaseClient, id: string, companyId: string, withPhotos = true): Promise<SurveyBundle | null> {
  const { data: survey } = await admin.from('con_surveys').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  if (!survey) return null
  const { data: sumps } = await admin.from('con_survey_sumps').select('*').eq('survey_id', id).order('sort_order')
  const { data: photos } = await admin.from('con_survey_photos').select('*').eq('survey_id', id).order('sort_order')
  const out: SurveyBundle = { survey: survey as SurveyRow, sumps: (sumps ?? []) as SumpRow[], photos: (photos ?? []) as PhotoRow[] }
  if (withPhotos) {
    // react-pdf's JPEG reader trips on iPhone EXIF headers, so every photo is re-encoded (auto-rotated, EXIF dropped,
    // long side 1400 px) before it goes on the page. Also keeps the PDF ICON receives at a sane size.
    const sharp = (await import('sharp')).default
    for (const ph of out.photos) {
      const { data } = await admin.storage.from(BUCKET).download(ph.storage_path)
      if (!data) continue
      try { ph.bytes = await sharp(Buffer.from(await data.arrayBuffer())).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer() }
      catch { ph.bytes = undefined }
    }
  }
  return out
}

const RED = '#D71920', INK = '#111', GRAY = '#e5e7eb', LIGHT = '#f3f4f6'
const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 32, fontSize: 9, fontFamily: 'Helvetica', color: INK },
  band: { backgroundColor: RED, color: '#fff', paddingVertical: 4, paddingHorizontal: 8, fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between' },
  h1: { color: RED, fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 8 },
  row: { flexDirection: 'row' },
  kv: { flexDirection: 'row', marginBottom: 3 },
  k: { width: 70, color: '#444' },
  v: { flex: 1, borderBottomWidth: 0.5, borderBottomColor: '#999', paddingBottom: 1 },
  box: { width: 9, height: 9, borderWidth: 0.8, borderColor: INK, marginRight: 3, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: INK },
  sec: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 8, marginBottom: 3 },
  th: { backgroundColor: GRAY, fontFamily: 'Helvetica-Bold', fontSize: 8, paddingVertical: 3, paddingHorizontal: 3, borderWidth: 0.5, borderColor: '#777' },
  td: { fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 3, borderWidth: 0.5, borderColor: '#777', minHeight: 16 },
  foot: { position: 'absolute', bottom: 14, left: 32, right: 32, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: '#666' },
  photo: { width: 250, height: 250, objectFit: 'contain', backgroundColor: LIGHT },
  cap: { fontSize: 8, marginTop: 3, color: '#333' },
})
const COLS = [{ w: 28, t: '' }, { w: 62, t: 'Bolted /\n# bolts' }, { w: 52, t: 'Thread\nnut' }, { w: 44, t: 'Other' }, { w: 120, t: 'Pipe mfr & size\nor pipe OD' }, { w: 225, t: 'Notes (angled or offset entry, no fitting, fitting backwards, etc.)' }]

const Box = ({ on, label }: { on: boolean; label: string }) => (
  <View style={[s.row, { alignItems: 'center', marginRight: 10 }]}><View style={[s.box, on ? s.boxOn : {}]} /><Text>{label}</Text></View>
)

function EntryTable({ title, rows, max, kind }: { title: string; rows: SurveyEntry[]; max: number; kind: string }) {
  const byN = new Map(rows.map(r => [r.n, r]))
  const count = Math.max(1, Math.min(max, Math.max(...rows.map(r => r.n), 1)))
  return (
    <View wrap={false}>
      <Text style={s.sec}>{title}</Text>
      <View style={s.row}>{COLS.map((c, i) => <Text key={i} style={[s.th, { width: c.w }]}>{c.t}</Text>)}</View>
      {Array.from({ length: count }, (_, i) => i + 1).map(n => {
        const e = byN.get(n)
        return (
          <View key={n} style={s.row}>
            <Text style={[s.td, { width: COLS[0].w, fontFamily: 'Helvetica-Bold' }]}>{kind}{n}</Text>
            <Text style={[s.td, { width: COLS[1].w }]}>{e?.fitting === 'bolted' ? `Bolted${e.bolts ? ` / ${e.bolts}` : ''}` : ''}</Text>
            <Text style={[s.td, { width: COLS[2].w }]}>{e?.fitting === 'thread_nut' ? 'X' : ''}</Text>
            <Text style={[s.td, { width: COLS[3].w }]}>{e?.fitting === 'other' ? 'X' : ''}</Text>
            <Text style={[s.td, { width: COLS[4].w }]}>{[e?.pipe, e?.od].filter(Boolean).join(' · ')}</Text>
            <Text style={[s.td, { width: COLS[5].w }]}>{e?.notes ?? ''}</Text>
          </View>
        )
      })}
    </View>
  )
}

function SumpPage({ b, sump, idx }: { b: SurveyBundle; sump: SumpRow; idx: number }) {
  const sv = b.survey
  const ws = sump.worksheets ?? ['fittings']
  const refs = (k: string) => sump.entries.filter(e => e.kind === k)
  return (
    <Page size="LETTER" style={s.page}>
      <View style={s.band}><Text>{surveyTypeLabel(sv.survey_type).toUpperCase()}  |  {surveyTitle(sv).toUpperCase()}</Text><Text>Sump {idx + 1} of {b.sumps.length} · {sump.sump_label}</Text></View>
      <Text style={s.h1}>Sump Survey Worksheet - Fittings</Text>
      <View style={s.row}>
        <View style={{ width: '48%' }}>
          <View style={s.kv}><Text style={s.k}>Date:</Text><Text style={s.v}>{sv.survey_date}</Text></View>
          <View style={s.kv}><Text style={s.k}>Company:</Text><Text style={s.v}>Rappahannock Petroleum</Text></View>
          <View style={s.kv}><Text style={s.k}>Tech:</Text><Text style={s.v}>{sv.tech_name ?? ''}</Text></View>
          <View style={s.kv}><Text style={s.k}>Tech phone:</Text><Text style={s.v}>{sv.tech_phone ?? ''}</Text></View>
          <View style={s.kv}><Text style={s.k}>Tech email:</Text><Text style={s.v}>{sv.tech_email ?? ''}</Text></View>
        </View>
        <View style={{ width: '4%' }} />
        <View style={{ width: '48%' }}>
          <View style={s.kv}><Text style={s.k}>Site ID:</Text><Text style={s.v}>{[sv.site_number, sv.site_name].filter(Boolean).join(' · ')}</Text></View>
          <View style={s.kv}><Text style={s.k}>Address:</Text><Text style={s.v}>{sv.address ?? ''}</Text></View>
          <View style={s.kv}><Text style={s.k}>Sump ID:</Text><Text style={s.v}>{sump.sump_label}</Text></View>
          <View style={[s.kv, { marginTop: 2 }]}><Text style={s.k}>Sump type:</Text><Box on={sump.location === 'tank'} label="Tank" /><Box on={sump.location === 'disp'} label="Disp" /><Box on={sump.profile === 'flat'} label="Flat" /></View>
          <View style={s.kv}><Text style={s.k}></Text><Box on={sump.material === 'poly'} label="Poly" /><Box on={sump.material === 'fiberglass'} label="Fiberglass" /><Box on={sump.profile === 'curved'} label="Curved" /></View>
          <View style={s.kv}><Text style={s.k}>Water leak?</Text><Box on={sump.active_leak === true} label="Yes" /><Box on={sump.active_leak === false} label="No" /></View>
        </View>
      </View>
      {ws.includes('fittings') && ENTRY_KINDS.map(k => <EntryTable key={k.kind} title={k.label} rows={refs(k.kind)} max={k.max} kind={k.kind} />)}
      {ws.includes('lid') && (
        <View wrap={false}>
          <Text style={[s.h1, { marginTop: 12 }]}>Sump Survey Worksheet - Tank Sump Lid</Text>
          {LID_FIELDS.map(f => <View key={f.key} style={s.kv}><Text style={{ width: 230 }}>{f.label}:</Text><Text style={[s.v, { maxWidth: 90 }]}>{sump.lid?.[f.key] ?? ''}</Text></View>)}
          <View style={s.kv}><Text style={{ width: 230 }}>f. Sump type:</Text><Box on={sump.material === 'poly'} label="Poly" /><Box on={sump.material === 'fiberglass'} label="Fiberglass" /></View>
        </View>
      )}
      {ws.includes('damage') && (
        <View wrap={false}>
          <Text style={[s.h1, { marginTop: 12 }]}>Sump Survey Worksheet - Structural Damage</Text>
          <Text style={{ marginBottom: 3 }}>a. Description and general measurements of the structural repair issue (crack, puncture, hole, seam):</Text>
          <View style={{ borderWidth: 0.8, borderColor: INK, minHeight: 60, padding: 5 }}><Text>{sump.damage ?? ''}</Text></View>
          <View style={[s.kv, { marginTop: 4 }]}><Text style={{ width: 230 }}>b. Sump type:</Text><Box on={sump.material === 'poly'} label="Poly" /><Box on={sump.material === 'fiberglass'} label="Fiberglass" /></View>
        </View>
      )}
      {sump.notes ? <View style={{ marginTop: 8 }}><Text style={s.sec}>Tech notes</Text><Text>{sump.notes}</Text></View> : null}
      <Text style={{ marginTop: 10, textAlign: 'center', fontFamily: 'Helvetica-Bold' }}>Email with pictures to techsupport@icontainment.com</Text>
      <View style={s.foot} fixed><Text>Rappahannock Petroleum · field survey recorded in RP Intelligence</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
    </Page>
  )
}

function PhotoPages({ b }: { b: SurveyBundle }) {
  const pages: { sump: SumpRow | null; items: (PhotoRow & { bytes?: Buffer })[] }[] = []
  const groups: [SumpRow | null, (PhotoRow & { bytes?: Buffer })[]][] = [...b.sumps.map(sm => [sm, b.photos.filter(p => p.sump_id === sm.id && p.bytes)] as [SumpRow, (PhotoRow & { bytes?: Buffer })[]]), [null, b.photos.filter(p => !p.sump_id && p.bytes)]]
  for (const [sump, items] of groups) for (let i = 0; i < items.length; i += 2) pages.push({ sump, items: items.slice(i, i + 2) })
  return (
    <>
      {pages.map((pg, i) => (
        <Page key={i} size="LETTER" style={s.page}>
          <View style={s.band}><Text>SUMP SURVEY  |  {surveyTitle(b.survey).toUpperCase()}</Text><Text>{pg.sump ? pg.sump.sump_label : 'Site'} · photos</Text></View>
          {pg.sump && <Text style={{ marginBottom: 6, color: '#444' }}>{sumpTypeLine(pg.sump)}</Text>}
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            {pg.items.map(ph => (
              <View key={ph.id} style={{ width: 252 }}>
                <Image src={{ data: ph.bytes!, format: 'jpg' }} style={s.photo} />
                <Text style={s.cap}>{[ph.entry_ref, ph.caption].filter(Boolean).join(' · ') || ph.file_name || ''}</Text>
              </View>
            ))}
          </View>
          <View style={s.foot} fixed><Text>Rappahannock Petroleum · field survey recorded in RP Intelligence</Text><Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} /></View>
        </Page>
      ))}
    </>
  )
}

export async function renderSurveyPdf(b: SurveyBundle): Promise<Buffer> {
  const doc = (
    <Document title={`${surveyTitle(b.survey)} sump survey ${b.survey.survey_date}`} author="Rappahannock Petroleum">
      {b.sumps.map((sm, i) => <SumpPage key={sm.id} b={b} sump={sm} idx={i} />)}
      <PhotoPages b={b} />
    </Document>
  )
  return Buffer.from(await renderToBuffer(doc))
}
