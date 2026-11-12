'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyQuoteLinePrice } from '@/lib/quote-line-price'
import { buildOrderDraft, type OrderVendorKey } from '@/lib/order-email'

const KINDS = new Set(['quote', 'price', 'order', 'bid', 'survey', 'followup', 'admin'])

async function me() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id, company_id').eq('id', user.id).single()
  if (!profile) throw new Error('No profile')
  return { admin, id: profile.id as string, company_id: profile.company_id as string }
}

function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) }
function str(v: FormDataEntryValue | null) { const s = (v as string | null)?.trim(); return s || null }

/** Only my own row can change. */
async function mine(admin: ReturnType<typeof createAdminClient>, id: string, owner: string) {
  const { data } = await admin.from('con_tasks').select('id').eq('id', id).eq('owner_id', owner).maybeSingle()
  if (!data) throw new Error('Not your task')
}

export async function addTask(formData: FormData): Promise<void> {
  const { admin, id, company_id } = await me()
  const title = str(formData.get('title'))
  if (!title) return
  const kind = str(formData.get('kind')) ?? 'followup'
  const priority = Number(formData.get('priority') ?? 2)
  const source_key = str(formData.get('source_key'))
  let action: Record<string, unknown> | null = null
  try { const raw = str(formData.get('action')); action = raw ? JSON.parse(raw) : null } catch { action = null }
  const row = {
    company_id, owner_id: id, title, detail: str(formData.get('detail')), kind: KINDS.has(kind) ? kind : 'followup',
    site_number: str(formData.get('site_number')), due_date: str(formData.get('due_date')),
    priority: [1, 2, 3].includes(priority) ? priority : 2, source: source_key ? 'signal' : 'manual', source_key, action,
    quote_id: (action?.quote_id as string | undefined) ?? null, job_id: (action?.job_id as string | undefined) ?? null,
  }
  const q = source_key
    ? admin.from('con_tasks').upsert(row, { onConflict: 'company_id,owner_id,source_key' })
    : admin.from('con_tasks').insert(row)
  const { error } = await q
  if (error) throw new Error(error.message)
  revalidatePath('/my')
}

export async function completeTask(id: string): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  await admin.from('con_tasks').update({ status: 'done', done_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

/** Bulk check-off: every ticked row (checkbox name "ids") that belongs to the signed-in user goes to done. */
export async function completeTasks(formData: FormData): Promise<void> {
  const { admin, id: owner } = await me()
  const ids = formData.getAll('ids').map(String).filter(Boolean)
  if (!ids.length) return
  const now = new Date().toISOString()
  await admin.from('con_tasks').update({ status: 'done', done_at: now, updated_at: now }).in('id', ids).eq('owner_id', owner)
  revalidatePath('/my')
}

export async function reopenTask(id: string): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  // Reopening takes the answer back too (a wrong tap on Yes / No must not reach the morning job routine).
  const { data: row } = await admin.from('con_tasks').select('detail, answer').eq('id', id).single()
  const undo = row?.answer
    ? { answer: null, answered_at: null, detail: (row.detail ?? '').split('\n').filter((l: string, i: number, all: string[]) => !(i === all.length - 1 && /^Answer \(\d{4}-\d{2}-\d{2}\): /.test(l))).join('\n') || null }
    : {}
  await admin.from('con_tasks').update({ ...undo, status: 'open', done_at: null, waiting_on: null, waiting_since: null, snoozed_until: null, updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function dropTask(id: string): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  await admin.from('con_tasks').update({ status: 'dropped', updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

/** Hand it to someone: the row moves to "Waiting on" with their name and today's date. */
export async function waitTask(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  const who = str(formData.get('who'))
  if (!who) return
  await admin.from('con_tasks').update({ status: 'waiting', waiting_on: who, waiting_since: today(), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function snoozeTask(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  const days = Number(formData.get('days') ?? 1)
  const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + (days > 0 ? days : 1))
  await admin.from('con_tasks').update({ snoozed_until: d.toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function setPriority(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  const p = Number(formData.get('priority'))
  if (![1, 2, 3].includes(p)) return
  await admin.from('con_tasks').update({ priority: p, updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

export async function setDue(id: string, formData: FormData): Promise<void> {
  const { admin, id: owner } = await me(); await mine(admin, id, owner)
  await admin.from('con_tasks').update({ due_date: str(formData.get('due_date')), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

// ── resolvers: handle the need from the row itself ───────────────────────────

async function myTask(id: string) {
  const { admin, id: owner, company_id } = await me()
  const { data } = await admin.from('con_tasks').select('*').eq('id', id).eq('owner_id', owner).maybeSingle()
  if (!data) throw new Error('Not your task')
  return { admin, owner, company_id, task: data as { id: string; title: string; detail: string | null; action: Record<string, unknown> | null; quote_id: string | null; job_id: string | null; site_number: string | null } }
}

/** Type the answer, close the row. The answer stays on the row and in the detail. */
export async function answerTask(id: string, formData: FormData): Promise<void> {
  const { admin, task } = await myTask(id)
  const answer = str(formData.get('answer'))
  if (!answer) return
  await admin.from('con_tasks').update({ answer, answered_at: new Date().toISOString(), status: 'done', done_at: new Date().toISOString(), detail: [task.detail, `Answer (${today()}): ${answer}`].filter(Boolean).join('\n'), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

/** Price a quote line from the row: writes the line, re-runs the REV19 math, optionally saves the rate to the catalog, closes the task. */
export async function resolvePriceLine(id: string, formData: FormData): Promise<void> {
  const { admin, company_id, task } = await myTask(id)
  const a = (task.action ?? {}) as { type?: string; quote_id?: string; line_id?: string }
  if (a.type !== 'quote_line_price' || !a.quote_id || !a.line_id) throw new Error('This row has no quote line to price')
  const unitCost = Number(String(formData.get('unit_cost') ?? '').replace(/[$,]/g, ''))
  if (!isFinite(unitCost) || unitCost <= 0) return
  const unit = str(formData.get('unit')) ?? 'each'
  const who = str(formData.get('who')) ?? 'Trae'
  const note = `${who} ${today()}: $${unitCost.toFixed(2)} per ${unit}${str(formData.get('note')) ? ` · ${str(formData.get('note'))}` : ''}`
  const addToCatalog = formData.get('add_to_catalog') === 'on'
  const partNumber = str(formData.get('part_number'))
  const catalogDesc = str(formData.get('catalog_description'))
  const category = Number(formData.get('category') ?? 9)
  const r = await applyQuoteLinePrice(admin, {
    companyId: company_id, quoteId: a.quote_id, lineId: a.line_id, unitCost, note,
    catalog: addToCatalog && partNumber ? { partNumber: partNumber.toUpperCase(), description: (catalogDesc ?? partNumber).toUpperCase(), category: [5, 9, 10, 11, 12].includes(category) ? category : 9, subcategory: `EQUIPMENT - PER ${unit.toUpperCase()}`, uom: 'EA', itemType: category === 10 ? 'disposables' : 'equipment' } : null,
  })
  const answer = `$${unitCost.toFixed(2)} per ${unit}${addToCatalog && partNumber ? ` · saved to catalog as ${partNumber.toUpperCase()}` : ''} · quote now $${r.final_total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  await admin.from('con_tasks').update({ answer, answered_at: new Date().toISOString(), status: 'done', done_at: new Date().toISOString(), detail: [task.detail, `Answer (${today()}): ${answer}`].filter(Boolean).join('\n'), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my'); revalidatePath(`/billing/quotes/${a.quote_id}`)
}

/** Build the order email in Trae's voice and keep it on the row (he sends it; the app never sends mail). */
export async function draftOrderEmail(id: string, formData: FormData): Promise<void> {
  const { admin, task } = await myTask(id)
  const a = (task.action ?? {}) as Record<string, unknown>
  const vendor = (str(formData.get('vendor')) ?? (a.vendor as string) ?? 'icon') as OrderVendorKey
  const draft = buildOrderDraft({
    vendor, to: str(formData.get('to')), site: str(formData.get('site')) ?? task.site_number ?? '', siteName: str(formData.get('site_name')), address: str(formData.get('address')),
    workOrder: str(formData.get('work_order')), takeoff: str(formData.get('takeoff')), items: str(formData.get('items')) ?? '', note: str(formData.get('note')), askPo: formData.get('ask_po') !== 'off',
  })
  const action = { ...a, type: 'order_email', vendor, draft, draft_status: 'drafted', drafted_at: new Date().toISOString(), site_name: str(formData.get('site_name')), address: str(formData.get('address')), work_order: str(formData.get('work_order')), takeoff: str(formData.get('takeoff')), items: str(formData.get('items')) }
  await admin.from('con_tasks').update({ action, updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}

/** He sent it: the row waits on Shannon's PO# first (no vendor ships without one), then on the vendor. */
export async function markOrderSent(id: string, formData: FormData): Promise<void> {
  const { admin, task } = await myTask(id)
  const a = (task.action ?? {}) as Record<string, unknown>
  const who = str(formData.get('who')) ?? 'Shannon (PO#)'
  await admin.from('con_tasks').update({ action: { ...a, draft_status: 'sent', sent_at: new Date().toISOString() }, status: 'waiting', waiting_on: who, waiting_since: today(), updated_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/my')
}
