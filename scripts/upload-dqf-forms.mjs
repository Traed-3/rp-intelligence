// Load the blank RP DOT forms (docs/dqf-forms/*.pdf) into the private hr-compliance bucket under _forms/ so
// DQF & Certs → Forms can hand them out. Safe to re-run: each file is replaced.
//   node --env-file=.env.local scripts/upload-dqf-forms.mjs
import { createClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'dqf-forms')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

for (const f of readdirSync(dir).filter(f => f.endsWith('.pdf')).sort()) {
  const { error } = await admin.storage.from('hr-compliance').upload(`_forms/${f}`, readFileSync(join(dir, f)), { contentType: 'application/pdf', upsert: true })
  console.log(error ? `FAILED ${f}: ${error.message}` : `ok     _forms/${f}`)
  if (error) process.exitCode = 1
}
