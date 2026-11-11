/**
 * Receipts emailed to Construction Receipts → Expenses & Receipts.
 *
 * The inbox sync (lib/billing-inbox-sync.ts) files every email with an attachment from the
 * Construction Receipts mailbox (const.receipt.rp / constructionreceipts) in billing_inbox_documents.
 * Nothing carried those into `expenses`, so the Expenses & Receipts page only ever showed what
 * was keyed in by hand. This pass turns each emailed receipt into one expense row:
 *
 *   "<amount> <CODE> <truck / site / job> <what it was for>"   e.g. "648.77 TEC 26941 rebar"
 *
 *   - submitted_by / submitter_name / submitter_email: whoever sent the email (lib/receipt-submitter.ts)
 *   - payment_method_code: the code after the amount (TEC, HDP, LWS, NOL, ICN …), linked to
 *     payment_methods when it's one of the company's codes
 *   - asset_id: a truck / unit number in the subject (O15, TT20, NN14, A1 …)
 *   - store_number + con_job_id + project_number: a site number (40013, SU-14765, global 11009)
 *   - receipt_url: the attachment, copied to the public `receipts` bucket like hand-entered receipts
 *
 * Idempotent: an expense remembers its source_document_id (unique), so re-running never duplicates.
 * Skipped: $0 packing slips, emails with no amount anywhere, and "Re:" replies to a receipt already on file.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { INBOX_BUCKET } from '@/lib/billing-inbox-sync'
import { resolveSubmitter, type Submitter } from '@/lib/receipt-submitter'


export const RECEIPT_INBOXES = ['constructionreceipts'] as const

export type ReceiptDoc = {
  id: string
  company_id: string
  inbox: string
  gmail_message_id: string
  gmail_thread_id: string | null
  sender: string | null
  sender_email: string | null
  subject: string | null
  received_at: string
  kind: string | null
  vendor: string | null
  reference: string | null
  document_date: string | null
  primary_path: string | null
  attachments: { name: string; mime: string; path: string }[] | null
  extracted: { total?: number | null; vendor?: string | null; reference?: string | null; document_date?: string | null } | null
  extract_status: string | null
}

export type ParsedReceipt = {
  isReply: boolean
  amount: number | null
  code: string | null
  /** what's left after amount + code: "26941 rebar, studs" */
  rest: string
  unit: string | null       // matched asset unit number (canonical spelling)
  store: string | null      // "40013", "SU-14765"
  description: string
}

const REPLY = /^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i
// "1,273.06", "105", "-201.75", "636.0O-" (typo'd O for 0, trailing minus = return), "00.00"
const AMOUNT = /^\s*(-?)\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2})[oO]?)?\s*(-)?(?=[\s,\-–]|$)/
// Payment / account code right after the amount: TEC, HDP, LWS, NOL, ICN, SPT, J&J, SDSW, SPCO, SOURCE …
const CODE = /^[\s,\-–]*([A-Za-z][A-Za-z&]{1,5})(?=[\s,\-–.]|$)[\s,\-–]*/
// Words crews start a description with when they skip the code ("168.46 UV LIGHT for ELL for A1").
const NOT_A_CODE = /^(for|the|and|of|to|on|re|fwd|shop|hotel|fuel|def|stock|work|paid|uv|light|home|lowes|concrete|global|dispenser|construction|permit|application|mke|husky|tool|tools|office|disposable|sheetz)$/i
const SU = /\bSU[\s-]?(\d{3,6}[A-Z]?)\b/i
const BRANDED = /\b(?:global|bp|sheetz|wawa|cpg|7-?eleven|store|site|job)[\s#:-]*(\d{4,6})\b/i
const FIVE = /(?<![\w./-])(\d{5})(?![\w/])/g

const SHARED_BOX = /^(receipts\.rp|const\.receipt\.rp|constructionreceipts)@gmail\.com$/i

const html = (s: string | null | undefined) => (s ?? '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim()

/** Pulls amount, payment code, truck/unit and site number out of a receipt subject line. */
export function parseReceiptSubject(subject: string | null | undefined, unitNumbers: readonly string[]): ParsedReceipt {
  const raw = html(subject)
  const isReply = REPLY.test(raw)
  let rest = raw.replace(REPLY, '')

  let amount: number | null = null
  const m = rest.match(AMOUNT)
  if (m) {
    const n = Number(`${m[2].replace(/,/g, '')}.${m[3] ?? '0'}`)
    amount = m[1] === '-' || m[4] === '-' ? -n : n
    rest = rest.slice(m[0].length)
  }

  let code: string | null = null
  if (amount != null) {
    const c = rest.match(CODE)
    if (c && !NOT_A_CODE.test(c[1]) && !unitNumbers.some(u => u.toUpperCase() === c[1].toUpperCase())) {
      code = c[1].toUpperCase()
      rest = rest.slice(c[0].length)
    }
  }
  rest = rest.replace(/^for\s+/i, '').trim()

  // Truck / unit: the longest unit number that appears as a whole word ("TT20" before "T20").
  const units = [...unitNumbers].filter(u => /^[A-Z]{1,3}\d{1,3}[A-Z]?$/i.test(u)).sort((a, b) => b.length - a.length)
  let unit: string | null = null
  for (const u of units) {
    if (new RegExp(`(^|[^A-Za-z0-9])${u}([^A-Za-z0-9]|$)`, 'i').test(rest)) { unit = u; break }
  }

  let store: string | null = null
  const su = rest.match(SU)
  if (su) store = `SU-${su[1].toUpperCase()}`
  else {
    const b = rest.match(BRANDED)
    if (b) store = b[1]
    else {
      // A bare 5-digit 7-Eleven store number — but not a PO ("PO 24296") or a quantity ("x 40013 ft" never happens).
      for (const f of rest.matchAll(FIVE)) {
        const before = rest.slice(Math.max(0, (f.index ?? 0) - 4), f.index).toLowerCase()
        if (/po\s*#?\s*$/.test(before)) continue
        store = f[1]
        break
      }
    }
  }

  return { isReply, amount, code, rest, unit, store, description: rest }
}

/** What a receipt with no truck or site was for, from the crew's own words. Null = needs a truck/site/job. */
export function overheadBucket(description: string): string | null {
  const t = description.toLowerCase()
  if (/\b(shop|bin|construction|dispenser|tool)\s*stock\b|\bbin restock\b|\brestock\b|\bfor (construction|stock)\s*$|^shop\b/.test(t)) return 'Shop stock'
  if (/\bdisposables?\b|\bgloves?\b|\bshop towels?\b|\brags\b/.test(t)) return 'Disposables'
  if (/\boffice\b|\bprinter\b|\bink\b|\bwrist pad\b|\bpost ?it\b|\bgraph paper\b/.test(t)) return 'Office'
  if (/\bdot\b|\bphysical\b|\bdrug test\b|\bcdl\b|\btraining\b|\bhard ?hat\b|\bapi\b/.test(t)) return 'Training / DOT / certs'
  if (/\bsubscription\b|\bsupabase\b|\banthropic\b|\bsoftware\b/.test(t)) return 'Software'
  if (/\bstorage units?\b/.test(t)) return 'Storage'
  if (/\btraffic\b|\bticket\b|\bcitation\b|\bfine\b/.test(t)) return 'Traffic ticket (policy review)'
  return null
}

const ymd = (iso: string) => {
  // received_at is UTC; the receipt day is Eastern time.
  const d = new Date(iso)
  return new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10)
}
const validDate = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null)
/** The date read off the receipt, unless it's a misread (after the email arrived, or months before it). */
export const plausibleDate = (read: string | null, receivedAt: string) => {
  const emailed = ymd(receivedAt)
  if (!read) return emailed
  const ok = (iso: string) => { const diff = (Date.parse(emailed) - Date.parse(iso)) / 86_400_000; return diff >= -2 && diff <= 120 }
  if (ok(read)) return read
  // Wrong year read off the paper (2024-09-24 on a receipt emailed 9/24/2026): keep month/day, use the email's year.
  const y = Number(emailed.slice(0, 4))
  for (const yr of [y, y - 1]) { const fixed = `${yr}${read.slice(4, 10)}`; if (ok(fixed)) return fixed }
  return emailed
}

export type ImportResult = { checked: number; imported: number; skipped: Record<string, number>; errors: string[]; rows?: unknown[] }

/**
 * Import emailed receipts into expenses.
 * @param opts.since  only docs received on/after this ISO date (default: 3 days back)
 * @param opts.until  only docs received before this ISO date
 * @param opts.apply  false = dry run (returns the rows it would insert)
 * @param opts.limit  max docs to look at in one call
 */
export async function importReceiptExpenses(opts: { since?: string; until?: string; apply?: boolean; limit?: number } = {}): Promise<ImportResult> {
  const admin = createAdminClient()
  const apply = opts.apply ?? true
  const since = opts.since ?? new Date(Date.now() - 3 * 86_400_000).toISOString()
  const out: ImportResult = { checked: 0, imported: 0, skipped: {}, errors: [], rows: apply ? undefined : [] }
  const skip = (why: string) => { out.skipped[why] = (out.skipped[why] ?? 0) + 1 }

  let q = admin.from('billing_inbox_documents')
    .select('id, company_id, inbox, gmail_message_id, gmail_thread_id, sender, sender_email, subject, received_at, kind, vendor, reference, document_date, primary_path, attachments, extracted, extract_status')
    .in('inbox', RECEIPT_INBOXES as unknown as string[])
    .gte('received_at', since)
    .order('received_at')
    .limit(opts.limit ?? 500)
  if (opts.until) q = q.lt('received_at', opts.until)
  const { data: docs, error } = await q
  if (error) throw new Error(error.message)
  if (!docs?.length) return out

  const companyIds = [...new Set(docs.map(d => d.company_id))]
  const ids = docs.map(d => d.id)
  const [{ data: done }, { data: assets }, { data: methods }] = await Promise.all([
    admin.from('expenses').select('source_document_id').in('source_document_id', ids),
    admin.from('assets').select('id, company_id, unit_number').in('company_id', companyIds),
    admin.from('payment_methods').select('id, company_id, code').in('company_id', companyIds),
  ])
  const imported = new Set((done ?? []).map(r => r.source_document_id))
  // Receipts keyed in by hand before this import existed (no source_document_id). A receipt split
  // across several assets is several rows, so compare against each row, each day's total, and any
  // "$123.45" total written in the notes.
  const { data: manual } = await admin.from('expenses').select('expense_date, amount, notes')
    .in('company_id', companyIds).is('source_document_id', null)
  const manualHits = (day: string, amt: number) => {
    const near = (manual ?? []).filter(r => Math.abs(Date.parse(r.expense_date) - Date.parse(day)) <= 4 * 86_400_000)
    const c = Math.round(Math.abs(amt) * 100)
    if (near.some(r => Math.round(Number(r.amount) * 100) === c)) return true
    const byDay = new Map<string, number>()
    for (const r of near) byDay.set(r.expense_date, (byDay.get(r.expense_date) ?? 0) + Math.round(Number(r.amount) * 100))
    if ([...byDay.values()].includes(c)) return true
    return near.some(r => [...(r.notes ?? '').matchAll(/\$(\d[\d,]*\.\d{2})/g)].some(m => Math.round(Number(m[1].replace(/,/g, '')) * 100) === c))
  }
  // Subjects already on file as an original (non-reply) receipt, so "Re: <same subject>" isn't a second charge.
  // Keyed on amount + description, so "Re: 168.46 TEC UV LIGHT…" still matches "168.46 UV LIGHT…".
  const unitList = (assets ?? []).map(a => a.unit_number).filter(Boolean) as string[]
  const subjectKey = (subject: string | null) => { const p = parseReceiptSubject(subject, unitList); return `${p.amount}|${p.rest.toLowerCase().replace(/\s+/g, ' ')}` }
  const originals = new Set(docs.filter(d => !REPLY.test(html(d.subject))).map(d => subjectKey(d.subject)))
  const submitters = new Map<string, Submitter>()
  const jobCache = new Map<string, { id: string; job_number: string | null } | null>()

  for (const d of docs as ReceiptDoc[]) {
    out.checked++
    if (imported.has(d.id)) { skip('already imported'); continue }
    try {
      const units = (assets ?? []).filter(a => a.company_id === d.company_id && a.unit_number).map(a => a.unit_number as string)
      const p = parseReceiptSubject(d.subject, units)
      const ex = d.extracted ?? {}
      const receiptTotal = typeof ex.total === 'number' ? ex.total : null

      if (p.isReply && originals.has(subjectKey(d.subject))) { skip('reply to a receipt on file'); continue }
      // "0.00 NOL bin restock" = a packing slip for an account order, not a charge.
      if (p.amount === 0) { skip('$0 packing slip'); continue }
      const amount = p.amount ?? receiptTotal
      if (amount == null || amount === 0) { skip('no amount'); continue }

      // Who sent it. A forward from the shared receipts box credits whoever sent the original.
      let senderEmail = d.sender_email, senderName = d.sender
      if (SHARED_BOX.test(senderEmail ?? '')) {
        const base = subjectKey(d.subject)
        const orig = (docs as ReceiptDoc[]).find(o => o.id !== d.id && !SHARED_BOX.test(o.sender_email ?? '') && subjectKey(o.subject) === base)
        if (orig) { senderEmail = orig.sender_email; senderName = orig.sender }
      }
      const key = `${d.company_id}|${(senderEmail ?? '').toLowerCase()}`
      let who = submitters.get(key)
      if (!who) {
        who = await resolveSubmitter(admin as never, d.company_id, senderEmail, senderName)
        submitters.set(key, who)
      }

      const unit = p.unit ? (assets ?? []).find(a => a.company_id === d.company_id && a.unit_number?.toUpperCase() === p.unit!.toUpperCase()) : null
      let job: { id: string; job_number: string | null } | null = null
      if (p.store) {
        const jk = `${d.company_id}|${p.store}`
        if (!jobCache.has(jk)) {
          const docDay = plausibleDate(validDate(ex.document_date), d.received_at)
          const { data: jobs } = await admin.from('con_jobs')
            .select('id, job_number, date_received, project_start_date, stage')
            .eq('company_id', d.company_id).ilike('site_number', p.store)
            .order('date_received', { ascending: false, nullsFirst: false }).limit(10)
          // The job open on the receipt date: received on/before it, newest first; else the newest one.
          const pick = (jobs ?? []).find(j => (j.date_received ?? '0000') <= docDay) ?? (jobs ?? [])[0] ?? null
          jobCache.set(jk, pick ? { id: pick.id, job_number: pick.job_number } : null)
        }
        job = jobCache.get(jk) ?? null
      }
      const bucket = unit || p.store ? null : overheadBucket(p.description)
      const pm = p.code ? (methods ?? []).find(m => m.company_id === d.company_id && m.code?.toUpperCase() === p.code) : null

      const row = {
        company_id: d.company_id,
        submitted_by: who.profileId,
        submitter_name: who.name,
        submitter_email: who.email,
        source_document_id: d.id,
        expense_date: plausibleDate(validDate(ex.document_date) ?? validDate(d.document_date), d.received_at),
        amount,
        description: p.description || html(d.subject) || null,
        vendor: html(ex.vendor ?? d.vendor) || null,
        expense_type: job ? 'project' : p.store ? 'store' : unit ? 'asset' : 'general',
        asset_id: unit?.id ?? null,
        store_number: p.store,
        project_number: job?.job_number ?? null,
        con_job_id: job?.id ?? null,
        payment_method_id: pm?.id ?? null,
        payment_method_code: p.code,
        category_custom: bucket,
        notes: [
          !unit && !p.store && !bucket ? 'NEEDS A TRUCK, SITE OR JOB # — none in the email subject.' : null,
          `Emailed to Construction Receipts by ${who.name ?? senderName ?? senderEmail}${who.email ? ` <${who.email}>` : ''} on ${ymd(d.received_at)}.`,
          `Subject: ${html(d.subject)}`,
          receiptTotal != null && Math.abs(receiptTotal - amount) > 0.01 ? `Receipt total reads $${receiptTotal.toFixed(2)}.` : null,
          p.code && !pm ? `Code ${p.code} is not in Settings → Payment methods.` : null,
        ].filter(Boolean).join('\n'),
        ai_extracted: { source: 'billing_inbox', billing_doc_id: d.id, gmail_message_id: d.gmail_message_id, subject: html(d.subject), receipt_total: receiptTotal, reference: ex.reference ?? d.reference ?? null },
        receipt_url: null as string | null,
      }

      if (manualHits(row.expense_date, amount)) { skip('already keyed in by hand'); continue }

      if (!apply) { out.rows!.push(row); out.imported++; continue }

      // Copy the receipt image/PDF to the public receipts bucket (where hand-entered receipts live).
      const att = d.attachments?.find(a => a.path === d.primary_path) ?? d.attachments?.[0]
      if (att) {
        const { data: blob, error: dl } = await admin.storage.from(INBOX_BUCKET).download(att.path)
        if (!dl && blob) {
          const dest = `inbox/${d.gmail_message_id}/${att.path.split('/').pop()}`
          const { error: up } = await admin.storage.from('receipts').upload(dest, blob, { contentType: att.mime, upsert: true })
          if (!up) row.receipt_url = admin.storage.from('receipts').getPublicUrl(dest).data.publicUrl
        }
      }

      const { error: insErr } = await admin.from('expenses').insert(row)
      if (insErr) {
        if (/duplicate key|unique/i.test(insErr.message)) { skip('already imported'); continue }
        throw new Error(insErr.message)
      }
      out.imported++
    } catch (e) {
      out.errors.push(`${d.id} (${html(d.subject).slice(0, 60)}): ${(e as Error).message}`)
    }
  }
  return out
}
