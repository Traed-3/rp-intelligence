// Puts a Technical Help guide's files into the private `help-docs` bucket (creates the bucket the first time).
//   node scripts/upload-help-files.mjs <slug> [--video file.mp4] [--pdf file.pdf] [--poster file.jpg]
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local. Then list the guide in lib/help.ts.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const [slug, ...rest] = process.argv.slice(2)
if (!slug || !/^[a-z0-9-]+$/.test(slug)) { console.error('usage: node scripts/upload-help-files.mjs <slug> [--video f] [--pdf f] [--poster f]'); process.exit(1) }
const KINDS = { '--video': ['video.mp4', 'video/mp4'], '--pdf': ['guide.pdf', 'application/pdf'], '--poster': ['poster.jpg', 'image/jpeg'] }
const BUCKET = 'help-docs'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
if (listErr) throw listErr
if (!buckets.some(b => b.name === BUCKET)) {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: false })
  if (error) throw error
  console.log(`created private bucket ${BUCKET}`)
}
for (let i = 0; i < rest.length; i += 2) {
  const kind = KINDS[rest[i]], file = rest[i + 1]
  if (!kind || !file) { console.error(`skipping ${rest[i]}`); continue }
  const path = `${slug}/${kind[0]}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, fs.readFileSync(file), { contentType: kind[1], upsert: true })
  if (error) throw error
  console.log(`uploaded ${path} (${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`)
}
