/**
 * The accident report as a PDF: company name and title, then each section as label / answer boxes (only the questions
 * that were asked print), the employee signature, and the photos four to a page.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'
import { type AccidentRow, ACCIDENT_SECTIONS, ACCIDENT_TITLE, isShown, displayValue, fmtDate } from '@/lib/accident'

export const ACCIDENT_BUCKET = 'construction-docs'

export async function loadAccident(admin: SupabaseClient, id: string, companyId: string): Promise<AccidentRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { data } = await admin.from('accident_reports').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  return (data as AccidentRow | null) ?? null
}

// Never split a word across lines.
Font.registerHyphenationCallback(word => [word])

const INK = '#000', PEN = '#0b2f8a', RULE = '#9aa0a6'
const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 38, paddingHorizontal: 40, fontSize: 9.5, fontFamily: 'Helvetica', color: INK, lineHeight: 1.25 },
  company: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  title: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 5, marginBottom: 6 },
  band: { backgroundColor: '#1f2937', color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 9, paddingVertical: 3, paddingHorizontal: 5, marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderLeftWidth: 0.6, borderLeftColor: RULE, paddingRight: 1 },
  cell: { width: '50%', borderRightWidth: 0.6, borderBottomWidth: 0.6, borderColor: RULE, paddingVertical: 3, paddingHorizontal: 5, minHeight: 27 },
  wide: { width: '100%' },
  label: { fontSize: 7, color: '#444', marginBottom: 1.5 },
  pen: { fontFamily: 'Helvetica-Bold', color: PEN, fontSize: 10 },
  sigRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 14 },
  sigLine: { borderBottomWidth: 0.8, borderBottomColor: INK, minHeight: 30, justifyContent: 'flex-end', paddingHorizontal: 4 },
  sig: { height: 30, width: 150, objectFit: 'contain' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  photo: { width: '49%', height: 300, objectFit: 'contain', marginBottom: 8, borderWidth: 0.6, borderColor: RULE },
  foot: { position: 'absolute', bottom: 18, left: 40, right: 40, fontSize: 7, color: '#555', textAlign: 'center' },
})

export function AccidentPdfDoc({ r, photos }: { r: AccidentRow; photos: Buffer[] }) {
  const foot = <Text style={s.foot} fixed>Rappahannock Petroleum LLC · Accident report · filled out in RP Intelligence{r.status === 'draft' ? ' · DRAFT (not finished)' : ''} · Confidential</Text>
  const pages: Buffer[][] = []
  for (let i = 0; i < photos.length; i += 4) pages.push(photos.slice(i, i + 4))
  return (
    <Document title={ACCIDENT_TITLE} author="Rappahannock Petroleum LLC">
      <Page size="LETTER" style={s.page}>
        <View style={s.head}>
          <View>
            <Text style={s.company}>Rappahannock Petroleum LLC</Text>
            <Text style={s.title}>{ACCIDENT_TITLE}</Text>
          </View>
          <Text style={{ fontSize: 8, color: '#444' }}>{r.completed_at ? `Submitted ${fmtDate(new Date(r.completed_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }))}` : 'Not submitted yet'}</Text>
        </View>

        {ACCIDENT_SECTIONS.map(sec => {
          const fields = sec.fields.filter(f => isShown(f, r))
          return (
            <View key={sec.title} wrap={sec.fields.some(f => f.key === 'description')}>
              <Text style={s.band}>{sec.title.toUpperCase()}</Text>
              <View style={s.grid}>
                {fields.map((f, i) => {
                  // A lone half-width cell at the end of a row stretches so the grid has no hole.
                  const half = !f.wide && f.type !== 'textarea'
                  const halvesBefore = (() => { let n = 0; for (let j = i - 1; j >= 0; j--) { const p = fields[j]; if (p.wide || p.type === 'textarea') break; n++ } return n })()
                  const next = fields[i + 1]
                  const alone = half && halvesBefore % 2 === 0 && (!next || next.wide || next.type === 'textarea')
                  return (
                    <View key={f.key} style={[s.cell, (!half || alone) ? s.wide : {}]} wrap={false}>
                      <Text style={s.label}>{f.label}</Text>
                      <Text style={s.pen}>{displayValue(f, r[f.key]) || ' '}</Text>
                    </View>
                  )
                })}
              </View>
            </View>
          )
        })}

        <View style={s.sigRow} wrap={false}>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Employee signature:</Text>
          <View style={[s.sigLine, { width: 190, marginLeft: 6 }]}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
            {r.signature ? <Image src={r.signature} style={s.sig} /> : <Text> </Text>}
          </View>
          <Text style={{ fontFamily: 'Helvetica-Bold', marginLeft: 14 }}>Date:</Text>
          <View style={[s.sigLine, { width: 90, marginLeft: 6 }]}>
            <Text style={s.pen}>{r.signed_at ? fmtDate(new Date(r.signed_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })) : ' '}</Text>
          </View>
        </View>
        <Text style={{ fontSize: 7.5, color: '#444', marginTop: 5 }}>I certify that the information in this report is true and complete to the best of my knowledge.</Text>
        {foot}
      </Page>

      {pages.map((group, pi) => (
        <Page key={pi} size="LETTER" style={s.page}>
          <View style={s.head}>
            <Text style={s.title}>Accident photos · {[r.unit_number, r.employee_name, fmtDate(r.accident_date)].filter(Boolean).join(' · ')}</Text>
            <Text style={{ fontSize: 8, color: '#444' }}>{pi * 4 + 1}–{pi * 4 + group.length} of {photos.length}</Text>
          </View>
          <View style={s.photoGrid}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
            {group.map((buf, i) => <Image key={i} src={{ data: buf, format: 'jpg' }} style={s.photo} />)}
          </View>
          {foot}
        </Page>
      ))}
    </Document>
  )
}

/** Pulls the photos out of storage (a photo that fails to download is skipped) and draws the PDF. */
export async function renderAccidentPdf(admin: SupabaseClient, r: AccidentRow): Promise<Buffer> {
  const photos: Buffer[] = []
  for (const ph of r.photos ?? []) {
    const { data } = await admin.storage.from(ACCIDENT_BUCKET).download(ph.path)
    if (data) photos.push(Buffer.from(await data.arrayBuffer()))
  }
  return renderToBuffer(<AccidentPdfDoc r={r} photos={photos} />)
}
