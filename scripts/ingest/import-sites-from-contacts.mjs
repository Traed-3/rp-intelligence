// ============================================================
// import-sites-from-contacts — load the sites out of "Current RPS Contacts".
//
// The PDF is a contacts export, so people and locations are mixed together.
// Anything with a .rp@ email is staff and is skipped here (they go to
// con_contacts). Everything with a full street address is a site.
//
// The brand in the name only tells us the customer when it is unambiguous —
// Sheetz, Wawa, Sunoco, 7-Eleven. "DUMFRIES EXXON" could be Global or
// Capital Petroleum, so it is imported with no customer rather than guessed.
//
// Skips any site already on file (matched on name + zip). Dry run unless
// --commit is passed.
//
//   node --env-file=.env.local scripts/ingest/import-sites-from-contacts.mjs [--commit]
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const COMMIT = process.argv.includes('--commit')
const SRC = '/private/tmp/claude-501/-Users-rpsstudio2/f755c5c5-e37a-41ce-9820-5b7027345efe/scratchpad/sites2.json'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

async function page(table, select) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    const b = await r.json()
    if (!Array.isArray(b)) throw new Error(JSON.stringify(b).slice(0, 200))
    out.push(...b)
    if (b.length < 1000) return out
  }
}

// Only brands that map to exactly one customer. Exxon, Shell, BP and the
// unbranded independents are deliberately absent — the brand on the canopy
// does not tell us who RPS bills.
const CERTAIN = [
  [/\bsheetz\b/i,                  'Sheetz',   'Sheetz'],
  [/\bwawa\b/i,                    'Wawa',     'Wawa'],
  [/\bsunoco\b|\bsinoco\b/i,       'Sunoco LP', 'Sunoco'],
  [/7\s*-?\s*(11|eleven)\b/i,      '7-Eleven', '7-Eleven'],
]

const STATES = { VIRGINIA: 'VA', MARYLAND: 'MD', 'WEST VIRGINIA': 'WV', PENNSYLVANIA: 'PA', DELAWARE: 'DE' }

const raw = JSON.parse(readFileSync(SRC, 'utf8'))
const customers = new Map((await page('con_customers', 'id,name')).map(c => [c.name.toLowerCase(), c]))
const existing = await page('con_sites', 'id,site_number,zip')
const seen = new Set(existing.map(s => `${String(s.site_number || '').trim().toLowerCase()}|${s.zip || ''}`))
const companyId = (await page('con_jobs', 'company_id'))[0].company_id

const plan = []
let dupes = 0, noaddr = 0
for (const r of raw) {
  if (!r.addr) { noaddr++; continue }
  const [street, city, stateRaw, zip] = r.addr
  const name = String(r.name || '').replace(/\s+/g, ' ').trim()
  if (!name) { noaddr++; continue }
  if (seen.has(`${name.toLowerCase()}|${zip}`)) { dupes++; continue }
  seen.add(`${name.toLowerCase()}|${zip}`)

  const hit = CERTAIN.find(([re]) => re.test(name))
  plan.push({
    company_id: companyId,
    site_number: name,
    store_brand: hit ? hit[2] : null,
    address: street || null,
    city: city || null,
    state: STATES[String(stateRaw).toUpperCase()] ?? stateRaw,
    zip,
    customer_id: hit ? (customers.get(hit[1].toLowerCase())?.id ?? null) : null,
    notes: 'Imported from "Current RPS Contacts".',
  })
}

const withCust = plan.filter(p => p.customer_id).length
console.log(`\n== import-sites-from-contacts ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} ==`)
console.log(`sites to import        : ${plan.length}`)
console.log(`  customer identified  : ${withCust}`)
console.log(`  customer left blank  : ${plan.length - withCust}`)
console.log(`already on file        : ${dupes}`)
console.log(`no usable address      : ${noaddr}`)
console.log('\nsample:')
plan.slice(0, 10).forEach(p => console.log(
  `   ${(p.store_brand ?? '—').padEnd(9)} ${p.site_number.slice(0, 30).padEnd(32)} ${(p.address ?? '').slice(0, 28).padEnd(30)} ${p.city}, ${p.state} ${p.zip}`))

if (!COMMIT) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit')
  process.exit(0)
}

mkdirSync('scripts/ingest/backups', { recursive: true })
writeFileSync(`scripts/ingest/backups/sites-imported-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  JSON.stringify(plan, null, 1))

let made = 0
for (let i = 0; i < plan.length; i += 50) {
  const chunk = plan.slice(i, i + 50)
  const r = await fetch(`${url}/rest/v1/con_sites`, { method: 'POST', headers: H, body: JSON.stringify(chunk) })
  if (r.ok) made += chunk.length
  else console.warn('  batch failed:', (await r.text()).slice(0, 140))
}
console.log(`\ncreated ${made} sites`)
