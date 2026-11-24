// Dev check: read N recent receipts from the Construction Receipts inbox with the photo-first reader.
// npx tsx --env-file=.env.local scripts/receipt-scan-test.mts [count]
import { createClient } from '@supabase/supabase-js'
import { readReceipt, buildSuggestions, loadScanContext, mediaFor } from '../lib/receipt-scan'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as never as Parameters<typeof loadScanContext>[0]
const count = Number(process.argv[2] ?? 3)
const { data: docs } = await (admin as any).from('billing_inbox_documents').select('id, subject, sender_email, attachments')
  .eq('inbox', 'constructionreceipts').ilike('subject', '%tec%').order('received_at', { ascending: false }).limit(count)
const { data: me } = await (admin as any).from('profiles').select('id').eq('email', 'cswartz.rp@gmail.com').single()
const ctx = await loadScanContext(admin, me.id)
for (const d of docs ?? []) {
  const a = (d.attachments ?? []).find((x: any) => mediaFor(x.name, x.mime))
  if (!a) { console.log('skip (no image):', d.subject); continue }
  const { data } = await (admin as any).storage.from('billing-inbox').download(a.path)
  const t0 = Date.now()
  const read = await readReceipt([{ data: Buffer.from(await data.arrayBuffer()), media: mediaFor(a.name, a.mime)! }], [...new Set(ctx.categories.map(c => c.name))])
  const s = buildSuggestions(read, ctx)
  console.log(`\n${d.subject}  [${d.sender_email}]  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(' read:', JSON.stringify({ vendor: read.vendor, date: read.date, total: read.total, card: read.card_last4, refs: read.job_refs, summary: read.summary, cat: read.category, conf: read.confidence }))
  console.log(' form:', JSON.stringify(Object.fromEntries(Object.entries(s.fields).filter(([, v]) => v != null))), s.warnings)
}
