/**
 * The finished pre-trip inspection printed like the paper sheet: title, the instruction paragraph, the highlighted
 * vehicle / trailer number bar, the checklist with OK / Remark / N/A boxes, Remarks, and the Date / Checked by bar.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from '@react-pdf/renderer'
import { type PretripRow, type Mark, MARKS, PRETRIP_INTRO, pretripSections, pretripTitle, unitLabel, fmtDate } from '@/lib/pretrip'

export async function loadPretrip(admin: SupabaseClient, id: string, companyId: string): Promise<PretripRow | null> {
  const { data } = await admin.from('pretrip_inspections').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  return (data as PretripRow | null) ?? null
}

// Never split a word across lines ("follow-ing").
Font.registerHyphenationCallback(word => [word])

const INK = '#000', HILITE = '#ffe14d', PEN = '#0b2f8a', BOX_W = 46
const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 34, paddingHorizontal: 48, fontSize: 9.5, fontFamily: 'Helvetica', color: INK, lineHeight: 1.25 },
  title: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  bold: { fontFamily: 'Helvetica-Bold' },
  bar: { backgroundColor: HILITE, flexDirection: 'row', alignItems: 'flex-end', paddingVertical: 4, paddingHorizontal: 4, marginTop: 8 },
  fill: { borderBottomWidth: 0.8, borderBottomColor: INK, minWidth: 110, paddingHorizontal: 4, marginLeft: 4 },
  pen: { fontFamily: 'Helvetica-Bold', color: PEN, fontSize: 10.5 },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { width: BOX_W, borderWidth: 0.8, borderColor: INK, marginLeft: -0.8, marginTop: -0.8, alignItems: 'center', justifyContent: 'center', minHeight: 13.5 },
  head: { width: BOX_W, textAlign: 'center', fontSize: 9 },
  remarks: { borderBottomWidth: 0.8, borderBottomColor: INK, minHeight: 14, paddingTop: 2 },
  sig: { height: 26, width: 130, objectFit: 'contain' },
  foot: { position: 'absolute', bottom: 18, left: 48, right: 48, fontSize: 7, color: '#555', textAlign: 'center' },
})

const Cells = ({ mark }: { mark: Mark | undefined }) => (
  <View style={[s.row, { marginLeft: 8 }]}>
    {MARKS.map(m => <View key={m.value} style={s.cell}>{mark === m.value ? <Text style={[s.pen, { fontSize: 10 }]}>X</Text> : null}</View>)}
  </View>
)

export function PretripPdfDoc({ r }: { r: PretripRow }) {
  const sections = pretripSections(r.kind)
  const remarkLines = (r.remarks ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  while (remarkLines.length < 4) remarkLines.push('')
  return (
    <Document title={pretripTitle(r.kind)} author="Rappahannock Petroleum LLC">
      <Page size="LETTER" style={s.page}>
        <Text style={s.title}>{pretripTitle(r.kind)}</Text>
        <Text>{PRETRIP_INTRO}</Text>

        <View style={s.bar}>
          <Text style={s.bold}>{unitLabel(r.kind)}:</Text>
          <View style={s.fill}><Text style={s.pen}>{r.unit_number || ' '}</Text></View>
          {r.kind === 'trailer' && (<>
            <Text style={[s.bold, { marginLeft: 'auto' }]}>Equipment:</Text>
            <View style={s.fill}><Text style={s.pen}>{r.equipment || ' '}</Text></View>
          </>)}
        </View>

        <View style={[s.row, { justifyContent: 'flex-end', marginTop: 8, marginBottom: 3 }]}>
          {MARKS.map(m => <Text key={m.value} style={s.head}>{m.label}</Text>)}
        </View>

        {sections.map((sec, si) => (
          <View key={si}>
            {(sec.lead || sec.tail) && (
              <View style={[s.row, { marginTop: si ? 3 : 0, marginBottom: 1.5 }]} wrap={false}>
                <Text style={{ flex: 1 }}><Text style={s.bold}>{sec.lead}</Text>{sec.tail}</Text>
                <View style={{ width: BOX_W * 3 + 8 }} />
              </View>
            )}
            {sec.items.map(it => (
              <View key={it.key} style={s.row} wrap={false}>
                <Text style={{ flex: 1, paddingVertical: 1.5 }}>{it.lead ? <Text style={s.bold}>{it.lead}</Text> : null}{it.lead && it.text && !it.text.startsWith(',') ? ' ' : ''}{it.text}</Text>
                <Cells mark={r.results?.[it.key]} />
              </View>
            ))}
          </View>
        ))}

        <View style={{ marginTop: 8 }} wrap={false}>
          <Text>Remarks:</Text>
          {remarkLines.map((l, i) => <View key={i} style={s.remarks}><Text style={l ? s.pen : undefined}>{l || ' '}</Text></View>)}
        </View>

        <View style={[s.bar, { marginTop: 10 }]} wrap={false}>
          <Text style={s.bold}>Date:</Text>
          <View style={s.fill}><Text style={s.pen}>{fmtDate(r.inspection_date) || ' '}</Text></View>
          <Text style={[s.bold, { marginLeft: 14 }]}>Checked by:</Text>
          <View style={[s.fill, { minWidth: 150 }]}><Text style={s.pen}>{r.checked_by || ' '}</Text></View>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
          {r.signature ? <Image src={r.signature} style={[s.sig, { marginLeft: 8 }]} /> : null}
        </View>

        <Text style={s.foot} fixed>Rappahannock Petroleum LLC · filled out in RP Intelligence{r.status === 'draft' ? ' · DRAFT (not finished)' : ''}</Text>
      </Page>
    </Document>
  )
}

export async function renderPretripPdf(r: PretripRow): Promise<Buffer> {
  return renderToBuffer(<PretripPdfDoc r={r} />)
}
