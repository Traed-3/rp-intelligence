// ── One-time historical backfill: permit/inspection emails already sitting
// in econstruction.rp@gmail.com, filed as con_permit_deliverables and
// job-linked. Runs server-side (via app/api/billing/inbox-sync/route.ts)
// rather than as a local script — GMAIL_TOKEN_ECONSTRUCTION is stored in
// Vercel as a write-only Secret, so there is no way to copy it into a local
// .env.local to run this as a standalone script.
import { createAdminClient } from '@/lib/supabase/admin'
import { listMessages, getMessage, getAttachment, listAttachments, header } from '@/lib/billing-gmail-client'
import { findOrCreateJobForPermitSite } from '@/lib/permit-job-link'

const ISSUED_TERMS = ['Dispenser Swap Permit', 'Permit Issued', 'Dispenser Replacement Permit']
const INSPECTION_TERMS = ['Permit Inspection']
const SEARCH_TERMS = `(${[...ISSUED_TERMS, ...INSPECTION_TERMS].map(t => `"${t}"`).join(' OR ')})`
const BUCKET = 'construction-docs'

function classifySubject(subject: string): string {
  const s = subject.toLowerCase()
  if (INSPECTION_TERMS.some(t => s.includes(t.toLowerCase()))) return 'Permit Inspection'
  return 'Issued Permit'
}
function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

export type BackfillResult = {
  sitesProcessed: number
  nextOffset: number | null
  matched: number
  filed: number
  alreadyFiled: number
  noEmail: number
  noPdf: number
  errors: string[]
  perSite: { site_number: string; result: string }[]
}

/**
 * Process one batch of sites (default 5 — Gmail full-message + attachment
 * fetches are slow, so this stays well under the 60s function budget).
 * Call again with the returned nextOffset to continue; nextOffset is null
 * once every site has been processed.
 */
export async function backfillPermitEmails(opts: { limit?: number; offset?: number; apply?: boolean } = {}): Promise<BackfillResult> {
  const limit = opts.limit ?? 5
  const offset = opts.offset ?? 0
  const apply = !!opts.apply
  const admin = createAdminClient()

  const { data: allSites } = await admin.from('con_permit_sites').select('*').order('site_number')
  const sites = (allSites ?? []).slice(offset, offset + limit)

  const out: BackfillResult = {
    sitesProcessed: sites.length, nextOffset: offset + limit < (allSites?.length ?? 0) ? offset + limit : null,
    matched: 0, filed: 0, alreadyFiled: 0, noEmail: 0, noPdf: 0, errors: [], perSite: [],
  }

  for (const site of sites) {
    try {
      const ids = await listMessages('econstruction', `${site.site_number} ${SEARCH_TERMS}`, 25)
      if (!ids.length) { out.noEmail++; out.perSite.push({ site_number: site.site_number, result: 'no matching email' }); continue }

      let sitePdfFound = false
      let sawWrongSite = false
      const notes: string[] = []
      for (const id of ids) {
        const msg = await getMessage('econstruction', id)
        const subject = header(msg, 'Subject')
        // Gmail's search matches the site number anywhere in the thread (a
        // quoted forward, a CC list, an old subject in the same thread) — not
        // just this email's own subject. Confirmed false positives on real
        // data (17206 and 18245 both "matched" a 34022 permit email this
        // way), so require the site number in THIS message's own subject
        // before trusting the match.
        if (!subject.includes(site.site_number)) { sawWrongSite = true; continue }
        const atts = listAttachments(msg).filter(a => /pdf/i.test(a.mimeType) || /\.pdf$/i.test(a.filename))
        if (!atts.length) continue
        sitePdfFound = true
        out.matched++

        for (const a of atts) {
          const { data: existing } = await admin.from('con_permit_deliverables')
            .select('id').eq('site_id', site.id).eq('filename', a.filename).maybeSingle()
          if (existing) { out.alreadyFiled++; notes.push(`${a.filename} already filed`); continue }

          const date = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString().slice(0, 10) : null
          notes.push(`found "${subject}" (${date}) — ${a.filename}`)
          if (!apply) continue

          const bytes = await getAttachment('econstruction', id, a.attachmentId)
          const storagePath = `${site.company_id}/permits/${site.id}/${Date.now()}-${safeName(a.filename)}`
          const { error: upErr } = await admin.storage.from(BUCKET).upload(storagePath, bytes, { contentType: a.mimeType, upsert: true })
          if (upErr) { out.errors.push(`${site.site_number} upload ${a.filename}: ${upErr.message}`); continue }

          const { error: insErr } = await admin.from('con_permit_deliverables').insert({
            company_id: site.company_id, site_id: site.id, created_date: date,
            type: classifySubject(subject), filename: a.filename, storage_path: storagePath,
            where_it_lives: 'Gmail — econstruction.rp (auto-filed)',
          })
          if (insErr) { out.errors.push(`${site.site_number} file ${a.filename}: ${insErr.message}`); continue }
          out.filed++

          const { data: project } = await admin.from('con_permit_projects').select('id, project_type').eq('site_id', site.id).limit(1).maybeSingle()
          if (project) {
            const link = await findOrCreateJobForPermitSite(admin, site.company_id, site, project)
            notes.push(`  -> ${link.status}${'jobId' in link ? ` (${link.jobId})` : ''}`)
          } else {
            notes.push('  -> no permit project at this site yet, skipped job link')
          }
        }
      }
      if (!sitePdfFound) {
        out.noPdf++
        notes.push(sawWrongSite && !notes.length ? 'only matched other sites\' emails (site number not in any subject line)' : 'email(s) found but no PDF attached')
      }
      out.perSite.push({ site_number: site.site_number, result: notes.join('; ') || 'no PDF found' })
    } catch (e) {
      out.errors.push(`${site.site_number}: ${(e as Error).message}`)
    }
  }

  return out
}
