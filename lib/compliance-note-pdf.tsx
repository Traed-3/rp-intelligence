/**
 * "No previous DOT employer" note to file (49 CFR 391.23(a)(2)), laid out like the other RP DOT forms.
 * Blank, or filled in for one driver once the box is ticked on their file.
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'

export type NoteDriver = {
  full_name: string
  hire_date: string | null
  license_number: string | null
  license_state: string | null
  noted_at: string | null
  noted_by: string | null
}

const mdy = (iso: string | null | undefined) => iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : ''

const INK = '#111', BLUE = '#00008c', LINE = '#888'
const s = StyleSheet.create({
  page: { paddingTop: 34, paddingBottom: 50, paddingHorizontal: 40, fontSize: 9.5, fontFamily: 'Helvetica', color: INK, lineHeight: 1.35 },
  co: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  addr: { fontSize: 8, marginTop: 2 },
  rule: { borderBottomWidth: 0.8, borderBottomColor: INK, marginTop: 5, marginBottom: 14 },
  h1: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  sub: { fontSize: 8, textAlign: 'center', color: '#333', marginTop: 3, marginBottom: 12 },
  sec: { backgroundColor: '#e6e6e6', fontFamily: 'Helvetica-Bold', fontSize: 9, paddingVertical: 4, paddingHorizontal: 6, marginTop: 10, marginBottom: 6 },
  row: { flexDirection: 'row' },
  cell: { borderWidth: 0.5, borderColor: LINE, paddingHorizontal: 4, paddingTop: 3, height: 30 },
  lab: { fontSize: 6.5, color: '#444' },
  val: { fontSize: 10, color: BLUE, marginTop: 2 },
  p: { marginBottom: 7 },
  b: { fontFamily: 'Helvetica-Bold' },
  box: { width: 10, height: 10, borderWidth: 0.8, borderColor: INK, marginRight: 6, marginTop: 1 },
  x: { position: 'absolute', top: 0.5, left: 1.6, fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: BLUE, lineHeight: 1 },
  sigRow: { flexDirection: 'row', marginTop: 30 },
  sig: { borderTopWidth: 0.6, borderTopColor: INK, paddingTop: 2, fontSize: 7.5, color: '#333' },
  sigVal: { position: 'absolute', top: -14, left: 2, fontSize: 10, color: BLUE },
  small: { fontSize: 8, color: '#333' },
  foot: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: '#555', borderTopWidth: 0.5, borderTopColor: LINE, paddingTop: 4 },
})

const Cell = ({ label, value, w }: { label: string; value?: string; w: string | number }) => (
  <View style={[s.cell, { width: w }]}><Text style={s.lab}>{label}</Text><Text style={s.val}>{value ?? ''}</Text></View>
)
const Sig = ({ label, value, w, gap }: { label: string; value?: string; w: string; gap?: boolean }) => (
  <View style={{ width: w, marginRight: gap ? 16 : 0 }}>{value ? <Text style={s.sigVal}>{value}</Text> : null}<Text style={s.sig}>{label}</Text></View>
)

function NoteDoc({ d }: { d: NoteDriver | null }) {
  const on = !!d
  return (
    <Document title="No Previous DOT Employer - Note to File" author="Rappahannock Petroleum, LLC">
      <Page size="LETTER" style={s.page}>
        <Text style={s.co}>RAPPAHANNOCK PETROLEUM, LLC</Text>
        <Text style={s.addr}>225 Ritter Rd, Winchester, VA 22602  |  Phone: (540) 869-5033  |  Fax: (540) 869-5406</Text>
        <View style={s.rule} />

        <Text style={s.h1}>PREVIOUS-EMPLOYER SAFETY HISTORY - NOTE TO FILE</Text>
        <Text style={s.sub}>49 CFR 391.23(a)(2) - No DOT-regulated employer in the 3 years before hire  |  Retain in the Driver Qualification File</Text>

        <Text style={s.sec}>SECTION A - DRIVER</Text>
        <View style={s.row}>
          <Cell label="DRIVER'S FULL NAME" value={d?.full_name} w="46%" />
          <Cell label="DATE OF HIRE" value={mdy(d?.hire_date)} w="18%" />
          <Cell label="DRIVER'S LICENSE NO." value={d?.license_number ?? ''} w="24%" />
          <Cell label="STATE" value={d?.license_state ?? ''} w="12%" />
        </View>

        <Text style={s.sec}>SECTION B - WHAT WAS CHECKED</Text>
        <Text style={s.p}>
          Federal rules require a motor carrier to ask each DOT-regulated employer a new driver worked for during the 3 years before hire
          about the driver&apos;s accident history (49 CFR 391.23(a)(2)). When the driver had no such employer, a note in the file saying so
          takes the place of that request.
        </Text>
        <View style={[s.row, s.p]}>
          <View style={s.box}>{on ? <Text style={s.x}>X</Text> : null}</View>
          <Text style={{ flex: 1 }}>
            <Text style={s.b}>No previous DOT-regulated employer. </Text>
            Rappahannock Petroleum, LLC reviewed this driver&apos;s work history for the 3 years before the date of hire. During that time the
            driver did not work for any employer in a job that required driving a commercial motor vehicle regulated by the U.S. Department
            of Transportation. There is no previous employer to request safety performance history from, and no request was sent.
          </Text>
        </View>
        <Text style={s.small}>
          If the driver later reports a DOT-regulated employer inside that 3-year period, complete the Safety Performance History Investigation
          form for that employer and add it to this file.
        </Text>

        <Text style={s.sec}>SECTION C - COMPANY REPRESENTATIVE</Text>
        <View style={s.sigRow}>
          <Sig label="Signature" w="40%" gap />
          <Sig label="Printed name / title" value={d?.noted_by ?? ''} w="34%" gap />
          <Sig label="Date" value={mdy(d?.noted_at)} w="20%" />
        </View>

        <Text style={s.sec}>SECTION D - DRIVER (recommended)</Text>
        <Text style={s.p}>
          I confirm that during the 3 years before I was hired by Rappahannock Petroleum, LLC I did not work for any employer in a job that
          required me to drive a DOT-regulated commercial motor vehicle.
        </Text>
        <View style={s.sigRow}>
          <Sig label="Driver's signature" w="40%" gap />
          <Sig label="Printed name" value={d?.full_name} w="34%" gap />
          <Sig label="Date" w="20%" />
        </View>

        <View style={s.foot} fixed>
          <Text>RPS-DOT-SP-02  |  No Previous DOT Employer - Note to File  |  49 CFR 391.23(a)(2)</Text>
          <Text>Page 1 of 1</Text>
        </View>
      </Page>
    </Document>
  )
}

export function renderNoPriorDotNote(driver: NoteDriver | null): Promise<Buffer> {
  return renderToBuffer(<NoteDoc d={driver} />)
}
