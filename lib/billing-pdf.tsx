import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { money, fmtDate } from '@/lib/billing'
import { REV19_CATEGORIES, categoryMeta, computeRev19, faceLineRows, type Rev19Inputs, type Rev19LineInput, type Rev19Totals, type Rev19Line } from '@/lib/rev19'

// ============================================================
// RPS quote / invoice PDF — mirrors the RP QUOTE TEMPLATE sheet that every
// RPS proposal and service invoice is printed from: letterhead logo + address
// box top-left, boxed title + date/CSR top-right, CUSTOMER / LOCATION boxes,
// PROJECT DESCRIPTION band, peach section headers, gray subtotal bands, black
// grid, GRAND TOTAL → P&O → sales tax → PROPOSAL/INVOICE GRAND TOTAL, and the
// Construction Manager signature line. Page 2+ is the MATERIAL AND LABOR
// BREAKDOWN by REV19 category.
// ============================================================

export type BillingDoc = {
  kind: 'Proposal' | 'Invoice'
  starting: boolean
  number: string
  date: string | null
  bidDue?: string | null
  customerName: string | null
  attn: string | null
  customerAddress: string | null
  siteNumber: string | null
  storeLabel: string | null
  facilityAddress: string | null
  cityStateZip: string | null
  csrNumber?: string | null
  poNumber?: string | null
  workOrder?: string | null
  dueDate?: string | null
  projectDescription: string | null
  scopeRows: { scope: string; description: string }[]
  exclusions?: string | null
  warranty?: string | null
  projectManager?: string | null
  constructionManager?: string | null
  foreman?: string | null
  compiledBy?: string | null
  preparedBy: string | null
  inputs: Rev19Inputs
  laborRateLabel?: string | null
  department?: string | null
}

// Template colors (resolved from the workbook theme): accent2 ED7D31 @ 80% tint, E7E6E6 @ 80% tint.
const PEACH = '#FBE5D6', GRAY = '#F2F2F2', BLACK = '#000000', INK = '#111111', MUTED = '#555555'
const PINK = '#FCE4EC', GREEN = '#E6F4EA', ORANGE = '#FFF1E0'

let LOGO: Buffer | null = null
function logo(): Buffer | null {
  if (LOGO) return LOGO
  for (const p of [join(process.cwd(), 'public', 'rps-letterhead-logo.png'), join(process.cwd(), '..', 'public', 'rps-letterhead-logo.png')]) {
    try { LOGO = readFileSync(p); return LOGO } catch { /* try next */ }
  }
  return null
}

const s = StyleSheet.create({
  page: { paddingTop: 26, paddingBottom: 30, paddingHorizontal: 30, fontSize: 8.5, fontFamily: 'Helvetica', color: INK },
  frame: { borderWidth: 1.5, borderColor: BLACK, padding: 10, flexGrow: 1 },
  footer: { position: 'absolute', bottom: 14, left: 30, right: 30, fontSize: 7, color: MUTED, textAlign: 'right' },
  row: { flexDirection: 'row' },
  cell: { borderWidth: 0.6, borderColor: BLACK, paddingVertical: 2, paddingHorizontal: 3 },
  bold: { fontFamily: 'Helvetica-Bold' },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },
  tiny: { fontSize: 7 },
  addrBox: { borderWidth: 0.6, borderColor: BLACK, paddingVertical: 3, paddingHorizontal: 5, marginTop: 2 },
  titleBox: { borderWidth: 0.8, borderColor: BLACK, backgroundColor: GRAY, paddingVertical: 4, paddingHorizontal: 18, fontSize: 15, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  band: { backgroundColor: PEACH },
  gray: { backgroundColor: GRAY },
  scopeLabel: { width: 118, borderWidth: 0.6, borderColor: BLACK, backgroundColor: GRAY, padding: 4, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  scopeBody: { flex: 1, borderWidth: 0.6, borderColor: BLACK, backgroundColor: GRAY, padding: 4, fontSize: 8.5, lineHeight: 1.3 },
  sigName: { fontFamily: 'Times-BoldItalic', fontSize: 15 },
  bdSection: { backgroundColor: '#16243d', color: '#fff', padding: 4, fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 12 },
  bdTh: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: MUTED, paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 1, borderColor: '#d1d5db' },
  bdTd: { fontSize: 8.5, paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 0.5, borderColor: '#eee' },
  total: { flexDirection: 'row', justifyContent: 'flex-end', paddingVertical: 2 },
  totalLabel: { width: 260, textAlign: 'right', paddingRight: 8, color: MUTED },
  totalValue: { width: 90, textAlign: 'right' },
})

// Face column widths (points). Total = 552 (letter width 612 − 30×2 padding).
const C = { no: 16, desc: 178, qty: 40, unit: 54, mat: 60, hrs: 42, rate: 48, lab: 54, tot: 60 }
const FACE_W = Object.values(C).reduce((a, b) => a + b, 0)

const acct = (v: number | null | undefined) => (v == null || v === 0 ? '$ -' : money(v))

/** Letterhead: logo + address box on the left, boxed title + date/CSR on the right. */
function Letterhead({ doc, title }: { doc: BillingDoc; title: string }) {
  const img = logo()
  return (
    <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
      <View style={{ width: 300 }}>
        {img ? <Image src={{ data: img, format: 'png' }} style={{ width: 235, height: 75 }} /> : <Text style={[s.bold, { fontSize: 16 }]}>RAPPAHANNOCK PETROLEUM SERVICES</Text>}
        <View style={[s.addrBox, { width: 235 }]}>
          <Text style={[s.bold, { fontSize: 7.5 }]}>225 RITTER RD, WINCHESTER, VA 22602</Text>
          <Text style={[s.bold, { fontSize: 7.5 }]}>(540) 869-5033   FAX (540) 869-5406</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', width: 230 }}>
        <Text style={[s.tiny, { color: MUTED, marginBottom: 2 }]}>{doc.starting ? 'STARTING QUOTE — SUBJECT TO FINAL REVIEW' : ' '}</Text>
        <Text style={s.titleBox}>{title}</Text>
        <View style={{ marginTop: 10 }}>
          <KV k={doc.kind === 'Proposal' ? 'PROPOSAL DATE:' : 'INVOICE DATE:'} v={doc.date ?? ''} />
          <KV k="CSR #" v={doc.csrNumber ?? doc.workOrder ?? ''} />
          {doc.kind === 'Invoice' ? <KV k="INVOICE #" v={doc.number} /> : <KV k="QUOTE #" v={doc.number} />}
          {doc.poNumber ? <KV k="PO #" v={doc.poNumber} /> : null}
          {doc.bidDue ? <KV k="BID DUE" v={doc.bidDue} /> : null}
          {doc.dueDate ? <KV k="DUE" v={doc.dueDate} /> : null}
        </View>
      </View>
    </View>
  )
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={[s.row, { justifyContent: 'flex-end', alignItems: 'flex-end', marginBottom: 2 }]}>
      <Text style={[s.bold, { fontSize: 8, marginRight: 6 }]}>{k}</Text>
      <Text style={[s.bold, s.center, { fontSize: 8, width: 92, borderBottomWidth: 0.8, borderColor: BLACK, paddingBottom: 1 }]}>{v}</Text>
    </View>
  )
}

function Parties({ doc }: { doc: BillingDoc }) {
  const L = ({ k, v, head }: { k: string; v?: string | null; head?: boolean }) => (
    <View style={[s.row, head ? s.gray : {}]}>
      <Text style={[s.cell, s.bold, { width: 62, fontSize: 8 }]}>{k}</Text>
      <Text style={[s.cell, { flex: 1, fontSize: 8, borderLeftWidth: 0 }]}>{v ?? ''}</Text>
    </View>
  )
  const custLines = (doc.customerAddress ?? '').split('\n').filter(Boolean)
  return (
    <View style={[s.row, { marginTop: 14, gap: 40 }]}>
      <View style={{ width: 240 }}>
        <Text style={[s.cell, s.bold, s.gray, { fontSize: 9 }]}>CUSTOMER:</Text>
        <Text style={[s.cell, { fontSize: 9, borderTopWidth: 0 }]}>{doc.customerName ?? ' '}</Text>
        {custLines.slice(0, 2).map((l, i) => <Text key={i} style={[s.cell, { fontSize: 8, borderTopWidth: 0 }]}>{l}</Text>)}
        <View style={[s.row, { borderWidth: 0.6, borderColor: BLACK, borderTopWidth: 0 }]}><Text style={[s.bold, { fontSize: 8, paddingVertical: 2, paddingHorizontal: 3, width: 40 }]}>ATTN:</Text><Text style={{ fontSize: 8, paddingVertical: 2, flex: 1 }}>{doc.attn ?? ' '}</Text></View>
      </View>
      <View style={{ width: 260 }}>
        <Text style={[s.cell, s.bold, s.gray, { fontSize: 9 }]}>LOCATION:</Text>
        <View style={{ borderTopWidth: 0 }}>
          <L k="STORE" v={[doc.storeLabel, doc.siteNumber].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ') || ' '} />
          <L k="ADDRESS" v={doc.facilityAddress} />
          <L k="CITY,ST,ZIP" v={doc.cityStateZip} />
        </View>
      </View>
    </View>
  )
}

function ProjectDescription({ doc }: { doc: BillingDoc }) {
  const body = [doc.projectDescription, ...doc.scopeRows.map(r => (r.scope && r.description ? `${r.scope} — ${r.description}` : r.scope || r.description))].filter(Boolean).join('\n')
  return (
    <View style={[s.row, { marginTop: 12 }]}>
      <Text style={s.scopeLabel}>PROJECT DESCRIPTION:</Text>
      <Text style={s.scopeBody}>{body || ' '}</Text>
    </View>
  )
}

type FaceRow = { no: string; desc: string; header?: boolean; qty: number | null; unit: number | null; material: number; hours: number | null; rate: number | null; labor: number; total: number }

function SectionTable({ title, rows, subtotalMaterial, subtotalLabor, total, totalLabel }: { title: string; rows: FaceRow[]; subtotalMaterial: number; subtotalLabor: number; total: number; totalLabel: string }) {
  const H = ({ t, w, first }: { t: string; w: number; first?: boolean }) => <Text style={[s.cell, s.band, s.bold, s.center, { width: w, fontSize: 6.5, borderLeftWidth: first ? 0.6 : 0 }]}>{t}</Text>
  const D = ({ t, w, b, al }: { t: string; w: number; b?: boolean; al?: 'right' | 'center' | 'left' }) => <Text style={[s.cell, { width: w, fontSize: 7.5, borderLeftWidth: 0, borderTopWidth: 0, textAlign: al ?? 'right' }, b ? s.bold : {}]}>{t}</Text>
  return (
    <View style={{ marginTop: 10 }}>
      <View style={s.row} wrap={false}>
        <Text style={[s.cell, s.band, s.bold, { width: C.no + C.desc, fontSize: 9 }]}>{title}</Text>
        <H t="QUANTITY" w={C.qty} /><H t="UNIT COST" w={C.unit} /><H t="MATERIAL" w={C.mat} /><H t="LABOR HOURS" w={C.hrs} /><H t="LABOR RATE" w={C.rate} /><H t="TOTAL LABOR" w={C.lab} /><H t="TOTAL MATERIAL & LABOR" w={C.tot} />
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.row} wrap={false}>
          <Text style={[s.cell, s.bold, { width: C.no, fontSize: 7.5, borderTopWidth: 0 }]}>{r.no}</Text>
          <Text style={[s.cell, s.bold, { width: C.desc, fontSize: 7.5, borderLeftWidth: 0, borderTopWidth: 0 }]}>{r.desc}</Text>
          <D t={r.qty ? String(r.qty) : ''} w={C.qty} al="center" />
          <D t={r.unit != null ? money(r.unit) : ''} w={C.unit} />
          <D t={r.header ? '' : acct(r.material)} w={C.mat} />
          <D t={r.header ? '' : r.hours ? String(r.hours) : '0'} w={C.hrs} al="center" />
          <D t={r.header ? '' : r.rate != null ? money(r.rate) : '$ -'} w={C.rate} />
          <D t={r.header ? '' : acct(r.labor)} w={C.lab} />
          <D t={r.header ? '' : acct(r.total)} w={C.tot} b />
        </View>
      ))}
      <View style={s.row} wrap={false}>
        <Text style={[s.cell, s.gray, { width: C.no + C.desc - 40, borderTopWidth: 0 }]}> </Text>
        <Text style={[s.cell, s.gray, s.bold, s.right, { width: C.qty + C.unit + C.mat + 40, fontSize: 7.5, borderLeftWidth: 0, borderTopWidth: 0 }]}>Sub Total Material:  {money(subtotalMaterial)}</Text>
        <Text style={[s.cell, s.gray, s.bold, s.right, { width: C.hrs + C.rate + C.lab, fontSize: 7.5, borderLeftWidth: 0, borderTopWidth: 0 }]}>Sub Total Labor:  {money(subtotalLabor)}</Text>
        <Text style={[s.cell, { width: C.tot, backgroundColor: BLACK, borderLeftWidth: 0, borderTopWidth: 0 }]}> </Text>
      </View>
      <View style={s.row}>
        <Text style={[s.cell, s.band, s.bold, s.right, { width: FACE_W - C.tot, fontSize: 9, borderTopWidth: 0 }]}>{totalLabel}</Text>
        <Text style={[s.cell, s.bold, s.right, { width: C.tot, fontSize: 8, borderLeftWidth: 0, borderTopWidth: 0 }]}>{money(total)}</Text>
      </View>
    </View>
  )
}

function FaceTotals({ doc, t }: { doc: BillingDoc; t: Rev19Totals }) {
  const R = ({ label, pct, value, band, big }: { label: string; pct?: number; value: number | string; band?: boolean; big?: boolean }) => (
    <View style={s.row}>
      <Text style={[s.cell, band ? s.band : s.gray, s.bold, s.right, { width: FACE_W - C.tot - C.lab, fontSize: big ? 11 : 8, borderTopWidth: 0 }]}>{label}</Text>
      <Text style={[s.cell, pct != null ? s.band : band ? s.band : s.gray, s.bold, s.center, { width: C.lab, fontSize: 8, borderLeftWidth: 0, borderTopWidth: 0 }]}>{pct != null ? `${(pct * 100).toFixed(2)}%` : ''}</Text>
      <Text style={[s.cell, s.bold, s.right, { width: C.tot, fontSize: big ? 10 : 8, borderLeftWidth: 0, borderTopWidth: 0 }]}>{typeof value === 'string' ? value : money(value)}</Text>
    </View>
  )
  const showCont = t.contingency_amount !== 0
  return (
    <View style={{ marginTop: 10 }} wrap={false}>
      <R label="GRAND TOTAL:" value={t.grand_total} band />
      {showCont ? <R label="CONTINGENCY" pct={doc.inputs.contingency_pct} value={t.contingency_amount} /> : null}
      <R label="PROFIT AND OVERHEAD PERCENT" pct={doc.inputs.profit_overhead_pct} value={t.profit_overhead_amount} />
      <R label="SALES TAX PERCENT (MATERIAL ONLY)" pct={doc.inputs.sales_tax_pct} value={t.tax_amount} />
      <R label={doc.kind === 'Proposal' ? 'PROPOSAL GRAND TOTAL:' : 'INVOICE GRAND TOTAL:'} value={t.final_total} band big />
    </View>
  )
}

function SignatureBlock({ doc }: { doc: BillingDoc }) {
  const name = (doc.preparedBy ?? '').split(',')[0].trim()
  const title = (doc.preparedBy ?? '').split(',').slice(1).join(',').trim()
  return (
    <View style={[s.row, { marginTop: 26, gap: 60 }]} wrap={false}>
      <View style={{ width: 210 }}>
        <Text style={[s.sigName, { borderBottomWidth: 0.8, borderColor: BLACK, paddingBottom: 2, textAlign: 'center' }]}>{name || ' '}</Text>
        <Text style={[s.bold, s.center, { fontSize: 7.5, marginTop: 2 }]}>{title || 'AUTHORIZED SIGNATURE'}</Text>
      </View>
      <View style={{ width: 120 }}>
        <Text style={[{ fontSize: 10, borderBottomWidth: 0.8, borderColor: BLACK, paddingBottom: 2, textAlign: 'center', fontFamily: 'Times-Italic' }]}>{doc.kind === 'Invoice' ? doc.date ?? ' ' : ' '}</Text>
        <Text style={[s.bold, s.center, { fontSize: 7.5, marginTop: 2 }]}>DATE</Text>
      </View>
    </View>
  )
}

/** Face rows. Quotes: one row per REV19 category (the template). Invoices: every line, the way service invoices read. */
function faceRows(section: 'basic' | 'additional', lines: Rev19Line[], face: Rev19Totals['basic'], inp: Rev19Inputs, detail: boolean): FaceRow[] {
  if (!detail) {
    return face.rows.map(r => ({ no: String(r.n), desc: r.name, qty: r.n === 7 ? null : r.quantity || null, unit: r.unit_cost, material: r.material, hours: r.labor_hours, rate: r.n === 7 ? (r.labor_rate ?? inp.labor_rate) : r.labor_rate, labor: r.total_labor, total: r.total }))
  }
  return faceLineRows(lines, section, inp)
}

function Breakdown({ doc, lines, t }: { doc: BillingDoc; lines: Rev19Line[]; t: Rev19Totals }) {
  const fill = (l: Rev19Line) => l.price_flag && l.price_flag !== 'ok' ? PINK : /RECEIPT|QUOTE/i.test(l.source_note ?? '') ? GREEN : l.category === 11 ? ORANGE : undefined
  const Head = ({ cols }: { cols: [string, number, boolean?][] }) => <View style={s.row}>{cols.map(([c, w, r]) => <Text key={c} style={[s.bdTh, r ? s.right : {}, { width: w }]}>{c}</Text>)}</View>
  const Cell = ({ v, w, r, b }: { v: string | number | null | undefined; w: number; r?: boolean; b?: boolean }) => <Text style={[s.bdTd, r ? s.right : {}, b ? s.bold : {}, { width: w }]}>{v == null || v === '' ? '' : String(v)}</Text>
  return (
    <View>
      <View style={[s.row, { gap: 8, marginTop: 10 }]}>
        <View style={{ borderWidth: 0.6, borderColor: BLACK, padding: 5, flex: 1 }}>
          <Text style={[s.tiny, { color: MUTED }]}>INPUTS</Text>
          <Text>Material markup {(doc.inputs.material_markup_pct * 100).toFixed(2)}% · Tax on material {(doc.inputs.material_tax_pct * 100).toFixed(2)}% · Sub markup {(doc.inputs.sub_markup_pct * 100).toFixed(2)}% · Labor {money(doc.inputs.labor_rate)}/hr{doc.laborRateLabel ? ` (${doc.laborRateLabel})` : ''} · Contingency {(doc.inputs.contingency_pct * 100).toFixed(2)}% · P&O {(doc.inputs.profit_overhead_pct * 100).toFixed(2)}%</Text>
          <Text style={[s.tiny, { color: MUTED }]}>Categories 1–4: (Cost + Tax) × (1 + Markup) + Freight, × Qty. Categories 5, 9, 10, 12: cost, markup only where marked. Category 11: cost + {(doc.inputs.sub_markup_pct * 100).toFixed(0)}% on the category. Pink = estimate / PRICE NEEDED / held; green = receipt or vendor quote; orange = subcontractor.</Text>
        </View>
        <View style={{ borderWidth: 0.6, borderColor: BLACK, padding: 5, width: 200 }}>
          <Text style={[s.tiny, { color: MUTED }]}>TEAM</Text>
          <Text>Project manager: {doc.projectManager ?? '—'}</Text>
          <Text>Construction manager: {doc.constructionManager ?? '—'}</Text>
          <Text>Foreman / lead: {doc.foreman ?? '—'}</Text>
          <Text>Work order compiled by: {doc.compiledBy ?? '—'}</Text>
        </View>
      </View>
      {(['basic', 'additional'] as const).map(section => REV19_CATEGORIES.map(c => {
        const ls = lines.filter(l => l.section === section && l.category === c.n)
        if (!ls.length) return null
        const catTotal = t[section].rows.find(r => r.n === c.n)
        const kind = c.kind
        return (
          <View key={`${section}-${c.n}`}>
            {/* Long categories may span pages; keep the title with at least a few rows. */}
            <Text style={s.bdSection} minPresenceAhead={48}>CATEGORY {c.n} — {c.name}{section === 'additional' ? '   (ADDITIONAL SCOPE)' : ''}</Text>
            {kind === 'material' && <Head cols={[['PART #', 96], ['DESCRIPTION', 170], ['UNIT COST', 46, true], ['TAX', 34, true], ['MARKUP', 40, true], ['FREIGHT', 40, true], ['SELL/UNIT', 48, true], ['QTY', 32, true], ['EXTENDED', 58, true], ['SOURCE', 150]]} />}
            {kind === 'labor' && <Head cols={[['DAY', 50], ['SCOPE OF WORK FOR THAT DAY', 300], ['RATE/HR', 46, true], ['MEN', 32, true], ['HRS EACH', 42, true], ['HOURS', 40, true], ['EXTENDED', 60, true], ['NOTE', 140]]} />}
            {kind === 'trip' && <Head cols={[['TRIP', 60], ['DESCRIPTION', 220], ['RATE', 46, true], ['TRAVEL DAYS', 56, true], ['TECHS', 36, true], ['TECH-TRAVEL-DAYS', 74, true], ['EXTENDED', 60, true]]} />}
            {(kind === 'costplus' || kind === 'sub' || kind === 'lodging') && <Head cols={[['ITEM / DESCRIPTION', 290], [kind === 'lodging' ? 'RATE' : 'UNIT COST', 56, true], ['MARKUP?', 40, true], ['SELL/UNIT', 56, true], [kind === 'lodging' ? 'TECH-NIGHTS' : 'QTY', 50, true], ['EXTENDED', 60, true], ['SOURCE', 160]]} />}
            {ls.map((l, i) => (
              <View key={i} style={[s.row, fill(l) ? { backgroundColor: fill(l) } : {}]}>
                {kind === 'material' && <><Cell v={l.part_number} w={96} /><Cell v={l.description} w={170} /><Cell v={money(l.unit_cost)} w={46} r /><Cell v={`${(((l.sales_tax_pct ?? doc.inputs.material_tax_pct)) * 100).toFixed(1)}%`} w={34} r /><Cell v={`${(((l.markup_pct ?? doc.inputs.material_markup_pct)) * 100).toFixed(0)}%`} w={40} r /><Cell v={l.freight_per_unit ? money(l.freight_per_unit) : ''} w={40} r /><Cell v={money(l.sell_unit)} w={48} r /><Cell v={l.quantity_effective} w={32} r /><Cell v={money(l.material_total)} w={58} r b /><Cell v={l.source_note} w={150} /></>}
                {kind === 'labor' && <><Cell v={l.day_label} w={50} /><Cell v={`${l.crew === 'service' ? 'SERVICE TECH — ' : ''}${l.description ?? ''}`} w={300} /><Cell v={money(l.sell_unit)} w={46} r /><Cell v={l.men} w={32} r /><Cell v={l.hrs_each} w={42} r /><Cell v={l.labor_hours} w={40} r /><Cell v={money(l.total_labor)} w={60} r b /><Cell v={l.source_note} w={140} /></>}
                {kind === 'trip' && <><Cell v={l.day_label} w={60} /><Cell v={`${l.crew === 'service' ? 'SERVICE TECH — ' : ''}${l.description ?? ''}`} w={220} /><Cell v={money(l.sell_unit)} w={46} r /><Cell v={l.travel_days} w={56} r /><Cell v={l.techs} w={36} r /><Cell v={l.quantity_effective} w={74} r /><Cell v={money(l.material_total)} w={60} r b /></>}
                {(kind === 'costplus' || kind === 'sub' || kind === 'lodging') && <><Cell v={[l.part_number, l.description].filter(Boolean).join(' — ')} w={290} /><Cell v={money(l.unit_cost)} w={56} r /><Cell v={kind === 'costplus' ? (l.markup_applies ? 'Y' : 'N') : kind === 'sub' ? `${(doc.inputs.sub_markup_pct * 100).toFixed(0)}%` : ''} w={40} r /><Cell v={money(l.sell_unit)} w={56} r /><Cell v={l.quantity_effective} w={50} r /><Cell v={money(l.material_total)} w={60} r b /><Cell v={l.source_note} w={160} /></>}
              </View>
            ))}
            {c.n === 11 && <View style={s.row}><Text style={[s.bdTd, { width: 372 }]}>SUBCONTRACTOR MARKUP {(doc.inputs.sub_markup_pct * 100).toFixed(0)}% ON THE LINES ABOVE</Text><Text style={[s.bdTd, s.right, { width: 60 }]}>{money((catTotal?.material ?? 0) - ls.reduce((a, l) => a + l.material_total, 0))}</Text></View>}
            <View style={[s.row, { backgroundColor: GRAY }]}><Text style={[s.bdTd, s.bold, { width: 372 }]}>TOTAL CATEGORY {c.n}</Text><Text style={[s.bdTd, s.right, s.bold, { width: 60 }]}>{money(catTotal?.total ?? 0)}</Text></View>
          </View>
        )
      }))}
      <View style={{ marginTop: 10 }} wrap={false}>
        <Text style={s.bdSection}>ROLL-UP</Text>
        {[['TOTAL TAXABLE MATERIALS (CATEGORIES 1–4)', t.taxable_material_total], ['TOTAL CONCRETE, EQUIPMENT, SUBCONTRACTOR, DISPOSAL AND PERMITS (5+9+10+11+12)', t.concrete_equipment_total], ['TOTAL LABOR, MOBILIZATION AND LODGING (6+7+8)', t.labor_mobilization_total]].map(([l, v]) => (
          <View key={String(l)} style={s.total}><Text style={s.totalLabel}>{l}</Text><Text style={s.totalValue}>{money(Number(v))}</Text></View>
        ))}
        <View style={s.total}><Text style={[s.totalLabel, s.bold]}>SUBTOTAL ALL CATEGORIES</Text><Text style={[s.totalValue, s.bold]}>{money(t.grand_total)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>CONTINGENCY</Text><Text style={s.totalValue}>{money(t.contingency_amount)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>PROFIT AND OVERHEAD</Text><Text style={s.totalValue}>{money(t.profit_overhead_amount)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>SALES TAX (QUOTE LEVEL)</Text><Text style={s.totalValue}>{money(t.tax_amount)}</Text></View>
        <View style={s.total}><Text style={s.totalLabel}>PROJECT MANAGEMENT FEE</Text><Text style={s.totalValue}>NONE</Text></View>
        <View style={[s.total, { borderTopWidth: 1, borderColor: BLACK, marginTop: 4, paddingTop: 4 }]}><Text style={[s.totalLabel, s.bold, { color: INK, fontSize: 11 }]}>GRAND TOTAL{doc.starting ? ' — STARTING QUOTE' : ''}</Text><Text style={[s.totalValue, s.bold, { fontSize: 11 }]}>{money(t.final_total)}</Text></View>
      </View>
    </View>
  )
}

export type PdfView = 'face' | 'breakdown' | 'both'

export async function renderBillingPdf(doc: BillingDoc, items: Rev19LineInput[], view: PdfView = 'both', opts: { detail?: boolean } = {}): Promise<Buffer> {
  const { lines, totals } = computeRev19(items, doc.inputs)
  // The face is itemised (every line, grouped under its category) unless ?detail=0 asks for the category roll-up.
  const detail = opts.detail ?? true
  const title = doc.kind === 'Proposal' ? 'Bid Proposal' : 'Invoice'
  const basicRows = faceRows('basic', lines, totals.basic, doc.inputs, detail)
  const addRows = faceRows('additional', lines, totals.additional, doc.inputs, detail)
  const pdf = (
    <Document title={`${title} ${doc.number}`} author="Rappahannock Petroleum Services">
      {view !== 'breakdown' && (
        <Page size="LETTER" style={s.page}>
          <ContinuationHeader doc={doc} title={title} />
          <View style={s.frame}>
            <Letterhead doc={doc} title={title} />
            <Parties doc={doc} />
            <ProjectDescription doc={doc} />
            <SectionTable title="BASIC INSTALLATION" rows={basicRows.length ? basicRows : [{ no: '1', desc: '', qty: null, unit: null, material: 0, hours: 0, rate: null, labor: 0, total: 0 }]} subtotalMaterial={totals.basic.subtotal_material} subtotalLabor={totals.basic.subtotal_labor} total={totals.basic.total} totalLabel="BASIC INSTALLATION TOTAL:" />
            {(addRows.length || doc.warranty) ? (
              <SectionTable title="ADDITIONAL SCOPE OF WORK" rows={addRows.length ? addRows : [{ no: '1', desc: doc.warranty ?? '', qty: null, unit: null, material: 0, hours: 0, rate: null, labor: 0, total: 0 }]} subtotalMaterial={totals.additional.subtotal_material} subtotalLabor={totals.additional.subtotal_labor} total={totals.additional.total} totalLabel="ADDITIONAL SCOPE OF WORK TOTAL:" />
            ) : null}
            <FaceTotals doc={doc} t={totals} />
            {doc.exclusions ? <View style={{ marginTop: 8 }}><Text style={[s.bold, { fontSize: 7.5 }]}>EXCLUSIONS AND CLARIFICATIONS</Text><Text style={{ fontSize: 7.5, lineHeight: 1.3 }}>{doc.exclusions}</Text></View> : null}
            {doc.warranty && addRows.length ? <Text style={{ fontSize: 7.5, marginTop: 4 }}>{doc.warranty}</Text> : null}
            <SignatureBlock doc={doc} />
          </View>
          <Text style={s.footer} fixed>{doc.inputs.labor_rate ? `Labor rate ${money(doc.inputs.labor_rate)}/hr${doc.laborRateLabel ? ` (${doc.laborRateLabel})` : ''} · ` : ''}{doc.number}</Text>
        </Page>
      )}
      {view !== 'face' && (
        <Page size="LETTER" orientation="landscape" style={[s.page, { paddingHorizontal: 30 }]}>
          <ContinuationHeader doc={doc} title={`Material and Labor Breakdown — ${title}`} />
          <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
            {logo() ? <Image src={{ data: logo()!, format: 'png' }} style={{ width: 170, height: 54 }} /> : <Text style={s.bold}>RAPPAHANNOCK PETROLEUM SERVICES</Text>}
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[s.bold, { fontSize: 14 }]}>MATERIAL AND LABOR BREAKDOWN — {doc.number}</Text>
              <Text style={[s.tiny, { color: MUTED }]}>{doc.customerName ?? ''}{doc.storeLabel ? ` · ${doc.storeLabel}` : ''}{doc.siteNumber && doc.siteNumber !== doc.storeLabel ? ` · ${doc.siteNumber}` : ''} · {doc.date ?? ''}{doc.csrNumber ? ` · CSR ${doc.csrNumber}` : ''}</Text>
              {doc.starting ? <Text style={[s.tiny, { color: '#9d174d', fontFamily: 'Helvetica-Bold' }]}>STARTING QUOTE — NOT A FINAL QUOTE. Pink items need a price or verification before this goes out.</Text> : null}
            </View>
          </View>
          <Breakdown doc={doc} lines={lines} t={totals} />
        </Page>
      )}
    </Document>
  )
  return renderToBuffer(pdf)
}

/**
 * Small running header on pages 2+ (never on page 1, which carries the letterhead):
 * company · document and number · customer and site · page x of y.
 */
function ContinuationHeader({ doc, title }: { doc: BillingDoc; title: string }) {
  const who = [doc.customerName, doc.storeLabel, doc.siteNumber && doc.siteNumber !== doc.storeLabel ? doc.siteNumber : null].filter(Boolean).join(' · ')
  return (
    <View fixed render={({ pageNumber }) => pageNumber > 1 ? (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 0.6, borderColor: BLACK, paddingBottom: 3, marginBottom: 8 }}>
        <Text style={[s.bold, { fontSize: 8 }]}>RAPPAHANNOCK PETROLEUM SERVICES</Text>
        <Text style={{ fontSize: 7.5 }}>{title} {doc.number}{who ? ` · ${who}` : ''}{doc.date ? ` · ${doc.date}` : ''}</Text>
        <Text style={{ fontSize: 7.5, color: MUTED }} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    ) : null} />
  )
}

/** Map a con_quotes / con_invoices row + its line rows into the renderer's inputs. */
export function docFromRow(kind: 'quote' | 'invoice', row: Record<string, unknown>, customer: { name: string; billing_address: string | null } | null, lines: Record<string, unknown>[]): { doc: BillingDoc; items: Rev19LineInput[] } {
  const N = (v: unknown) => (v == null || v === '' ? null : Number(v))
  const S = (v: unknown) => (v == null ? null : String(v))
  const inputs: Rev19Inputs = {
    material_markup_pct: N(row.material_markup_pct) ?? 0.2, material_tax_pct: N(row.material_tax_pct) ?? 0.053, sub_markup_pct: N(row.sub_markup_pct) ?? 0.15,
    labor_rate: N(row.labor_rate) ?? 0, contingency_pct: N(row.contingency_pct) ?? 0, contingency_flat: N(row.contingency_flat) ?? 0,
    profit_overhead_pct: N(row.profit_overhead_percent) ?? 0, sales_tax_pct: N(row.sales_tax_percent) ?? 0,
  }
  // Legacy = imported before categories existed: no INPUTS block saved, prices already marked up, labor as hours × rate on any row.
  const legacy = N(row.labor_rate) == null && !(row.category_totals && Object.keys(row.category_totals as object).length)
  const items: Rev19LineInput[] = lines.map(l => {
    const cat = Number(l.category) || 4
    const legacyLabor = cat === 7 && N(l.men) == null
    if (legacy) {
      const hrs = N(l.labor_hours) ?? 0, rate = N(l.labor_rate)
      return {
        section: l.section === 'additional' ? 'additional' : 'basic', category: hrs > 0 && N(l.unit_cost) == null ? 7 : cat, description: S(l.description), part_number: S(l.part_number), part_id: S(l.part_id),
        quantity: N(l.quantity), unit_cost: N(l.unit_cost), item_type: S(l.item_type), price_flag: 'ok',
        fixed: { sell_unit: N(l.unit_cost) ?? 0, material_total: N(l.material_total) ?? 0, labor_hours: hrs, labor_rate: rate, total_labor: N(l.total_labor) ?? 0 },
      }
    }
    return {
      section: l.section === 'additional' ? 'additional' : 'basic', category: cat, description: S(l.description), part_number: S(l.part_number), part_id: S(l.part_id),
      quantity: N(l.quantity), unit_cost: N(l.unit_cost), sales_tax_pct: N(l.sales_tax_pct), markup_pct: N(l.markup_pct), freight_per_unit: N(l.freight_per_unit), markup_applies: !!l.markup_applies,
      men: legacyLabor ? 1 : N(l.men), hrs_each: legacyLabor ? N(l.labor_hours) : N(l.hrs_each), labor_rate: N(l.labor_rate), travel_days: N(l.travel_days), techs: N(l.techs),
      day_label: S(l.day_label), crew: S(l.crew), source_note: S(l.source_note), price_flag: S(l.price_flag), item_type: S(l.item_type),
    }
  })
  if (!inputs.labor_rate) { const lr = lines.find(l => N(l.labor_hours) && N(l.labor_rate)); if (lr) inputs.labor_rate = N(lr.labor_rate) ?? 0 }
  const rateLabel = inputs.labor_rate === 78.5 ? '7-Eleven' : inputs.labor_rate === 82.5 ? 'Global' : inputs.labor_rate === 80 ? 'Sunoco' : inputs.labor_rate === 95 ? 'Independent' : null
  const doc: BillingDoc = {
    kind: kind === 'quote' ? 'Proposal' : 'Invoice', starting: kind === 'quote' && row.is_starting_quote !== false,
    number: S(kind === 'quote' ? row.quote_number : row.invoice_number) ?? 'DRAFT',
    date: fmtDate(S(kind === 'quote' ? row.proposal_date : row.invoice_date)), bidDue: row.bid_due ? fmtDate(S(row.bid_due)) : null,
    customerName: customer?.name ?? null, attn: S(row.attn), customerAddress: customer?.billing_address ?? null,
    siteNumber: S(row.site_number), storeLabel: S(row.store_label), facilityAddress: S(row.facility_address), cityStateZip: S(row.city_state_zip),
    csrNumber: S(row.csr_number), poNumber: S(row.po_number), workOrder: S(row.portal_wo_number) ?? S(row.work_order_number), dueDate: row.due_date ? fmtDate(S(row.due_date)) : null,
    projectDescription: S(row.project_description), scopeRows: Array.isArray(row.scope_rows) ? (row.scope_rows as { scope: string; description: string }[]) : [],
    exclusions: S(row.exclusions), warranty: S(row.warranty_line), projectManager: S(row.project_manager), constructionManager: S(row.construction_manager), foreman: S(row.foreman), compiledBy: S(row.compiled_by),
    preparedBy: S(row.prepared_by), inputs, laborRateLabel: rateLabel, department: S(row.department),
  }
  return { doc, items }
}

export { categoryMeta }
