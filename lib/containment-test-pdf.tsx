/**
 * The finished containment test as the state's own form: same title, same sections, same row labels and column counts
 * as the agency PDF, with the tech's entries typed in and checkboxes ticked.
 *   MD → MDE Catchment Basin and Containment Sump Test Report (3 items per page; certification + comments at the end)
 *   VA → DEQ Triennial Spill Bucket Integrity Testing (5 buckets per page) and Containment Sump / UDC Integrity Testing
 *        (6 sumps per page; full-height or low-liquid-level version)
 *   WV → WVDEP Spill and Overfill Testing Report Form §C (7 buckets per page) and Miscellaneous Testing Report Form §C
 *        (7 sumps per page)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReactNode } from 'react'
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { type TestRow, type ItemRow, type ItemKind, isBucket, itemTitle, RPS_COMPANY, CERT_TYPES } from '@/lib/containment-test'

export type TestBundle = { test: TestRow; items: ItemRow[] }

export async function loadTestBundle(admin: SupabaseClient, id: string, companyId: string): Promise<TestBundle | null> {
  const { data: test } = await admin.from('con_containment_tests').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
  if (!test) return null
  const { data: items } = await admin.from('con_containment_test_items').select('*').eq('test_id', id).order('sort_order')
  return { test: test as TestRow, items: (items ?? []) as ItemRow[] }
}

const INK = '#000', SHADE = '#d9d9d9', LIGHT = '#efefef'
const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 26, paddingHorizontal: 22, fontSize: 7.5, fontFamily: 'Helvetica', color: INK },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  sub: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  row: { flexDirection: 'row' },
  cell: { borderWidth: 0.6, borderColor: INK, paddingVertical: 2, paddingHorizontal: 3, marginLeft: -0.6, marginTop: -0.6 },
  lbl: { fontSize: 6.5, color: '#222' },
  val: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#0b2f8a' },
  sec: { backgroundColor: SHADE, fontFamily: 'Helvetica-Bold', fontSize: 9, paddingVertical: 2, paddingHorizontal: 4, borderWidth: 0.6, borderColor: INK, marginTop: 4 },
  note: { fontSize: 6.8, lineHeight: 1.25 },
  box: { width: 7, height: 7, borderWidth: 0.7, borderColor: INK, marginRight: 2, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 4.2, height: 4.2, backgroundColor: '#0b2f8a' },
  foot: { position: 'absolute', bottom: 10, left: 22, right: 22, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#444' },
  sig: { height: 22, objectFit: 'contain' },
})

/* ---------- small building blocks ---------- */
const V = ({ children }: { children?: ReactNode }) => <Text style={s.val}>{children ?? ' '}</Text>
const Box = ({ on, label, mr = 6 }: { on: boolean; label: string; mr?: number }) => (
  <View style={[s.row, { alignItems: 'flex-start', marginRight: mr, marginBottom: 1 }]}><View style={[s.box, { marginTop: 0.5 }]}>{on ? <View style={s.tick} /> : null}</View><Text style={label.length > 40 ? { flex: 1 } : undefined}>{label}</Text></View>
)
function Field({ label, value, w, flex }: { label: string; value?: string | null; w?: number; flex?: number }) {
  return <View style={[s.cell, w ? { width: w } : { flex: flex ?? 1 }]}><Text style={s.lbl}>{label}</Text><V>{value || ' '}</V></View>
}
const FieldRow = ({ children }: { children: ReactNode }) => <View style={[s.row, { marginLeft: 0.6 }]}>{children}</View>
const yn = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : null)
const fmtDate = (d: string | null | undefined) => { if (!d) return ''; const [y, m, dd] = d.split('-'); return y && m && dd ? `${m}/${dd}/${y}` : d }
const withUnit = (v: string | null | undefined) => (v ?? '').trim()
const cityLine = (t: TestRow) => [t.city, [t.state, t.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
const chunk = <T,>(arr: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out.length ? out : [[]] }

/** A form grid: a label column then N equal item columns, each row a label + a renderer per item (blank columns past the last item). */
type GridRow = { label: string; render?: (i: ItemRow) => ReactNode; fixed?: string; shade?: boolean; minH?: number; span?: ReactNode }
function Grid({ rows, items, cols, labelW = 118 }: { rows: GridRow[]; items: ItemRow[]; cols: number; labelW?: number }) {
  const slots: (ItemRow | null)[] = Array.from({ length: cols }, (_, k) => items[k] ?? null)
  return (
    <View style={{ marginLeft: 0.6, marginTop: 0.6 }}>
      {rows.map((r, ri) => (
        <View key={ri} style={s.row} wrap={false}>
          <View style={[s.cell, { width: labelW, minHeight: r.minH ?? 13, backgroundColor: r.shade ? LIGHT : undefined, justifyContent: 'center' }]}><Text style={{ fontSize: 6.8, fontFamily: r.shade ? 'Helvetica-Bold' : 'Helvetica' }}>{r.label}</Text></View>
          {r.span ? <View style={[s.cell, { flex: 1, minHeight: r.minH ?? 13, backgroundColor: r.shade ? LIGHT : undefined, justifyContent: 'center' }]}>{r.span}</View>
            : slots.map((it, k) => (
              <View key={k} style={[s.cell, { flex: 1, minHeight: r.minH ?? 13, justifyContent: 'center' }]}>
                {r.fixed ? <Text style={{ fontSize: 7 }}>{r.fixed}</Text> : it && r.render ? r.render(it) : <Text> </Text>}
              </View>
            ))}
        </View>
      ))}
    </View>
  )
}
const PF = (i: ItemRow, P = 'Pass', F = 'Fail') => <View style={s.row}><Box on={i.result === 'pass'} label={P} /><Box on={i.result === 'fail'} label={F} /></View>
const YN = (v: string | null, na = false) => <View style={[s.row, { flexWrap: 'wrap' }]}><Box on={v === 'yes'} label="Yes" /><Box on={v === 'no'} label="No" />{na ? <Box on={v === 'na'} label="N/A" /> : null}</View>
const Txt = (v: string | null | undefined) => <V>{v || ' '}</V>
const Pair = (a: string | null | undefined, b: string | null | undefined) => <V>{`${a || '   '}  |  ${b || '   '}`}</V>
function SigBlock({ t, w = 160 }: { t: TestRow; w?: number }) {
  // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
  return t.signature ? <Image src={t.signature} style={[s.sig, { width: w }]} /> : <Text> </Text>
}

/* ---------- MARYLAND (MDE) ---------- */
const MD_KINDS: { k: ItemKind; label: string }[] = [
  { k: 'spill_bucket', label: 'Spill Bucket' }, { k: 'stage1_bucket', label: 'Stage I Bucket' }, { k: 'udc', label: 'Dispenser Sump' },
  { k: 'stp', label: 'STP Sump' }, { k: 'tank_top', label: 'Tank Top Sump' }, { k: 'transition', label: 'Transition Sump' }, { k: 'vent_riser', label: 'Vent Riser Sump' }, { k: 'other', label: 'Other (Describe):' },
]
function MdPage({ t, items, page, pages, last }: { t: TestRow; items: ItemRow[]; page: number; pages: number; last: boolean }) {
  const rows: GridRow[] = [
    { label: 'Product:', render: i => Txt(i.product ? `${itemTitle(i)} · ${i.product}` : itemTitle(i)) },
    { label: 'Testing:', minH: 96, render: i => (
      <View><Text style={{ fontSize: 6.5, marginBottom: 1 }}>√ Check One</Text>
        {MD_KINDS.map(o => <View key={o.k}><Box on={i.kind === o.k} label={o.label} />{o.k === 'udc' ? <Text style={{ marginLeft: 9, fontSize: 7 }}>#{i.kind === 'udc' ? <Text style={s.val}> {i.label}</Text> : '______'}</Text> : null}{o.k === 'other' && i.kind === 'other' ? <Text style={[s.val, { marginLeft: 9 }]}>{i.kind_other || i.label}</Text> : null}</View>)}
      </View>) },
    { label: 'Construction:', minH: 50, render: i => (<View><Box on={i.construction === 'sw'} label="Single-walled" /><Box on={i.construction === 'dw'} label="Double-walled (vacuum test method must be performed in accordance with manufacturer or PEI/RP1200)" /></View>) },
    { label: 'Start Level:', render: i => Txt(withUnit(i.start_reading)) },
    { label: 'Start Time:', render: i => Txt(i.start_time) },
    { label: 'End Level:', render: i => Txt(withUnit(i.end_reading)) },
    { label: 'End Time:', render: i => Txt(i.end_time) },
    { label: 'Level Change:', render: i => Txt(i.level_change) },
    { label: 'Test Results:', render: i => PF(i) },
    { label: 'Test Failure:', render: i => <View style={s.row}><Box on={!!i.failure_reported_at} label="Reported to MDE" /><Text style={s.val}>{i.failure_reported_at ?? ''}</Text></View> },
  ]
  return (
    <Page size="LETTER" style={s.page}>
      <Text style={[s.title, { marginBottom: 6 }]}>Maryland Catchment Basin and Containment Sump Test Report</Text>
      {page === 1 && (<>
        <FieldRow><Field label="MDE Facility I.D. #:" value={t.facility_id} flex={1} /><Field label="UST Owner:" value={t.owner_name} flex={1} /></FieldRow>
        <FieldRow><Field label="Facility Name:" value={t.facility_name || t.site_number} /><Field label="Owner Address:" value={t.owner_address} /></FieldRow>
        <FieldRow><Field label="Facility Address:" value={t.address} /><Field label="City / State / Zip:" value={[t.owner_city, t.owner_state, t.owner_zip].filter(Boolean).join(', ')} /></FieldRow>
        <FieldRow><Field label="City / State / Zip:" value={cityLine(t)} /><Field label="Owner Telephone Number:" value={t.owner_phone} /></FieldRow>
        <FieldRow><Field label="Testing Company:" value={RPS_COMPANY.name} /><Field label="Company Telephone Number:" value={RPS_COMPANY.phone} /></FieldRow>
        <View style={{ height: 6 }} />
        <FieldRow><Field label="Test Date:" value={fmtDate(t.test_date)} /><Field label="Weather Condition:" value={t.weather} /><Field label="Temperature:" value={t.temperature} /></FieldRow>
        <View style={{ height: 6 }} />
      </>)}
      {page > 1 && <FieldRow><Field label="MDE Facility I.D. #:" value={t.facility_id} /><Field label="Facility Name:" value={t.facility_name || t.site_number} /><Field label="Test Date:" value={fmtDate(t.test_date)} /></FieldRow>}
      <Grid rows={rows} items={items} cols={3} labelW={80} />
      <Text style={[s.note, { fontFamily: 'Helvetica-Bold', marginTop: 4 }]}>- Hydrostatic and vacuum test failures must be reported to MDE immediately and within 2 hours of the test.</Text>
      <Text style={[s.note, { fontFamily: 'Helvetica-Bold' }]}>- A liquid level drop of 1/8 inch or greater in 1 hour is considered a test failure.</Text>
      {last && (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8, marginBottom: 2 }}>Tester Certification (check one):</Text>
          {CERT_TYPES.MD.map(c => <View key={c.value} style={[s.row, { alignItems: 'center' }]}><Box on={(t.tester_cert_type ?? 'mde_tech') === c.value} label={c.label} />{(t.tester_cert_type ?? 'mde_tech') === c.value ? <Text style={s.val}>{t.tester_cert ?? ''}</Text> : <Text style={{ color: '#666' }}>{c.value === 'precision' ? 'Test Method ______  Certification Expiration Date: ______' : 'MDIC-____-____-__'}</Text>}</View>)}
          <View style={[s.row, { marginTop: 6, alignItems: 'flex-end' }]}>
            <Text>Tester&apos;s Name (print): </Text><Text style={[s.val, { width: 170, borderBottomWidth: 0.6 }]}>{t.tester_name ?? ''}</Text>
            <Text style={{ marginLeft: 12 }}>Tester&apos;s Signature: </Text><View style={{ width: 170, borderBottomWidth: 0.6 }}><SigBlock t={t} w={160} /></View>
          </View>
          <Text style={{ marginTop: 6, fontFamily: 'Helvetica-Bold' }}>Comments:</Text>
          <View style={[s.cell, { marginLeft: 0, marginTop: 1, minHeight: 60 }]}><Text style={s.val}>{commentText(t, items)}</Text></View>
          <Text style={[s.note, { fontFamily: 'Helvetica-Bold', marginTop: 6 }]}>Copy of the test report must be maintained by the owner/operator for a period of 5 years and made available to the Department upon request and during UST inspections.</Text>
        </View>
      )}
      <View style={s.foot} fixed><Text>March 2017</Text><Text>Page {page} of {pages}</Text></View>
    </Page>
  )
}

/* ---------- VIRGINIA (DEQ) ---------- */
function VaHeader({ t, title, sub, bullets }: { t: TestRow; title: string; sub: string; bullets: string[] }) {
  return (
    <View>
      <View style={[s.cell, { marginLeft: 0, backgroundColor: SHADE, paddingVertical: 6 }]}>
        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1a5c8a', position: 'absolute', left: 6, top: 8 }}>DEQ</Text>
        <Text style={s.title}>{title}</Text><Text style={s.sub}>{sub}</Text>
      </View>
      <View style={[s.cell, { marginLeft: 0 }]}>{bullets.map((b, k) => <Text key={k} style={s.note}>{'➢'}  {b}</Text>)}</View>
      <Text style={[s.sec, { marginTop: 0 }]}>UST FACILITY</Text>
      <FieldRow><Field label="Owner / Operator Name" value={t.owner_name} flex={1.3} /><Field label="Facility Name" value={t.facility_name || t.site_number} flex={1.3} /><Field label="Facility ID#:" value={t.facility_id} flex={0.9} /></FieldRow>
      <FieldRow><Field label="Facility Street Address" value={t.address} flex={1.3} /><Field label="Facility City" value={t.city} flex={1.3} /><Field label="County" value={t.county} flex={0.9} /></FieldRow>
      <Text style={[s.sec, { marginTop: 0 }]}>TESTING CONTRACTOR INFORMATION</Text>
      <FieldRow><Field label="Company Name" value={RPS_COMPANY.name} flex={1.3} /><Field label="Phone" value={t.tester_phone || RPS_COMPANY.phone} flex={1} /><Field label="E-mail Address" value={t.tester_email || RPS_COMPANY.email} flex={1.2} /></FieldRow>
      <View style={[s.cell, { marginLeft: 0 }]}><Text style={s.note}>I certify, under penalty of law, that the testing data provided on this form documents the UST system equipment was tested in accordance with the manufacturer&apos;s guidelines and the applicable national industry standards listed in 9VAC25-580-82.</Text></View>
      <View style={[s.row, { marginLeft: 0.6 }]}>
        <View style={[s.cell, { flex: 1.3, alignItems: 'center' }]}><V>{t.tester_name}</V><Text style={s.lbl}>Print Name of person conducting test</Text></View>
        <View style={[s.cell, { flex: 1.3, alignItems: 'center' }]}><SigBlock t={t} w={140} /><Text style={s.lbl}>Signature of person conducting test</Text></View>
        <View style={[s.cell, { flex: 0.9, alignItems: 'center' }]}><V>{fmtDate(t.test_date)}</V><Text style={s.lbl}>Test Date</Text></View>
      </View>
    </View>
  )
}
const VA_FOOT = 'VIRGINIA DEPARTMENT OF ENVIRONMENTAL QUALITY, 1111 E. MAIN ST., SUITE 1400, RICHMOND, VA 23219 · PHONE: (804) 698-4010'
function VaSpillPage({ t, items }: { t: TestRow; items: ItemRow[] }) {
  const rows: GridRow[] = [
    { label: 'Identify Spill Bucket (By Tank Number, Stored Product, etc.)', shade: true, render: i => <Text style={{ fontFamily: 'Helvetica-Bold' }}>Tank # <Text style={s.val}>{i.label ?? ''}</Text></Text> },
    { label: 'Tank Size', render: i => Txt(i.tank_size) },
    { label: 'Product', render: i => Txt(i.product) },
    { label: 'Indicate units for all measurements', shade: true, span: <Text> </Text> },
    { label: 'Bucket Manufacturer/Model', render: i => Txt(i.manufacturer) },
    { label: 'Bucket Depth', render: i => Txt(i.depth) },
    { label: 'Construction', render: i => <View style={s.row}><Box on={i.construction === 'sw'} label="SW" /><Box on={i.construction === 'dw'} label="DW" /></View> },
    { label: 'Bucket Installation Type', minH: 30, render: i => <View><Box on={i.install_type === 'direct'} label="Direct Bury" /><Box on={i.install_type === 'direct_liner'} label="Direct Bury w/Liner" /><Box on={i.install_type === 'sump'} label="Containment sump" /></View> },
    { label: 'Test Type', render: i => <View><Box on={i.method === 'hydrostatic'} label="Hydrostatic" /><Box on={i.method === 'vacuum'} label="Vacuum" /></View> },
    { label: 'Liquid and debris removed from spill bucket?', render: i => YN(yn(i.debris_removed)) },
    { label: 'Visual inspection (No cracks, loose parts or separation of the bucket from fill pipe.)', minH: 20, render: i => <View style={s.row}><Box on={i.visual === 'pass'} label="Pass" /><Box on={i.visual === 'fail'} label="Fail" /></View> },
    { label: 'Tank riser cap included in test?', render: i => YN(i.riser_cap, true) },
    { label: 'Drain valve included in test?', render: i => YN(i.drain_valve, true) },
    { label: 'Wait time between applying water and start of test (if applicable)', render: i => Txt(i.wait_minutes ? `${i.wait_minutes} min` : '') },
    { label: 'Primary Section Test', shade: true, span: <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 6.8 }}>Hydrostatic: Water level must be within 1.5 inches of top of bucket          Vacuum: Apply vacuum of 30 inches WC</Text> },
    { label: 'Begin | End Test Time', render: i => Pair(i.start_time, i.end_time) },
    { label: 'Begin | End Reading', render: i => Pair(i.start_reading, i.end_reading) },
    { label: 'Secondary Interstice Test', shade: true, span: <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 6.8 }}>Vacuum: Apply vacuum of 15 inches WC          Gauge range (with units): <Text style={s.val}>{t.gauge_range ?? ''}</Text></Text> },
    { label: 'Begin | End Test Time', render: i => (i.construction === 'dw' ? Pair(i.ist_start_time, i.ist_end_time) : <Text> </Text>) },
    { label: 'Begin | End Reading', render: i => (i.construction === 'dw' ? Pair(i.ist_start_reading, i.ist_end_reading) : <Text> </Text>) },
    { label: 'Pass/fail criteria:', shade: true, minH: 26, span: <Text style={{ fontSize: 6.8 }}>Must pass visual inspection. Pass if: Hydrostatic: Water level drop of less than 1/8 inch in 1 hour; Vacuum single-walled only: Maintain at least 26 inches water column for 1 minute; Vacuum double-walled: Maintain at least 12 inches water column for 1 minute</Text> },
    { label: 'Test Results', shade: true, render: i => PF(i) },
  ]
  return (
    <Page size="LETTER" style={s.page}>
      <VaHeader t={t} title="Triennial UST Spill Bucket Integrity Testing" sub="(Hydrostatic/Vacuum Test)" bullets={[
        'The primary containment and interstitial space of the spill bucket shall be tested in accordance with the manufacturer\'s written guidelines or PEI/RP1200 "Recommended Practices for the Testing and Verification of Spill, Overfill, Leak Detection and Secondary Containment Equipment at UST Facilities."',
        'The primary and secondary walls are both considered to be tested at the same time if vacuum is used to test the interstice.',
      ]} />
      <Grid rows={rows} items={items} cols={5} labelW={140} />
      <View style={[s.cell, { marginLeft: 0, minHeight: 46 }]}><Text><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>Comments – </Text><Text style={{ fontSize: 6.5 }}>(include information on repairs made prior to testing, and recommended follow-up for failed tests)</Text></Text><Text style={s.val}>{commentText(t, items)}</Text></View>
      <FieldRow><View style={[s.cell, { flex: 3 }]}><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5 }}>Date next Spill Bucket integrity test due <Text style={{ fontFamily: 'Helvetica' }}>(required every 3 years)</Text></Text></View><View style={[s.cell, { flex: 1 }]}><V>{fmtDate(t.next_due)}</V></View></FieldRow>
      <View style={s.foot} fixed><Text>{VA_FOOT}</Text><Text>3/2023</Text></View>
    </Page>
  )
}
function vaSumpId(i: ItemRow) {
  return <View><Box on={i.kind === 'udc'} label="Dispenser" /><Box on={i.kind !== 'udc'} label="Tank" /><Text>#: <Text style={s.val}>{i.kind === 'transition' ? `TS-${(i.label ?? '').replace(/^TS-?/i, '')}` : [i.label, i.product, i.tank_size, i.kind === 'stp' ? 'STP' : i.kind === 'other' ? i.kind_other : ''].filter(Boolean).join(' ')}</Text></Text></View>
}
function VaSumpPage({ t, items }: { t: TestRow; items: ItemRow[] }) {
  const low = t.sump_test_kind === 'low_level'
  const common: GridRow[] = [
    { label: 'Identify UDC/sump (By Dispenser No. or Tank Number, Tank Size, Stored Product; e.g. #1 10k Regular STP, Disp 1/2, etc.)', minH: 34, render: vaSumpId },
    { label: 'Transition sumps should be listed above as "TS-XX" (with XX= sump ID#)', shade: true, span: <Text> </Text> },
    { label: 'Sump Material', render: i => <View><Box on={i.material === 'frp'} label="FRP" /><Box on={i.material === 'plastic'} label="Plastic" /></View> },
  ]
  const full: GridRow[] = [
    ...common,
    { label: 'Test Type', render: i => <View><Box on={i.method === 'hydrostatic'} label="Hydrostatic" /><Box on={i.method === 'vacuum'} label="Vacuum" /></View> },
    { label: 'Indicate units for all measurements', shade: true, span: <Text> </Text> },
    { label: 'Liquid and debris removed from sump?', render: i => YN(yn(i.debris_removed)) },
    { label: 'Visual inspection (No cracks, loose parts or separation of the containment sump)', minH: 20, render: i => <View style={s.row}><Box on={i.visual === 'pass'} label="Pass" /><Box on={i.visual === 'fail'} label="Fail" /></View> },
    { label: 'Sump Depth in inches', render: i => Txt(i.depth) },
    { label: 'Height from sump bottom to top of highest penetration or sump sidewall seam in inches', minH: 20, render: i => Txt(i.penetration_height) },
    { label: 'Wait time between applying vacuum/water and start of test', render: i => Txt(i.wait_minutes ? `${i.wait_minutes} min` : '') },
    { label: 'Begin / End Test Time (minimum test time: 1 hour)', render: i => Pair(i.start_time, i.end_time) },
    { label: 'Begin / End values (inches)', render: i => Pair(i.start_reading, i.end_reading) },
    { label: 'Pass/fail criteria:', shade: true, minH: 22, span: <Text style={{ fontSize: 6.8 }}>Must pass visual inspection. Hydrostatic: Water level drop of 1/8 inch or more fails the test, Water level must be 4 or more inches above highest penetration or side wall seam or test is invalid; Vacuum: No change in vacuum</Text> },
    { label: 'Test Result', shade: true, render: i => PF(i) },
  ]
  const lowRows: GridRow[] = [
    ...common,
    { label: 'Indicate units for all measurements', shade: true, span: <Text> </Text> },
    { label: 'Liquid and debris removed from sump?', render: i => YN(yn(i.debris_removed)) },
    { label: 'Is sensor placed at the lowest portion of sump bottom?', render: i => YN(yn(i.sensor_low)) },
    { label: 'Visual inspection (No cracks, loose parts or separation of the containment sump)', minH: 20, render: i => <View style={s.row}><Box on={i.visual === 'pass'} label="Pass" /><Box on={i.visual === 'fail'} label="Fail" /></View> },
    { label: 'Did sensor alarm when tested?', render: i => YN(yn(i.sensor_alarmed)) },
    { label: 'If sensor alarms, did the STP and/or dispenser shut-off (if applicable)', minH: 20, render: i => YN(i.sensor_shutoff, true) },
    { label: 'Level above bottom of sump where sensor alarms. (inches)', render: i => Txt(i.alarm_level) },
    { label: 'Wait time between applying water and start of test', render: i => Txt(i.wait_minutes ? `${i.wait_minutes} min` : '') },
    { label: 'Begin / End Test Time (minimum test time: 1 hour)', render: i => Pair(i.start_time, i.end_time) },
    { label: 'Begin / End values (inches)', render: i => Pair(i.start_reading, i.end_reading) },
    { label: 'Pass/fail criteria:', shade: true, minH: 18, span: <Text style={{ fontSize: 6.8 }}>Must pass visual inspection. Water level must be above the sensor alarm level; a drop of 1/8 inch or more fails the test</Text> },
    { label: 'Test Result', shade: true, render: i => PF(i) },
  ]
  return (
    <Page size="LETTER" style={s.page}>
      <VaHeader t={t} title="Triennial UST Containment Sump / UDC Integrity Testing" sub={low ? '(Low Liquid Level Test)' : '(Full height hydrostatic or vacuum test)'} bullets={low ? [
        'Containment sumps installed on or after 9/15/2010 that are not monitored continuously for releases using vacuum, pressure, or hydrostatic interstitial monitoring methods and all other containment sumps installed prior to 9/15/2010 that are used for interstitial monitoring can be tightness tested every three (3) years in accordance with the VA DEQ Low Level Hydrostatic Integrity Test Procedures (Appendix A of the 2021 UST Requirements guidance).',
        'This method cannot be used for the installation testing of containment sumps.', 'If a UDC / containment sump fails a periodic tightness test, the sump must be replaced or repaired by the manufacturer.',
        'Attach all setup reports (e.g. Veeder-Root: Output Relay Setup, Incon: Main console setup) for the sensor alarms positive shut-down to this form.',
      ] : [
        'Containment sumps installed on or after 9/15/2010 that are not monitored continuously for releases using vacuum, pressure, or hydrostatic interstitial monitoring methods and all other containment sumps installed prior to 9/15/2010 that are used for interstitial monitoring shall be tightness tested at installation and every three (3) years thereafter in accordance with the manufacturer\'s written guidelines, and/or PEI/RP1200.',
        'If a UDC / containment sump fails a periodic tightness test, the sump must be replaced or repaired.',
      ]} />
      <Grid rows={low ? lowRows : full} items={items} cols={6} labelW={130} />
      <View style={[s.cell, { marginLeft: 0, minHeight: 46 }]}><Text><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 9 }}>Comments – </Text><Text style={{ fontSize: 6.5 }}>(include information on repairs made prior to testing, and recommended follow-up for failed tests)</Text></Text><Text style={s.val}>{commentText(t, items)}</Text></View>
      <FieldRow><View style={[s.cell, { flex: 3 }]}><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5 }}>Date next UDC / Containment Sump integrity test due <Text style={{ fontFamily: 'Helvetica' }}>(required every 3 years)</Text></Text></View><View style={[s.cell, { flex: 1 }]}><V>{fmtDate(t.next_due)}</V></View></FieldRow>
      <View style={s.foot} fixed><Text>{VA_FOOT}</Text><Text>3/2023</Text></View>
    </Page>
  )
}

/* ---------- WEST VIRGINIA (WVDEP) ---------- */
const methodBy = (t: TestRow, mfr: string) => <View style={[s.row, { flexWrap: 'wrap' }]}><Box on={t.method_by === 'manufacturer'} label={mfr} /><Box on={t.method_by === 'industry'} label="Industry Standard" /><Box on={t.method_by === 'other'} label="Other (Specify):" /><Text style={s.val}>{t.method_by === 'other' ? t.method_other ?? '' : ''}</Text></View>
const methodUsed = (items: ItemRow[]) => { const m = new Set(items.map(i => i.method)); return <View style={s.row}><Box on={m.has('pressure')} label="Pressure" /><Box on={m.has('vacuum')} label="Vacuum" /><Box on={m.has('hydrostatic')} label="Hydrostatic" /><Box on={m.has('other')} label="Other (Specify):" /></View> }
function WvHeader({ t, title, preface }: { t: TestRow; title: string; preface?: string }) {
  return (
    <View>
      <Text style={[s.title, { marginBottom: 3 }]}>{title}</Text>
      {preface ? <Text style={[s.note, { marginBottom: 3 }]}>{preface}</Text> : null}
      <FieldRow><View style={[s.cell, { flex: 1, backgroundColor: LIGHT }]}><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5 }}>A.   Facility Information</Text></View><Field label="WVDEP FACILITY ID#:" value={t.facility_id} flex={1} /></FieldRow>
      <FieldRow><Field label="Facility Name / Customer Site ID#:" value={[t.site_number, t.facility_name].filter(Boolean).join(' · ')} /><Field label="Site Address:" value={[t.address, cityLine(t)].filter(Boolean).join(', ')} flex={1.4} /></FieldRow>
      <FieldRow><Field label="Facility Contact:" value={t.facility_contact} /><Field label="Phone:" value={t.contact_phone} /><Field label="Date of Testing:" value={fmtDate(t.test_date)} /></FieldRow>
      <View style={[s.cell, { marginLeft: 0, marginTop: 3, backgroundColor: LIGHT }]}><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5 }}>B. Testing Contractor Information</Text><Text style={s.note}>To the best of my knowledge, the facts stated in this document are accurate and in full compliance with legal requirements.</Text></View>
      <FieldRow><Field label="Company:" value={RPS_COMPANY.name} flex={1.3} /><Field label="Print Name of Tester:" value={t.tester_name} /><Field label="WVDEP Certification #:" value={t.tester_cert} /><View style={[s.cell, { flex: 1.2 }]}><Text style={s.lbl}>Tester&apos;s Signature:</Text><SigBlock t={t} w={110} /></View><Field label="Date:" value={fmtDate(t.test_date)} w={60} /></FieldRow>
      <FieldRow><Field label="Address:" value={RPS_COMPANY.address} /><Field label="City:" value={`${RPS_COMPANY.city}, ${RPS_COMPANY.state} ${RPS_COMPANY.zip}`} /><Field label="Phone number:" value={t.tester_phone || RPS_COMPANY.phone} /><Field label="Email address:" value={t.tester_email || RPS_COMPANY.email} flex={1.3} /></FieldRow>
    </View>
  )
}
function WvSpillPage({ t, items }: { t: TestRow; items: ItemRow[] }) {
  const rows: GridRow[] = [
    { label: '', shade: true, render: i => <Text style={{ fontFamily: 'Helvetica-Bold' }}>Bucket # <Text style={s.val}>{i.label ?? ''}</Text></Text> },
    { label: 'Bucket depth:', render: i => Txt(i.depth) },
    { label: 'Wait time between applying pressure/vacuum/water & starting test:', minH: 18, render: i => Txt(i.wait_minutes ? `${i.wait_minutes} min` : '') },
    { label: 'Test start time:', render: i => Txt(i.start_time) },
    { label: 'Initial reading:', render: i => Txt(i.start_reading) },
    { label: 'Test end time:', render: i => Txt(i.end_time) },
    { label: 'Final reading:', render: i => Txt(i.end_reading) },
    { label: 'Change in reading:', render: i => Txt(i.level_change) },
    { label: 'Pass/Fail threshold/criteria:', render: i => Txt(i.threshold) },
    { label: 'Test Result:', render: i => PF(i) },
  ]
  return (
    <Page size="LETTER" orientation="landscape" style={s.page}>
      <Text style={{ fontSize: 6.5 }}>REV. 8/5/2019</Text>
      <WvHeader t={t} title="Spill and Overfill Testing Report Form" preface={'The applicable portions of this form must be completed and provided to the facility owner/operator within 30 days of the test date, along with written test procedures, data collection logs, and printouts from test equipment (if applicable). Facility must keep this page along with pages 2-3 as applicable on record for submittal to the WVDEP upon request. Each page must identify the facility and contain the WVDEP certified worker\'s signature and WVDEP certified worker must be onsite during testing. When pressure/vacuum testing, any loss in pressure/vacuum during the test shall be considered a failed test, regardless of the manufacturer\'s criteria for declaring a passed test.'} />
      <View style={[s.row, { marginTop: 4, alignItems: 'center' }]}><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5, flex: 1 }}>C. Testing of Spill Buckets (Required every three years)</Text><Box on={false} label="Spill bucket(s) not tested" /></View>
      <FieldRow><View style={[s.cell, { flex: 2 }]}><Text style={s.lbl}>Test Method Developed By:</Text>{methodBy(t, 'Bucket Manufacturer')}</View><Field label="Test Equipment Used:" value={t.test_equipment} /></FieldRow>
      <FieldRow><View style={[s.cell, { flex: 2 }]}><Text style={s.lbl}>Test Method Used:</Text>{methodUsed(items)}</View><Field label="Equipment Precision:" value={t.equipment_precision} /></FieldRow>
      <Grid rows={rows} items={items} cols={7} labelW={130} />
      <View style={[s.cell, { marginLeft: 0, marginTop: 4, minHeight: 34 }]}><Text style={{ fontFamily: 'Helvetica-Bold' }}>TESTER COMMENTS:</Text><Text style={s.val}>{commentText(t, items)}</Text></View>
      <View style={s.foot} fixed><Text>Spill and Overfill Testing Report Form — Section C (Spill Buckets)</Text><Text>WVDEP</Text></View>
    </Page>
  )
}
function WvSumpPage({ t, items }: { t: TestRow; items: ItemRow[] }) {
  const sumpKind = (i: ItemRow) => <View style={[s.row, { flexWrap: 'wrap' }]}><Box on={i.kind === 'stp' || i.kind === 'tank_top'} label="STP" /><Box on={i.kind === 'udc'} label="UDC" /><Box on={!['stp', 'tank_top', 'udc'].includes(i.kind)} label="OTHER" /></View>
  const rows: GridRow[] = [
    { label: 'Dispenser #s, product, Tank #', shade: true, render: i => <Text>ID: <Text style={s.val}>{[i.label, i.product].filter(Boolean).join(' ')}</Text></Text> },
    { label: 'STP/UDC/Other sump', render: sumpKind },
    { label: 'Sump depth (inches):', render: i => Txt(i.depth) },
    { label: 'Height from sump bottom to top of highest sump penetration:', minH: 18, render: i => Txt(i.penetration_height) },
    { label: 'Wait time between applying pressure/vacuum/water and starting test', minH: 18, render: i => Txt(`${i.wait_minutes ?? '   '} minutes`) },
    { label: 'Test start date/time:', render: i => Txt(i.start_time) },
    { label: 'Initial reading:', render: i => Txt(i.start_reading) },
    { label: 'Test end date/time:', render: i => Txt(i.end_time) },
    { label: 'Final reading:', render: i => Txt(i.end_reading) },
    { label: 'Change in reading:', render: i => Txt(i.level_change) },
    { label: 'Pass/Fail threshold or criteria:', render: i => Txt(i.threshold || '1/8"') },
    { label: 'Test Result:', render: i => PF(i) },
    { label: 'Was sump emptied of all test water and its sensor returned to proper position, making contact with sump floor after the test?', minH: 26, render: i => YN(i.sensor_restored, true) },
  ]
  const reason = t.reason ?? 'routine'
  return (
    <Page size="LETTER" orientation="landscape" style={s.page}>
      <WvHeader t={t} title="Miscellaneous Testing Report Form" />
      <View style={[s.row, { marginTop: 4, alignItems: 'center' }]}><Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 8.5, flex: 1 }}>C. Testing of Sumps and/or Under-Dispenser Containment (UDC)</Text><Box on={false} label="N/A (No sumps/UDC)" /></View>
      <Text style={s.note}>If not using a manufacturer specific test method, containment sumps being hydrostatically tested must be filled to at least 4 inches above the highest penetration or sump seam/fitting or joint and allowed to stand at least 15 minutes before beginning the official test period. The test duration must be at least 60 minutes with a liquid level change (loss) of 1/8&quot; or more indicating a failure.</Text>
      <FieldRow><View style={[s.cell, { flex: 2 }]}><Text style={s.lbl}>Test Method Developed By:</Text>{methodBy(t, 'UDC Manufacturer')}</View><Field label="Test Equipment Used:" value={t.test_equipment} /></FieldRow>
      <FieldRow><View style={[s.cell, { flex: 2 }]}><Text style={s.lbl}>Test Method Used:</Text>{methodUsed(items)}</View><Field label="Equipment Precision:" value={t.equipment_precision} /></FieldRow>
      <FieldRow><View style={[s.cell, { flex: 3 }]}><View style={[s.row, { alignItems: 'center' }]}><Text style={[s.lbl, { marginRight: 6 }]}>Reason for Test:</Text><Box on={reason === 'routine'} label="Required Routine 3-year Test" /><Box on={reason === 'suspected'} label="Suspected Release" /><Box on={reason === 'other' || reason === 'install'} label="Other (Specify):" /><Text style={s.val}>{reason === 'install' ? 'Installation / repair' : reason === 'other' ? t.reason_other ?? '' : ''}</Text></View></View></FieldRow>
      <Grid rows={rows} items={items} cols={7} labelW={130} />
      <View style={[s.cell, { marginLeft: 0, marginTop: 4, minHeight: 34 }]}><Text style={{ fontFamily: 'Helvetica-Bold' }}>TESTER COMMENTS:</Text><Text style={s.val}>{commentText(t, items)}</Text></View>
      <View style={s.foot} fixed><Text>Miscellaneous Testing Report Form — Section C (Sumps / UDC)</Text><Text>WVDEP</Text></View>
    </Page>
  )
}

/** Comments box text: the overall comments plus any per-item notes ("UDC 3/4: replaced entry boot"). */
function commentText(t: TestRow, items: ItemRow[]): string {
  const lines = [t.comments?.trim(), ...items.filter(i => i.notes?.trim()).map(i => `${itemTitle(i)}: ${i.notes!.trim()}`)].filter(Boolean)
  return lines.join('\n') || ' '
}

export function TestPdfDoc({ test, items }: TestBundle) {
  const buckets = items.filter(i => isBucket(i.kind)), sumps = items.filter(i => !isBucket(i.kind))
  const title = `${test.site_number ?? ''} containment test ${test.test_date}`
  if (test.state === 'MD') {
    const groups = chunk(items, 3)
    return <Document title={title} author={RPS_COMPANY.name}>{groups.map((g, k) => <MdPage key={k} t={test} items={g} page={k + 1} pages={groups.length} last={k === groups.length - 1} />)}</Document>
  }
  if (test.state === 'WV') {
    return (
      <Document title={title} author={RPS_COMPANY.name}>
        {buckets.length ? chunk(buckets, 7).map((g, k) => <WvSpillPage key={`b${k}`} t={test} items={g} />) : null}
        {sumps.length ? chunk(sumps, 7).map((g, k) => <WvSumpPage key={`s${k}`} t={test} items={g} />) : null}
        {!items.length ? <WvSumpPage t={test} items={[]} /> : null}
      </Document>
    )
  }
  return (
    <Document title={title} author={RPS_COMPANY.name}>
      {buckets.length ? chunk(buckets, 5).map((g, k) => <VaSpillPage key={`b${k}`} t={test} items={g} />) : null}
      {sumps.length ? chunk(sumps, 6).map((g, k) => <VaSumpPage key={`s${k}`} t={test} items={g} />) : null}
      {!items.length ? <VaSumpPage t={test} items={[]} /> : null}
    </Document>
  )
}

export async function renderTestPdf(bundle: TestBundle): Promise<Buffer> {
  return renderToBuffer(<TestPdfDoc {...bundle} />)
}
export function testPdfFileName(t: TestRow): string {
  const kind = 'Containment Test'
  return `${(t.site_number ?? 'site').replace(/[^A-Za-z0-9-]+/g, '')} ${t.state} ${kind} ${t.test_date}.pdf`
}
