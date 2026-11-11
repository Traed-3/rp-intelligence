// Photo-first receipts: read a receipt photo with Claude, then combine what it says with who is
// submitting it (their clocked-in job, today's daily update, their truck, their tech card) to
// pre-fill the expense form. Nothing here saves an expense — the form shows every guess and the
// person edits/confirms before Submit.
//
// Card learning: every tech has their own TEC card, so the last 4 digits on a receipt identify both
// the payment method and whose card it is. `expense_cards` maps last4 → code + holder. It's learned
// from saved expenses (learnCardFromExpense) and backfilled from receipts already emailed to the
// Construction Receipts inbox with "TEC" in the subject (backfillCardsFromInbox).

import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { INBOX_BUCKET } from '@/lib/billing-inbox-sync'
import { parseCardSubject } from '@/lib/card-audit'

type Admin = ReturnType<typeof createAdminClient>

const MODEL = process.env.RECEIPT_SCAN_MODEL ?? process.env.BILLING_EXTRACT_MODEL ?? 'claude-sonnet-5'
const FALLBACK_MODEL = 'claude-sonnet-4-6'

// ── What Claude reads off the receipt ────────────────────────────────────────

export type ReceiptRead = {
  vendor: string | null
  vendor_city: string | null
  date: string | null            // YYYY-MM-DD
  total: number | null
  tax: number | null
  payment_type: 'card' | 'cash' | 'check' | 'account' | 'unknown'
  card_last4: string | null
  card_brand: string | null
  cardholder_name: string | null
  job_refs: string[]             // store #s / job #s / PO #s printed or handwritten
  summary: string | null         // "2× 3/4in ball valve, PVC cement"
  category: string | null        // one of the category names we passed in, or null
  is_fuel: boolean
  gallons: number | null
  confidence: 'high' | 'medium' | 'low'
}

const RECEIPT_TOOL: Anthropic.Tool = {
  name: 'record_receipt',
  description: 'Record what this purchase receipt says.',
  input_schema: {
    type: 'object',
    properties: {
      vendor: { type: ['string', 'null'], description: 'Store/merchant name as a person would say it, e.g. "Home Depot", "Lowe\'s", "Sheetz", "Ferguson".' },
      vendor_city: { type: ['string', 'null'], description: 'City and state of the store, if printed.' },
      date: { type: ['string', 'null'], description: 'Purchase date, YYYY-MM-DD.' },
      total: { type: ['number', 'null'], description: 'Grand total actually charged (after tax, after discounts). Negative for a refund/return.' },
      tax: { type: ['number', 'null'] },
      payment_type: { type: 'string', enum: ['card', 'cash', 'check', 'account', 'unknown'], description: '"account" = charged to a store/pro account with no card.' },
      card_last4: { type: ['string', 'null'], description: 'Last 4 digits of the card used, exactly as printed (e.g. "XXXXXXXXXXXX6609", "VISA ****6609", "Acct #: ...6609" → "6609"). null if not printed.' },
      card_brand: { type: ['string', 'null'], description: 'VISA, MASTERCARD, AMEX, DISCOVER, or null.' },
      cardholder_name: { type: ['string', 'null'], description: 'Cardholder name if the receipt prints it.' },
      job_refs: { type: 'array', items: { type: 'string' }, description: 'Any job / store / site / PO numbers printed OR handwritten on the receipt (e.g. "40042", "SU-13400", "PO 24275", "Job: 32346"). Do NOT include register, transaction, invoice, or phone numbers.' },
      summary: { type: ['string', 'null'], description: 'Short plain-English description of what was bought, max ~80 chars, e.g. "Pea gravel (10 bags)" or "PVC cement, 3/4in ball valves, tape".' },
      category: { type: ['string', 'null'], description: 'Best matching category from the list given, copied exactly, or null if none fit.' },
      is_fuel: { type: 'boolean', description: 'True when this is a fuel/gas/diesel purchase for a vehicle.' },
      gallons: { type: ['number', 'null'] },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'low if the photo is blurry, cut off, or not a receipt.' },
    },
    required: ['vendor', 'date', 'total', 'payment_type', 'card_last4', 'job_refs', 'summary', 'is_fuel', 'confidence'],
  },
}

const SYSTEM = `You read purchase receipts photographed by field techs at Rappahannock Petroleum (petroleum equipment construction/service in VA/MD/WV). Read only what is on the receipt; never guess digits you cannot see. Store numbers on 7-Eleven work are usually 5 digits (e.g. 40042), Sunoco sites look like SU-13400, Sheetz 3 digits. Record the receipt with record_receipt.`

export type ImageInput = { data: Buffer; media: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }

export function mediaFor(name: string, mime?: string | null): ImageInput['media'] | null {
  const m = (mime ?? '').toLowerCase()
  if (m === 'image/jpeg' || m === 'image/jpg' || /\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (m === 'image/png' || /\.png$/i.test(name)) return 'image/png'
  if (m === 'image/webp' || /\.webp$/i.test(name)) return 'image/webp'
  if (m === 'image/gif' || /\.gif$/i.test(name)) return 'image/gif'
  return null
}

/** Sniff the real image type from the bytes (phones mislabel often; the API rejects mismatches). */
function sniff(buf: Buffer, fallback: ImageInput['media']): ImageInput['media'] {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp'
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif'
  return fallback
}

async function callTool(content: Anthropic.ContentBlockParam[], tool: Anthropic.Tool, maxTokens = 1500) {
  const client = new Anthropic()
  const call = (model: string) => client.messages.create({
    model, max_tokens: maxTokens, system: SYSTEM, tools: [tool],
    tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content }],
  })
  let res: Anthropic.Message
  try { res = await call(MODEL) }
  catch (e) {
    if (/not_found|model/i.test((e as Error).message) && MODEL !== FALLBACK_MODEL) res = await call(FALLBACK_MODEL)
    else throw e
  }
  const block = res.content.find(b => b.type === 'tool_use') as Anthropic.ToolUseBlock | undefined
  if (!block) throw new Error('The receipt reader returned nothing.')
  return block.input as Record<string, unknown>
}

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v.trim() && isFinite(Number(v)) ? Number(v) : null)
export const cleanLast4 = (v: unknown) => { const m = String(v ?? '').match(/(\d{4})\D*$/); return m ? m[1] : null }

export async function readReceipt(images: ImageInput[], categories: string[]): Promise<ReceiptRead> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Receipt reading is not set up (ANTHROPIC_API_KEY missing).')
  const content: Anthropic.ContentBlockParam[] = images.slice(0, 3).map(img => ({
    type: 'image', source: { type: 'base64', media_type: sniff(img.data, img.media), data: img.data.toString('base64') },
  }))
  content.push({ type: 'text', text: `Categories to choose from: ${categories.length ? categories.join(' | ') : '(none)'}\n\nRecord this receipt.` })
  const r = await callTool(content, RECEIPT_TOOL)
  const date = s(r.date)
  return {
    vendor: s(r.vendor),
    vendor_city: s(r.vendor_city),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    total: n(r.total),
    tax: n(r.tax),
    payment_type: (['card', 'cash', 'check', 'account'].includes(r.payment_type as string) ? r.payment_type : 'unknown') as ReceiptRead['payment_type'],
    card_last4: cleanLast4(r.card_last4),
    card_brand: s(r.card_brand)?.toUpperCase() ?? null,
    cardholder_name: s(r.cardholder_name),
    job_refs: Array.isArray(r.job_refs) ? (r.job_refs as unknown[]).map(x => String(x).trim()).filter(Boolean).slice(0, 6) : [],
    summary: s(r.summary),
    category: s(r.category),
    is_fuel: r.is_fuel === true,
    gallons: n(r.gallons),
    confidence: (['high', 'medium', 'low'].includes(r.confidence as string) ? r.confidence : 'medium') as ReceiptRead['confidence'],
  }
}

/** Download an uploaded receipt (public `receipts` bucket URL from /api/upload). */
export async function loadReceiptImage(admin: Admin, url: string): Promise<ImageInput | null> {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign)\/receipts\/([^?]+)/)
  if (!m) return null
  const path = decodeURIComponent(m[1])
  const { data, error } = await admin.storage.from('receipts').download(path)
  if (error || !data) return null
  const media = mediaFor(path, data.type) ?? 'image/jpeg'
  return { data: Buffer.from(await data.arrayBuffer()), media }
}

// ── Context about the person submitting ──────────────────────────────────────

export type ScanContext = {
  profile: { id: string; company_id: string; full_name: string | null }
  clocked: { con_job_id: string | null; store_number: string | null; site_number: string | null } | null
  todayJob: { con_job_id: string; site_number: string | null } | null
  lastExpense: { expense_type: string; con_job_id: string | null; store_number: string | null; project_number: string | null; asset_id: string | null; created_at: string } | null
  truck: { id: string; unit_number: string } | null
  cards: { last4: string; payment_method_code: string; holder_profile_id: string | null; holder_label: string | null; brand: string | null }[]
  holders: Record<string, string>   // profile id → full name
  openJobs: { id: string; site_number: string | null; work_order_number: string | null }[]
  paymentCodes: string[]
  categories: { id: string; name: string; context: string }[]
}

const todayNY = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

export async function loadScanContext(admin: Admin, profileId: string): Promise<ScanContext> {
  const { data: profile } = await admin.from('profiles').select('id, company_id, full_name').eq('id', profileId).single()
  if (!profile) throw new Error('Profile not found')
  const cid = profile.company_id as string
  const today = todayNY()

  const [clockRes, jobsRes, lastRes, truckRes, cardsRes, pmRes, catRes, peopleRes] = await Promise.all([
    admin.from('time_clock_entries').select('con_job_id, store_number').eq('profile_id', profileId).is('clock_out', null)
      .order('clock_in', { ascending: false }).limit(1).maybeSingle(),
    admin.from('con_jobs').select('id, site_number, work_order_number').eq('company_id', cid).neq('stage', 'complete').limit(500),
    admin.from('expenses').select('expense_type, con_job_id, store_number, project_number, asset_id, created_at')
      .eq('submitted_by', profileId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('assets').select('id, unit_number').eq('assigned_profile_id', profileId).neq('status', 'retired').limit(1).maybeSingle(),
    admin.from('expense_cards').select('last4, payment_method_code, holder_profile_id, holder_label, brand').eq('company_id', cid).eq('is_active', true),
    admin.from('payment_methods').select('code').eq('company_id', cid).eq('is_active', true),
    admin.from('expense_categories').select('id, name, context').eq('company_id', cid).eq('is_active', true).order('sort_order'),
    admin.from('profiles').select('id, full_name').eq('company_id', cid),
  ])
  const openJobs = (jobsRes.data ?? []) as ScanContext['openJobs']
  const holders: Record<string, string> = {}
  for (const p of peopleRes.data ?? []) if (p.full_name) holders[p.id as string] = p.full_name as string

  let clocked: ScanContext['clocked'] = null
  if (clockRes.data && (clockRes.data.con_job_id || clockRes.data.store_number)) {
    const j = openJobs.find(x => x.id === clockRes.data!.con_job_id)
    clocked = { con_job_id: clockRes.data.con_job_id, store_number: clockRes.data.store_number, site_number: j?.site_number ?? null }
  }

  // Today's daily update that names this person (techs are stored by name/initials, not profile id).
  let todayJob: ScanContext['todayJob'] = null
  if (!clocked && profile.full_name) {
    const first = String(profile.full_name).split(/\s+/)[0]
    const last = String(profile.full_name).split(/\s+/).slice(-1)[0]
    const { data: ups } = await admin.from('con_daily_updates').select('job_id, con_daily_update_techs(tech_name, initials)')
      .eq('company_id', cid).eq('work_date', today).limit(50)
    const hit = (ups ?? []).find(u => ((u as unknown as { con_daily_update_techs: { tech_name: string | null }[] }).con_daily_update_techs ?? [])
      .some(t => { const nm = (t.tech_name ?? '').toLowerCase(); return nm.includes(last.toLowerCase()) && nm.includes(first.toLowerCase().slice(0, 3)) }))
    if (hit?.job_id) todayJob = { con_job_id: hit.job_id as string, site_number: openJobs.find(j => j.id === hit.job_id)?.site_number ?? null }
  }

  return {
    profile: profile as ScanContext['profile'],
    clocked, todayJob,
    lastExpense: lastRes.data as ScanContext['lastExpense'],
    truck: truckRes.data as ScanContext['truck'],
    cards: (cardsRes.data ?? []) as ScanContext['cards'],
    holders,
    openJobs,
    paymentCodes: (pmRes.data ?? []).map(p => p.code as string),
    categories: (catRes.data ?? []) as ScanContext['categories'],
  }
}

// ── Combine the read + context into form suggestions ─────────────────────────

export type Suggestion = {
  expense_date: string | null
  amount: number | null
  vendor: string | null
  description: string | null
  payment_method_code: string | null
  card_last4: string | null
  expense_type: 'asset' | 'store' | 'project' | 'general' | null
  con_job_id: string | null
  store_number: string | null
  project_number: string | null
  asset_id: string | null
  category_id: string | null
  category_custom: string | null
}
export type ScanResult = {
  fields: Suggestion
  why: Partial<Record<keyof Suggestion, string>>   // shown next to each auto-filled field
  cardholder: { profile_id: string | null; name: string } | null
  warnings: string[]
  read: ReceiptRead
}

const normSite = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')

function vendorCode(vendor: string | null, codes: string[]): string | null {
  const v = (vendor ?? '').toLowerCase()
  if (/home\s*depot/.test(v) && codes.includes('HDP')) return 'HDP'
  if (/lowe'?s/.test(v) && codes.includes('LWS')) return 'LWS'
  return null
}

export function buildSuggestions(read: ReceiptRead, ctx: ScanContext): ScanResult {
  const why: ScanResult['why'] = {}
  const warnings: string[] = []
  const f: Suggestion = {
    expense_date: read.date, amount: read.total, vendor: read.vendor, description: read.summary,
    payment_method_code: null, card_last4: read.card_last4, expense_type: null, con_job_id: null,
    store_number: null, project_number: null, asset_id: null, category_id: null, category_custom: null,
  }
  if (read.date) why.expense_date = 'From receipt'
  if (read.total != null) why.amount = 'From receipt'
  if (read.vendor) why.vendor = 'From receipt'
  if (read.summary) why.description = 'From receipt'
  if (read.date && read.date > todayNY()) warnings.push('The receipt date is in the future — check the date.')
  if (read.confidence === 'low') warnings.push('The photo was hard to read — double-check every field.')

  // Payment method + cardholder
  let cardholder: ScanResult['cardholder'] = null
  const card = read.card_last4 ? ctx.cards.find(c => c.last4 === read.card_last4) : undefined
  if (card) {
    f.payment_method_code = card.payment_method_code
    const name = card.holder_profile_id ? ctx.holders[card.holder_profile_id] ?? card.holder_label : card.holder_label
    if (name) cardholder = { profile_id: card.holder_profile_id, name }
    why.payment_method_code = `Card ending ${card.last4}${name ? ` = ${name}'s ${card.payment_method_code} card` : ''}`
    if (card.holder_profile_id && card.holder_profile_id !== ctx.profile.id && name)
      warnings.push(`Card ending ${card.last4} is on file as ${name}'s card.`)
  } else if (read.payment_type === 'cash') {
    if (ctx.paymentCodes.includes('CASH')) { f.payment_method_code = 'CASH'; why.payment_method_code = 'Receipt says cash' }
  } else if (read.payment_type === 'check') {
    if (ctx.paymentCodes.includes('CHK')) { f.payment_method_code = 'CHK'; why.payment_method_code = 'Receipt says check' }
  } else {
    const vc = vendorCode(read.vendor, ctx.paymentCodes)
    if (vc && read.payment_type === 'account') { f.payment_method_code = vc; why.payment_method_code = `${read.vendor} account` }
    else if (read.payment_type === 'card' && ctx.paymentCodes.includes('TEC')) {
      // Unknown card number: techs nearly always use their own TEC card. Saving teaches the app this number.
      const mine = ctx.cards.find(c => c.holder_profile_id === ctx.profile.id && c.payment_method_code === 'TEC')
      f.payment_method_code = 'TEC'
      why.payment_method_code = read.card_last4
        ? (mine ? `New card ${read.card_last4} — your TEC card on file ends ${mine.last4}` : `Card ${read.card_last4} not on file yet — saving as TEC links it to you`)
        : 'Paid by card — assumed your TEC card'
      if (mine && read.card_last4) warnings.push(`Card ending ${read.card_last4} isn't your TEC card on file (${mine.last4}).`)
    }
  }

  // Charge to: receipt refs → clocked-in job → today's daily update → fuel → last expense
  const jobBySite = new Map<string, ScanContext['openJobs'][number]>()
  for (const j of ctx.openJobs) {
    if (j.site_number) jobBySite.set(normSite(j.site_number), j)
    if (j.work_order_number) jobBySite.set(normSite(j.work_order_number), j)
  }
  const ref = read.job_refs.map(r => r.replace(/^(?:PO|JOB|STORE|SITE|WO)\s*[#:.-]?\s*/i, '')).find(r => /\d{3,}/.test(r))
  const refJob = ref ? jobBySite.get(normSite(ref)) : undefined

  if (refJob) {
    f.expense_type = 'project'; f.con_job_id = refJob.id; why.expense_type = why.con_job_id = `"${ref}" written on receipt`
  } else if (ref && /^(?:SU-?)?\d{3,6}[A-Z]?$/i.test(ref.trim())) {
    f.expense_type = 'store'; f.store_number = ref.trim().toUpperCase(); why.expense_type = why.store_number = `"${ref}" written on receipt`
  } else if (ctx.clocked?.con_job_id) {
    f.expense_type = 'project'; f.con_job_id = ctx.clocked.con_job_id
    why.expense_type = why.con_job_id = `You're clocked into ${ctx.clocked.site_number ?? 'this job'}`
  } else if (ctx.clocked?.store_number) {
    f.expense_type = 'store'; f.store_number = ctx.clocked.store_number
    why.expense_type = why.store_number = `You're clocked into ${ctx.clocked.store_number}`
  } else if (read.is_fuel && ctx.truck) {
    f.expense_type = 'asset'; f.asset_id = ctx.truck.id; why.expense_type = why.asset_id = `Fuel — your truck ${ctx.truck.unit_number}`
  } else if (ctx.todayJob) {
    f.expense_type = 'project'; f.con_job_id = ctx.todayJob.con_job_id
    why.expense_type = why.con_job_id = `On today's daily update for ${ctx.todayJob.site_number ?? 'this job'}`
  } else if (ctx.lastExpense && Date.now() - Date.parse(ctx.lastExpense.created_at) < 3 * 86_400_000) {
    const l = ctx.lastExpense
    f.expense_type = l.expense_type as Suggestion['expense_type']
    f.con_job_id = l.con_job_id; f.store_number = l.store_number; f.project_number = l.project_number; f.asset_id = l.asset_id
    why.expense_type = 'Same as your last receipt'
  }
  if (read.is_fuel && !f.asset_id && ctx.truck && f.expense_type !== 'asset') {
    // Fuel charged to a job still records which truck — leave asset for the person to pick.
  }

  // Category
  if (read.category) {
    const ctxName = f.expense_type === 'asset' ? 'asset' : 'store'
    const cat = ctx.categories.find(c => c.context === ctxName && c.name.toLowerCase() === read.category!.toLowerCase())
      ?? ctx.categories.find(c => c.name.toLowerCase() === read.category!.toLowerCase())
    if (f.expense_type === 'project') { f.category_custom = read.category; why.category_custom = 'Guessed from items' }
    else if (cat) { f.category_id = cat.id; why.category_id = 'Guessed from items' }
  }

  return { fields: f, why, cardholder, warnings, read }
}

// ── Card learning ────────────────────────────────────────────────────────────

/** Called after an expense is saved: remember which card number belongs to which code/person. */
export async function learnCardFromExpense(admin: Admin, opts: {
  company_id: string; last4: string | null; brand?: string | null; code: string | null; submitted_by: string
}) {
  const last4 = cleanLast4(opts.last4)
  const code = (opts.code ?? '').toUpperCase()
  if (!last4 || !code || ['CASH', 'CHK'].includes(code)) return
  const { data: row } = await admin.from('expense_cards').select('id, holder_profile_id, payment_method_code, seen_count, source')
    .eq('company_id', opts.company_id).eq('last4', last4).maybeSingle()
  const now = new Date().toISOString()
  if (!row) {
    await admin.from('expense_cards').insert({
      company_id: opts.company_id, last4, brand: opts.brand ?? null, payment_method_code: code,
      holder_profile_id: code === 'TEC' ? opts.submitted_by : null, source: 'learned', seen_count: 1, last_seen_at: now,
    })
    return
  }
  const patch: Record<string, unknown> = { seen_count: (row.seen_count ?? 0) + 1, last_seen_at: now, updated_at: now }
  // Fill gaps only — never overwrite a manual entry or an existing holder.
  if (!row.holder_profile_id && code === 'TEC' && row.source !== 'manual') patch.holder_profile_id = opts.submitted_by
  await admin.from('expense_cards').update(patch).eq('id', row.id)
}

// ── Backfill from receipts already emailed in with "TEC" ─────────────────────

const CARD_TOOL: Anthropic.Tool = {
  name: 'record_card',
  description: 'Record the payment card shown on this receipt.',
  input_schema: {
    type: 'object',
    properties: {
      card_last4: { type: ['string', 'null'], description: 'Last 4 digits of the card used, only if clearly printed.' },
      card_brand: { type: ['string', 'null'] },
      cardholder_name: { type: ['string', 'null'], description: 'Cardholder name if printed.' },
    },
    required: ['card_last4'],
  },
}

type InboxDoc = { id: string; subject: string | null; sender_email: string | null; extracted: Record<string, unknown> | null; attachments: { name: string; mime: string; path: string }[] | null }

const CARD_IN_TEXT = /(?:ending(?:\s+in)?|x{3,}|\*{2,}|#{3,}|last\s*4[^0-9]{0,6}|acct[^0-9]{0,8})\s*[:#]?\s*(\d{4})\b/i

/** Read the card number for one inbox receipt (cached into extracted.card so it's read once). */
async function cardForDoc(admin: Admin, doc: InboxDoc, allowRead: boolean): Promise<{ last4: string | null; brand: string | null; name: string | null; read: boolean }> {
  const cached = (doc.extracted?.card ?? null) as { last4: string | null; brand: string | null; name: string | null } | null
  if (cached) return { ...cached, read: false }
  const fromText = (JSON.stringify(doc.extracted ?? {}).match(CARD_IN_TEXT) ?? [])[1] ?? null
  if (fromText || !allowRead) {
    if (fromText) await admin.from('billing_inbox_documents').update({ extracted: { ...(doc.extracted ?? {}), card: { last4: fromText, brand: null, name: null } } }).eq('id', doc.id)
    return { last4: fromText, brand: null, name: null, read: false }
  }
  const images: Anthropic.ContentBlockParam[] = []
  for (const a of (doc.attachments ?? []).slice(0, 3)) {
    const media = mediaFor(a.name, a.mime)
    if (!media) continue
    const { data } = await admin.storage.from(INBOX_BUCKET).download(a.path)
    if (!data) continue
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.length > 4.5 * 1024 * 1024) continue
    images.push({ type: 'image', source: { type: 'base64', media_type: sniff(buf, media), data: buf.toString('base64') } })
  }
  let card = { last4: null as string | null, brand: null as string | null, name: null as string | null }
  if (images.length) {
    try {
      const r = await callTool([...images, { type: 'text', text: 'What card paid for this? Record it with record_card.' }], CARD_TOOL, 300)
      card = { last4: cleanLast4(r.card_last4), brand: s(r.card_brand)?.toUpperCase() ?? null, name: s(r.cardholder_name) }
    } catch { return { last4: null, brand: null, name: null, read: true } }
  }
  await admin.from('billing_inbox_documents').update({ extracted: { ...(doc.extracted ?? {}), card } }).eq('id', doc.id)
  return { ...card, read: true }
}

export type BackfillResult = { receipts: number; read: number; remaining: number; cards: { last4: string; holder: string | null; count: number; note: string | null }[] }

/**
 * Look at every TEC receipt emailed to the Construction Receipts inbox, find the card's last 4,
 * and work out whose card each number is: the person who sends most of that number's receipts.
 * Reads at most `maxReads` new photos per call (each ~5 s) — call again until remaining = 0.
 */
export async function backfillCardsFromInbox(admin: Admin, company_id: string, maxReads = 20): Promise<BackfillResult> {
  const { data: docs } = await admin.from('billing_inbox_documents')
    .select('id, subject, sender_email, extracted, attachments')
    .eq('company_id', company_id).eq('inbox', 'constructionreceipts').ilike('subject', '%tec%')
    .order('received_at', { ascending: false }).limit(2000)
  const tec = ((docs ?? []) as InboxDoc[]).filter(d => { const p = parseCardSubject(d.subject, ['TEC']); return !p.isReply && p.code === 'TEC' })

  const { data: people } = await admin.from('profiles').select('id, full_name, email').eq('company_id', company_id)
  const byEmail = new Map((people ?? []).filter(p => p.email).map(p => [String(p.email).toLowerCase(), p]))

  let reads = 0, remaining = 0
  const tally = new Map<string, { brand: string | null; senders: Map<string, number>; names: Map<string, number> }>()
  const queue = [...tec]
  const work = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      const allow = reads < maxReads
      const needsRead = !(d.extracted?.card) && !CARD_IN_TEXT.test(JSON.stringify(d.extracted ?? {}))
      if (needsRead && allow) reads++
      const c = await cardForDoc(admin, d, allow)
      if (needsRead && !allow) { remaining++; continue }
      if (!c.last4) continue
      const t = tally.get(c.last4) ?? { brand: c.brand, senders: new Map(), names: new Map() }
      const who = (d.sender_email ?? '').toLowerCase()
      t.senders.set(who, (t.senders.get(who) ?? 0) + 1)
      if (c.name) t.names.set(c.name, (t.names.get(c.name) ?? 0) + 1)
      t.brand ??= c.brand
      tally.set(c.last4, t)
    }
  }
  await Promise.all(Array.from({ length: 5 }, work))

  const { data: existing } = await admin.from('expense_cards').select('id, last4, source').eq('company_id', company_id)
  const ex = new Map((existing ?? []).map(e => [e.last4 as string, e]))
  const out: BackfillResult['cards'] = []
  for (const [last4, t] of tally) {
    const ranked = [...t.senders.entries()].sort((a, b) => b[1] - a[1])
    const total = ranked.reduce((x, [, c]) => x + c, 0)
    let [topEmail, topCount] = ranked[0]
    // A cardholder name printed on the receipts beats "who sent it most" (crews share hotel bills etc.).
    const printedTop = [...t.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (printedTop) {
      // Every word of the printed name (ignoring initials) must be in the person's name, and only one person may match.
      const words = printedTop.trim().split(/[\s/,.]+/).filter(w => w.length > 1).map(w => w.toLowerCase())
      let cands = (people ?? []).filter(p => p.email && words.length >= 2 &&
        words.every(w => String(p.full_name ?? '').toLowerCase().split(/[\s"()-]+/).includes(w)))
      if (cands.length > 1) cands = cands.filter(p => t.senders.has(String(p.email).toLowerCase()))
      if (cands.length === 1) { topEmail = String(cands[0].email).toLowerCase(); topCount = Math.max(topCount, total) }
    }
    const top = byEmail.get(topEmail)
    const others = ranked.slice(1).map(([e, c]) => `${byEmail.get(e)?.full_name ?? e} ×${c}`)
    const printed = [...t.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const note = [others.length ? `Also on receipts from ${others.join(', ')}` : null, printed ? `Name printed on receipt: ${printed}` : null].filter(Boolean).join('. ') || null
    out.push({ last4, holder: top?.full_name ?? topEmail, count: total, note })
    const row = ex.get(last4)
    if (row?.source === 'manual') continue   // a person set this one — leave it
    const fields = {
      brand: t.brand, payment_method_code: 'TEC', holder_profile_id: top?.id ?? null,
      holder_label: top ? null : topEmail, source: 'backfill', seen_count: total, conflict_note: note,
      last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }
    // Ambiguous (no clear majority) → keep the number but leave the holder blank for a person to set.
    if (total >= 2 && topCount / total < 0.7) { fields.holder_profile_id = null; fields.holder_label = null }
    out[out.length - 1].holder = fields.holder_profile_id || fields.holder_label ? out[out.length - 1].holder : null
    if (row) await admin.from('expense_cards').update(fields).eq('id', row.id)
    else await admin.from('expense_cards').insert({ company_id, last4, ...fields })
  }
  out.sort((a, b) => b.count - a.count)
  return { receipts: tec.length, read: reads, remaining, cards: out }
}
