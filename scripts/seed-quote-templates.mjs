#!/usr/bin/env node
/**
 * Seed the starting set of quote templates Trae asked for. Where a real past
 * quote matched the category (found by searching con_quotes/con_quote_line_items
 * for FL100, entry boot, product line, spill bucket, etc.), its scope and line
 * descriptions seed the template. The rest are skeletons — name + category only —
 * for Trae to fill in later or point at a specific past job.
 *
 * Idempotent: skips any name that already exists for the company.
 *
 *   node scripts/seed-quote-templates.mjs            # dry run
 *   node scripts/seed-quote-templates.mjs --apply    # write
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n').map(l => l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

const L = (category, description, section = 'basic') => ({ section, category, description })

const TEMPLATES = [
  {
    name: 'Product Line Replacements',
    category: 'Product Line Replacements',
    description: 'Full RUL/PUL/DSL product line replacement — excavate, run new line, new UDCs, entry boots, purge and test. Seeded from Q2026-SU8001 and Q2026-SU13400/A.',
    scope_rows: [
      { scope: 'PRODUCT LINE REPLACEMENT', description: 'Mobilize and set up perimeter fence. LOTO all fuel breakers. Remove dispensers. Excavate and remove the existing product line(s). Install new product line(s) and new UDCs, islands, and bollards. Install new product line entry boots in the STP sumps. Purge all lines and meet the testing company for testing.' },
    ],
    lines: [
      L(1, 'VR wire'), L(1, 'THHN 12 AWG White'), L(1, 'THHN 12 AWG Black'), L(1, 'THHN 12 AWG Green'),
      L(1, 'THHN 14 AWG — RUL/PUL/DSL return'), L(1, 'Twisted pair data'), L(1, '3/4" seal off'), L(1, '3/4" pull 90\'s'),
      L(1, '3/4" unions'), L(1, '3/4" Erickson coupling'), L(1, '3/4" Rob Roy conduit, 10\' stick'),
      L(1, 'GUP explosion-proof junction box'), L(1, 'Explosion-proof junction box (end run)'),
      L(2, 'Product line pipe (FlexWorks or NOV Dualoy 3000/LCX per spec)'), L(2, 'Entry boot fitting, doublewall FlexWorks or LCX'),
      L(2, 'Containment termination / 90 / tee / coupling'), L(2, 'Primary adapter / 90 / tee / sleeve coupling'),
      L(2, 'PSX-20 adhesive kit'), L(2, '2" full port 2-way brass ball valve'), L(2, 'SS flex connector'),
      L(3, 'Sbravo FRP UDC'), L(3, 'UDC mounting brackets'), L(3, 'OPW cast iron manhole — junction manway, dispenser pad'),
      L(4, 'Shear valve'), L(4, 'Islands'), L(4, 'Bollards'), L(4, 'Filter fabric'),
      L(5, 'Concrete'), L(5, 'Rebar / chair / ties'), L(5, 'Concrete installation — sub'), L(5, 'Gravel #8 clean stone'),
      L(6, 'Hotel & per diem'),
      L(7, 'Mobilize, barricade islands, drain and pull old lines'), L(7, 'Pull old lines out of the chase'),
      L(7, 'Cut and install entry couplings'), L(7, 'Reset dispensers, reconnect at the shear valves, test and start up'),
      L(8, 'Out Monday, home Friday — construction team'),
      L(9, 'Skid steer w/ forks'), L(9, 'Vac truck rental'), L(9, 'RP equipment'),
      L(10, 'Disposables (acetone, sandpaper, rags, leak detector, nitrogen, gloves, blades)'), L(10, 'Disposal fee'),
      L(10, 'DOT barrels', 'additional'), L(10, 'Barrel disposal fee', 'additional'), L(10, 'Fuel charge', 'additional'),
      L(11, 'Electrical sub'),
      L(12, 'Permits'), L(12, 'Soil sampling budget', 'additional'),
    ],
    exclusions: 'Ground water removal is not included. Contaminated soil is not included.',
    notes_by_brand: {
      Sunoco: 'RPS removes the hydro-testing water — price the disposal, do not assume a DOT barrel pickup by others.',
      '7-Eleven': 'Their environmental company removes the DOT barrels — do not price barrel pickup/disposal, just the barrels themselves.',
    },
  },
  {
    name: 'Entry Boot Replacements',
    category: 'Entry Boot Replacements',
    description: 'Repair/replace torn or failed UDC entry boots without a full line replacement. Seeded from the entry-boot lines in Q2026-SU13400.',
    scope_rows: [
      { scope: 'ENTRY BOOT REPLACEMENT', description: 'Install new product line entry boots in the STP/UDC sumps. Inspect surrounding boots and containment while open; note any additional repair needed.' },
    ],
    lines: [
      L(2, 'Entry boot fitting, doublewall FlexWorks or LCX'), L(2, 'PSX-20 adhesive kit'),
      L(3, 'Sbravo FRP UDC (if containment itself has failed)'), L(3, 'UDC mounting brackets'),
      L(7, 'Open sump, cut and install new entry boots'), L(7, 'Hydro test / vac test the repaired boots'),
      L(10, 'Disposables (acetone, rags, gloves)'),
    ],
  },
  {
    name: 'Spill Bucket Replacement',
    category: 'Spill Bucket Replacement',
    description: 'Overspill/vapor bucket replacement and retest. Seeded from Q2026-40107.',
    scope_rows: [
      { scope: 'OVERSPILL BUCKET REPLACEMENT', description: 'Replace and retest the fill and/or vapor overspill buckets.' },
    ],
    lines: [
      L(7, 'Single overspill bucket replacement (RUL)'), L(7, 'Each additional overspill bucket'),
      L(7, 'Single overspill bucket (vapor)'), L(7, 'Each additional overspill bucket (vapor)'),
    ],
  },
  {
    name: 'FL100 Replacements',
    category: 'FL100 Replacements',
    description: 'Replace FL100 fill manhole(s). Seeded from Q2026-SU14675.',
    scope_rows: [
      { scope: 'FL100 MANHOLE REPLACEMENT', description: 'Replace the FL100 fill manhole(s) per the work order.' },
    ],
    lines: [
      L(3, 'FL100 cover/frame kit, composite'), L(3, 'FL100 18" skirt'),
      L(5, 'Ready mix concrete, per CY'), L(5, '#3 rebar, 20\' stick'), L(5, 'Rebar chair'), L(5, 'Concrete/demo disposal fee'),
      L(7, 'Replace FL100 manhole(s)'),
      L(8, 'Week 1 — out Monday, home Friday'),
      L(9, 'Skid steer w/ forks'), L(9, 'Mini excavator'),
      L(10, 'Disposables, per tech/day'), L(10, 'Demo consumables — gloves & Diablo blades per STP'),
    ],
  },
  { name: 'Tank Top / Dispenser Pad Remodel', category: 'Tank Top / Dispenser Pad Remodel', description: 'Full tank top or dispenser pad rebuild. No past quote matched yet — tell me a site/quote number to seed this from, or fill in scope and lines directly.' },
  { name: 'Dispenser Replacement', category: 'Dispenser Replacement', description: 'Swap a dispenser (and associated shear valves/anchoring). No past quote matched yet — several jobs reference "Disp replacement" but none had a priced quote pulled in yet.' },
  { name: 'Tank Top Replacement', category: 'Tank Top Replacement', description: 'Tank top rebuild without a full dispenser pad remodel. No past quote matched yet.' },
  { name: 'Compliance Failure Repairs', category: 'Compliance Failure Repairs', description: 'Repair whatever failed a compliance/Tanknology test (line, containment, sensor, etc.) so the site can pass retest. No past quote matched yet — the Sunoco/7-Eleven hydro-water vs. DOT-barrel split from Product Line Replacements likely applies here too once seeded.' },
  { name: 'Drop Tube Replacements', category: 'Drop Tube Replacements', description: 'Replace a seized or failed drop tube found during compliance testing. No past quote matched yet — many Job List entries mention a seized drop tube, but none had a priced quote pulled in yet.' },
]

async function main() {
  const { data: company } = await sb.from('companies').select('id, name').limit(1).single()
  console.log(`Company: ${company.name} (${company.id})`)
  const { data: existing } = await sb.from('con_quote_templates').select('name').eq('company_id', company.id)
  const existingNames = new Set((existing ?? []).map(t => t.name))

  const toInsert = TEMPLATES.filter(t => !existingNames.has(t.name)).map(t => ({
    company_id: company.id,
    name: t.name,
    category: t.category ?? null,
    description: t.description ?? null,
    department: 'construction',
    scope_rows: t.scope_rows ?? [],
    lines: t.lines ?? [],
    exclusions: t.exclusions ?? null,
    notes_by_brand: t.notes_by_brand ?? {},
    is_active: true,
  }))

  console.log(`${toInsert.length} new template(s) to insert, ${TEMPLATES.length - toInsert.length} already present.`)
  toInsert.forEach(t => console.log(`  ${t.name} (${t.lines.length} lines, ${Object.keys(t.notes_by_brand).length} brand notes)`))

  if (!APPLY) { console.log('\nDry run only. Re-run with --apply to write these rows.'); return }
  const { error } = await sb.from('con_quote_templates').insert(toInsert)
  if (error) { console.error('Insert failed:', error.message); process.exit(1) }
  console.log(`\nInserted ${toInsert.length} templates.`)
}

main()
