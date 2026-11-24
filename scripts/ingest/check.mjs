// Self-test for the rps-doc-ingest importer: confirms the service key reaches
// Supabase, the construction-docs bucket exists, and we can write+delete a file.
// Run: node --env-file=.env.local scripts/ingest/check.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1) }

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const { data: buckets, error: bErr } = await admin.storage.listBuckets()
console.log('buckets:', bErr ? `ERROR ${bErr.message}` : buckets.map(b => b.id).join(', '))

const { count, error: cErr } = await admin.from('con_documents').select('id', { count: 'exact', head: true })
console.log('con_documents rows:', cErr ? `ERROR ${cErr.message}` : count)

const { count: jobCount } = await admin.from('con_jobs').select('id', { count: 'exact', head: true })
console.log('con_jobs rows:', jobCount)

const testPath = `_ingest_selftest/${Date.now()}.txt`
const { error: upErr } = await admin.storage.from('construction-docs')
  .upload(testPath, Buffer.from('rps-doc-ingest selftest'), { contentType: 'text/plain', upsert: true })
console.log('storage write test:', upErr ? `ERROR ${upErr.message}` : 'ok')
if (!upErr) {
  const { error: rmErr } = await admin.storage.from('construction-docs').remove([testPath])
  console.log('storage cleanup:', rmErr ? `ERROR ${rmErr.message}` : 'ok')
}
