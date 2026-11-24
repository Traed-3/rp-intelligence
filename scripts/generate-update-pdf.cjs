/* One-off: render the latest daily shop update to a clean PDF using pdfkit. */
const fs = require('fs')
const path = require('path')
const PDFDocument = require('@react-pdf/pdfkit').default || require('@react-pdf/pdfkit')

const PERIOD = 'Jun 18, 9:24pm  to  Jun 19, 7:07pm ET'
const GENERATED = 'Jun 19, 2026 · 7:07pm ET'

const md = `## AR / RY

**A1** _(in progress)_
- has code P0246

**P16**
- cab bushings @ shop; Complete replaced cab bushings _(completed)_
- drilled and installed bolt to bring box up _(completed)_
- AC condenser clogged new condenser ordered _(waiting on parts)_

**RR18** _(waiting on parts)_
- ordered AC compressor kit

## AK

**225GARAGE** _(completed)_
- Rappahannock Petroleum Services

## SP

**H8** _(waiting on parts)_
- We need an estimate with photos please to send to the insurance the agent

## Completed today

**225GARAGE**
- Clean out gutters on warehouse and office — Ariel Kerner — Rappahannock Petroleum Services

**P16**
- rattling and clanking if you drive across the parking lot and if you turn the wheel back-and-forth — Ritchie Yatsko — Complete replaced cab bushings
- fender well is up and the gap at the back door is splitting more — Ritchie Yatsko — drilled and installed bolt to bring box up

## Completed yesterday (after last update)

**225GARAGE**
- Break down bad tires on rims — William Longo — Complete. all tires taken off rims
- Put a stop on the dispenser blocks — Ritchie Yatsko

**A1**
- check engine light back on — Ritchie Yatsko — Complete installed turbo valve

**F6**
- June Inspections

**GG7**
- squeaking noise coming from under the hood — Ritchie Yatsko

**H8**
- Brake Sensor light on, Electronic power steering assist light on, — Austin Renner
- Brake Sensor light on, Electronic power steering assist light on, — Ritchie Yatsko — let battery sit overnight disconnected retried scanning truck this morning. Still can not get into truck to scan codes

**JJ10**
- brakes — Ritchie Yatsko

**TT20**
- small oil leak for CCV — Austin Renner — Complete replace crank Case filter added stop leak and dye started Truck let end and run check for leaks. Oil filter. Housing was leaking replace oil filter, housing gasket, and oil filter.

## Still needs attention

- Review queue (ryatsko.rp@gmail.com): Fwd: June Inspections F6,T363
- **H8** unassigned (waiting on parts): Accident Report`

const NAVY = '#16243d'
const BLUE = '#2d4e7a'
const GRAY = '#6b7280'
const BLACK = '#1a1a1a'

const out = path.join(__dirname, '..', 'RPS-Daily-Update-2026-06-19.pdf')
const doc = new PDFDocument({ size: 'LETTER', margins: { top: 56, bottom: 56, left: 56, right: 56 } })
doc.pipe(fs.createWriteStream(out))

// ── Header ──────────────────────────────────────────────────
doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(10).text('RPS MAINTENANCE', { characterSpacing: 1 })
doc.moveDown(0.2)
doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(22).text('Daily Shop Update')
doc.moveDown(0.15)
doc.fillColor(BLUE).font('Helvetica').fontSize(10).text(PERIOD)
doc.fillColor(GRAY).fontSize(9).text('Generated ' + GENERATED)
doc.moveDown(0.5)
const y = doc.y
doc.moveTo(56, y).lineTo(556, y).lineWidth(1).strokeColor('#e5e7eb').stroke()
doc.moveDown(0.6)

// ── inline **bold** / _italic_ renderer ─────────────────────
function segs(text) {
  const re = /(\*\*[^*]+\*\*|_[^_]+_)/g
  const parts = []
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), b: false, i: false })
    const tok = m[0]
    if (tok.startsWith('**')) parts.push({ t: tok.slice(2, -2), b: true, i: false })
    else parts.push({ t: tok.slice(1, -1), b: false, i: true })
    last = re.lastIndex
  }
  if (last < text.length) parts.push({ t: text.slice(last), b: false, i: false })
  return parts
}

function rich(text, opts = {}) {
  const parts = segs(text)
  parts.forEach((p, idx) => {
    const last = idx === parts.length - 1
    const font = p.b ? 'Helvetica-Bold' : p.i ? 'Helvetica-Oblique' : 'Helvetica'
    doc.font(font).fillColor(p.i ? GRAY : (opts.color || BLACK))
       .text(p.t, { continued: !last, ...opts })
  })
}

// ── Body ────────────────────────────────────────────────────
for (const raw of md.split('\n')) {
  const line = raw.trimEnd()
  if (line === '') { doc.moveDown(0.35); continue }

  if (line.startsWith('## ')) {
    doc.moveDown(0.5)
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(line.slice(3))
    const yy = doc.y + 2
    doc.moveTo(56, yy).lineTo(556, yy).lineWidth(0.5).strokeColor('#d1d5db').stroke()
    doc.moveDown(0.4)
    continue
  }

  if (line.startsWith('- ')) {
    doc.fontSize(10.5)
    const startX = doc.x
    doc.fillColor(BLUE).font('Helvetica-Bold').text('•  ', { continued: true, indent: 8 })
    rich(line.slice(2), { indent: 0 })
    doc.x = startX
    doc.moveDown(0.15)
    continue
  }

  // asset header / plain bold line
  doc.moveDown(0.15).fontSize(11)
  rich(line)
  doc.moveDown(0.1)
}

// ── Footer note ─────────────────────────────────────────────
doc.moveDown(1)
const fy = doc.y
doc.moveTo(56, fy).lineTo(556, fy).lineWidth(0.5).strokeColor('#e5e7eb').stroke()
doc.moveDown(0.5)
doc.fillColor(GRAY).font('Helvetica-Oblique').fontSize(8.5)
   .text('Auto-generated from the RPS Maintenance dashboard. Reconciled against the shop email inbox — every request email in this window is captured as a ticket; the only open item awaiting review is the June Inspections F6,T363 forward.', { align: 'left' })

doc.end()
doc.on('end', () => {})
process.on('exit', () => console.log('wrote', out))
