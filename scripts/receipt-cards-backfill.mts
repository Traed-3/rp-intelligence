// Learn tech-card last-4s from TEC receipts in the Construction Receipts inbox.
// npx tsx --env-file=.env.local scripts/receipt-cards-backfill.mts [maxReads]   (maxReads=0 → no Claude calls)
import { createClient } from '@supabase/supabase-js'
import { backfillCardsFromInbox } from '../lib/receipt-scan'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const { data: co } = await admin.from('companies').select('id').limit(1).single()
const r = await backfillCardsFromInbox(admin as never, co!.id, Number(process.argv[2] ?? 0))
console.log(`TEC receipts: ${r.receipts}  photos read now: ${r.read}  still to read: ${r.remaining}`)
for (const c of r.cards) console.log(`  ${c.last4}  ${String(c.holder ?? '(needs holder)').padEnd(22)} ×${c.count}  ${c.note ?? ''}`)
