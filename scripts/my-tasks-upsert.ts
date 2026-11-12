/**
 * Upsert follow-up items into con_tasks (the "My Plate" page) for one owner.
 *
 *   npx tsx scripts/my-tasks-upsert.ts items.json --owner dodson3.trae@gmail.com [--apply]
 *
 * items.json is a list in the /rps-project-intake open_items shape:
 *   { site_key, item, category, owner, due, asked_on, status, answer }
 * plus optional overrides: title, kind, priority, waiting_on, done (true), detail,
 * and yes_no (true = My Plate shows Yes / No buttons on the row, false = never; leave it out and the page reads the question).
 * Dedupe key = site_key + first 12 hex of sha1(item), so re-running never duplicates a row.
 * Owner names other than the plate owner ("Starsky", "Claude", "ICON") become status = waiting.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

for (const l of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf-8').split('\n')) { const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }

type Item = { site_key?: string; item: string; category?: string; owner?: string; due?: string | null; asked_on?: string; status?: string; answer?: string; title?: string; kind?: string; priority?: number; waiting_on?: string; done?: boolean; detail?: string; yes_no?: boolean }

const KIND: Record<string, string> = { price: 'price', concrete: 'price', disposal: 'price', vendor_quote: 'price', hours: 'quote', permit: 'admin', drawing: 'survey', internal_question: 'followup', customer_question: 'followup', bid: 'bid', order: 'order', quote: 'quote', admin: 'admin', survey: 'survey', followup: 'followup' }

async function main() {
  const [file, ...flags] = process.argv.slice(2)
  const owner = flags[flags.indexOf('--owner') + 1]
  const apply = flags.includes('--apply')
  if (!file || !owner) { console.error('usage: npx tsx scripts/my-tasks-upsert.ts items.json --owner <email> [--apply]'); process.exit(1) }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: prof } = await sb.from('profiles').select('id, company_id, full_name').eq('email', owner).single()
  if (!prof) { console.error(`no profile for ${owner}`); process.exit(1) }
  const first = (prof.full_name ?? '').split(' ')[0].toLowerCase()
  const items: Item[] = JSON.parse(readFileSync(file, 'utf-8'))
  const rows = items.map(it => {
    const site = (it.site_key ?? '').trim() || null
    const key = `${site ?? 'ALL'}|${createHash('sha1').update(it.item).digest('hex').slice(0, 12)}`
    const who = (it.waiting_on ?? it.owner ?? '').trim()
    const waits = !!who && who.toLowerCase() !== first && !who.toLowerCase().startsWith('trae')
    const done = it.done === true || it.status === 'answered' || it.status === 'done' || it.status === 'waived'
    const title = (it.title ?? it.item).replace(/\s+/g, ' ').trim().slice(0, 160)
    const detailParts = [it.detail, it.title ? it.item : null, it.answer ? `Answer: ${it.answer}` : null].filter(Boolean)
    return {
      company_id: prof.company_id, owner_id: prof.id, title, detail: detailParts.length ? detailParts.join('\n') : null,
      kind: it.kind ?? KIND[it.category ?? ''] ?? 'followup', site_number: site && site !== 'ALL' ? site : null,
      priority: it.priority ?? 2, due_date: it.due || null,
      status: done ? 'done' : waits ? 'waiting' : 'open', waiting_on: !done && waits ? who : null, waiting_since: !done && waits ? (it.asked_on ?? null) : null,
      source: 'intake', source_key: key, done_at: done ? new Date().toISOString() : null,
      ...(typeof it.yes_no === 'boolean' ? { action: { yes_no: it.yes_no } } : {}),
    }
  })
  for (const r of rows) console.log(`${r.status.padEnd(7)} ${(r.site_number ?? '-').padEnd(9)} ${r.kind.padEnd(8)} ${r.due_date ?? '      '}  ${r.title.slice(0, 90)}${r.waiting_on ? `  [waiting on ${r.waiting_on}]` : ''}`)
  if (!apply) { console.log(`\n${rows.length} rows. Dry run; add --apply to write.`); return }
  const { error, count } = await sb.from('con_tasks').upsert(rows, { onConflict: 'company_id,owner_id,source_key', ignoreDuplicates: false, count: 'exact' })
  if (error) { console.error(error.message); process.exit(1) }
  console.log(`\nUpserted ${count ?? rows.length} rows for ${owner}.`)
}
main()
