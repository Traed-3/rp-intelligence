/**
 * Service-call status reconciliation.
 *
 * Open calls pile up because the evidence that a call is finished lives in four places and
 * the sync only ever acted on one of them, one message at a time, in arrival order:
 *
 *   1. A tech's COMPLETE / RTN / INCOMPLETE note in rpinvoicing. If it landed before the
 *      call existed in the app it was logged `no_match` and never looked at again.
 *   2. 7-Eleven's "Invoice Approved" notice in rpdispatcher — the customer signed off on the
 *      invoice, so the job is done and billed. Used to be treated as a brand-new dispatch.
 *   3. "Redirected to another Service Provider" / Wawa "is Terminated" — the call left our hands.
 *   4. The construction job the call was handed to: once it is in close-out / invoicing /
 *      complete, the work is finished no matter what the service side still says.
 *
 * This replays all of it per open call in TIME order — the latest event decides — so a later
 * return trip still reopens a call and an old note never overrides a newer one. DB-only apart
 * from best-effort Gmail archiving of the dispatch email once a call is done (the standing
 * rule: completed ⇒ archive it out of rpdispatcher).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { archiveThread, archiveMessage } from '@/lib/svc-gmail-client'
import { isTrustedPortalNotice, isOfficeSender, isTicketSender, ticketOutcome, techWords } from '@/lib/svc-work-order-parser'
import { loadConstructionLinks, CON_DONE_STAGES, CON_ACTIVE_STAGES, CON_STAGE_LABEL } from '@/lib/svc-construction-link'

type Admin = ReturnType<typeof createAdminClient>
const COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
const BUDGET_MS = 40_000

type EventKind = 'complete' | 'approved' | 'rtn' | 'incomplete' | 'closed' | 'construction_done' | 'construction_active'
type Evidence = { at: string; kind: EventKind; source: string; note?: string | null; importId?: string; msgId?: string; invoiceNumber?: string | null; closedAs?: string; decisive?: boolean }

export interface ReconcileChange { woNumber: string; from: string; to: string; source: string; at: string }
export interface ReconcileResult {
  dryRun: boolean
  openCalls: number
  changed: number
  toCompleted: number
  toRtn: number
  toInProgress: number
  archivedClosed: number
  importsAttached: number
  emailsArchived: number
  /** Billing replay (all calls, not just open ones): approvals and rejections from rpdispatcher, latest one wins. */
  invoicedSet: number
  rejectionsSet: number
  rejectionsCleared: number
  /** Calls with tickets on file but no technician: filled from the latest roster tech who sent one. */
  techsAssigned: number
  budgetHit: boolean
  errors: string[]
  changes: ReconcileChange[]
}

const INV_RE = /\bINV\d+\b/

function targetFor(kind: EventKind): 'completed' | 'rtn_needed' | 'in_progress' | 'closed' {
  switch (kind) {
    case 'complete': case 'approved': case 'construction_done': return 'completed'
    case 'rtn': return 'rtn_needed'
    case 'incomplete': case 'construction_active': return 'in_progress'
    case 'closed': return 'closed'
  }
}

export async function reconcileWorkOrders(opts: { dryRun?: boolean; archivedBy?: string | null; onlyWo?: string; archive?: boolean } = {}): Promise<ReconcileResult> {
  const dryRun = opts.dryRun ?? true
  const archive = opts.archive !== false
  const admin: Admin = createAdminClient()
  const deadline = Date.now() + BUDGET_MS
  const result: ReconcileResult = {
    dryRun, openCalls: 0, changed: 0, toCompleted: 0, toRtn: 0, toInProgress: 0, archivedClosed: 0,
    importsAttached: 0, emailsArchived: 0, invoicedSet: 0, rejectionsSet: 0, rejectionsCleared: 0, techsAssigned: 0,
    budgetHit: false, errors: [], changes: [],
  }
  try {
    await replayStatuses(admin, opts, dryRun, archive, deadline, result)
    await replayBilling(admin, opts.onlyWo, dryRun, result)
    await fillTechnicians(admin, opts.onlyWo, dryRun, result)
  } catch (e: any) {
    result.errors.push(e.message)
  }
  result.changed = result.toCompleted + result.toRtn + result.toInProgress + result.archivedClosed
  return result
}

async function replayStatuses(
  admin: Admin,
  opts: { archivedBy?: string | null; onlyWo?: string },
  dryRun: boolean,
  archive: boolean,
  deadline: number,
  result: ReconcileResult,
): Promise<void> {

  const { data: open } = await admin
    .from('svc_work_orders')
    .select('id, portal_wo_number, status, notes, last_update_at, completed_at, dispatch_gmail_message_id, dispatch_gmail_thread_id, return_trip_needed')
    .eq('company_id', COMPANY_ID).eq('archived', false).neq('status', 'completed')
    .not('portal_wo_number', 'is', null)
  const calls = (open ?? []).filter(c => !opts.onlyWo || c.portal_wo_number === opts.onlyWo)
  result.openCalls = calls.length
  if (!calls.length) return

  const byWo = new Map<string, typeof calls[number]>()
  for (const c of calls) byWo.set(c.portal_wo_number!, c)
  const woList = Array.from(byWo.keys())
  const events = new Map<string, Evidence[]>()
  const push = (wo: string, e: Evidence) => { const l = events.get(wo) ?? []; l.push(e); events.set(wo, l) }

  // 1. Tickets in rpinvoicing — the standing rule (Trae, 2026-10-12): a ticket for the call that does not say
  //    RTN / return trip needed means the call is COMPLETE. The latest tech ticket decides; the office's own
  //    re-forwards (rpinvoicing@ → itself) only count when no tech ticket exists, and never override a tech's RTN.
  //    Stored notes are re-read with the current wording rules, so older mis-filed ones still count.
  const tickets = new Map<string, { tech: Evidence[]; office: Evidence[] }>()
  for (let i = 0; i < woList.length; i += 60) {
    const { data } = await admin
      .from('svc_gmail_imports')
      .select('id, gmail_message_id, received_at, sender, parsed')
      .eq('mailbox', 'rpinvoicing')
      .in('parsed->>woNumber', woList.slice(i, i + 60))
      .limit(2000)
    for (const r of data ?? []) {
      const p = r.parsed as any
      if (!p?.woNumber) continue
      const sender = r.sender ?? ''
      const office = isOfficeSender(sender)
      if (!office && !isTicketSender(sender)) continue   // vendors, customers, construction/admin addresses
      const own = techWords(p.note ?? '')
      const e: Evidence = { at: r.received_at, kind: office ? 'complete' : ticketOutcome(own), source: office ? 'office ticket in rpinvoicing' : 'tech ticket in rpinvoicing', note: own, importId: r.id, msgId: r.gmail_message_id }
      const t = tickets.get(p.woNumber) ?? { tech: [], office: [] }
      ;(office ? t.office : t.tech).push(e)
      tickets.set(p.woNumber, t)
    }
  }
  const linksEarly = await loadConstructionLinks(admin, COMPANY_ID)
  for (const [wo, t] of tickets) {
    // A construction job still under way is the authority: a routine ticket does not finish it. A return trip still applies.
    const link = linksEarly.get(wo)
    const jobOpen = !!link && !(CON_DONE_STAGES as readonly string[]).includes(link.stage)
    for (const e of (t.tech.length ? t.tech : t.office)) {
      if (jobOpen && e.kind === 'complete') continue
      push(wo, e)
    }
    // Keep the office forwards attachable to the call even when they do not decide anything.
    for (const e of t.office) if (!(t.tech.length ? t.tech : t.office).includes(e)) push(wo, { ...e, kind: 'incomplete', source: 'office re-forward', decisive: false })
  }

  // 2 + 3. Closure notices in rpdispatcher (older imports carry no flag for these, so match on the subject).
  const { data: notices } = await admin
    .from('svc_gmail_imports')
    .select('id, gmail_message_id, received_at, subject, sender, parsed')
    .eq('mailbox', 'rpdispatcher')
    .or('subject.ilike.%invoice approved%,subject.ilike.%has been redirected%,subject.ilike.%is terminated%')
  for (const n of notices ?? []) {
    const wo = (n.parsed as any)?.woNumber as string | undefined
    if (!wo || !byWo.has(wo)) continue
    if (!isTrustedPortalNotice(n.sender ?? '')) continue   // only the customer's ticketing system can close a call
    const subj = n.subject ?? ''
    if (/invoice approved/i.test(subj)) push(wo, { at: n.received_at, kind: 'approved', source: 'invoice approved by customer', msgId: n.gmail_message_id, invoiceNumber: subj.match(INV_RE)?.[0] ?? null })
    else if (/has been redirected/i.test(subj)) push(wo, { at: n.received_at, kind: 'closed', source: 'redirected to another service provider', msgId: n.gmail_message_id, closedAs: `Redirected to another service provider — "${subj.trim().slice(0, 140)}"` })
    else if (/is terminated/i.test(subj)) push(wo, { at: n.received_at, kind: 'closed', source: 'terminated by the customer', msgId: n.gmail_message_id, closedAs: `Terminated by the customer — "${subj.trim().slice(0, 140)}"` })
  }

  // 4. Construction.
  const links = linksEarly
  for (const wo of woList) {
    const link = links.get(wo)
    if (!link) continue
    const label = `construction job ${link.jobNumber ?? link.siteNumber ?? ''} (${CON_STAGE_LABEL[link.stage] ?? link.stage})`.replace('  ', ' ')
    if ((CON_DONE_STAGES as readonly string[]).includes(link.stage) && link.doneAt) push(wo, { at: link.doneAt, kind: 'construction_done', source: label })
    else if ((CON_ACTIVE_STAGES as readonly string[]).includes(link.stage) && link.updatedAt) push(wo, { at: link.updatedAt, kind: 'construction_active', source: label })
  }

  // Replay per call.
  for (const [wo, evs] of events) {
    if (Date.now() > deadline) { result.budgetHit = true; break }
    const call = byWo.get(wo)!
    evs.sort((a, b) => a.at.localeCompare(b.at))
    const deciding = evs.filter(e => e.decisive !== false)
    if (!deciding.length) { if (!dryRun) await attachImports(admin, call.id, evs, result); continue }
    let last = deciding[deciding.length - 1]
    let target = targetFor(last.kind)
    // The customer approving the invoice after a tech asked for a return trip does not prove the return
    // happened: keep the call on Return Trip (the billing replay below still marks it invoiced).
    if (last.kind === 'approved') {
      const lastTicket = [...deciding].reverse().find(e => e.kind === 'rtn' || e.kind === 'complete' || e.kind === 'incomplete')
      if (lastTicket?.kind === 'rtn') { last = lastTicket; target = 'rtn_needed' }
    }

    // 'construction_active' only ever promotes a call nobody has touched; it must not downgrade real progress.
    if (last.kind === 'construction_active' && call.status !== 'dispatched') continue
    const currentTarget = call.status
    if (target !== 'closed' && target === currentTarget) {
      // Status already right — but still attach any orphaned tech notes so they stop showing as "no match".
      if (!dryRun) await attachImports(admin, call.id, evs, result)
      continue
    }

    result.changes.push({ woNumber: wo, from: call.status, to: target === 'closed' ? 'archived' : target, source: last.source, at: last.at })
    if (dryRun) { tally(result, target); continue }

    try {
      const stamp = `[auto ${new Date().toISOString().slice(0, 10)}] ${target === 'closed' ? 'Closed' : 'Status → ' + target} — ${last.source}.`
      const notes = [call.notes, stamp].filter(Boolean).join('\n')
      const lastUpdate = [call.last_update_at, last.at].filter(Boolean).sort().pop()!

      if (target === 'closed') {
        await admin.from('svc_work_orders').update({
          archived: true, archived_at: new Date().toISOString(), archived_reason: `${last.closedAs} (${last.at.slice(0, 10)}).`,
          archived_by: opts.archivedBy ?? null, last_update_at: lastUpdate, notes,
        }).eq('id', call.id).eq('archived', false)
        if (archive) await archiveDispatchEmail(call, last.msgId, result)
      } else {
        const updates: Record<string, unknown> = { status: target, last_update_at: lastUpdate, notes }
        if (target === 'completed') {
          updates.completed_at = last.at
          updates.return_trip_needed = false
          if (last.kind === 'approved') { updates.invoiced = true; if (last.invoiceNumber) updates.invoice_number = last.invoiceNumber }
          if (last.kind === 'complete') { updates.completion_note_raw = last.note ?? null; updates.completion_gmail_message_id = last.msgId }
        } else if (target === 'rtn_needed') {
          updates.return_trip_needed = true
          updates.return_trip_reason = last.note ?? null
          updates.completion_note_raw = last.note ?? null
          updates.completion_gmail_message_id = last.msgId
        } else if (target === 'in_progress' && last.kind === 'incomplete') {
          updates.completion_note_raw = last.note ?? null
          updates.completion_gmail_message_id = last.msgId
        }
        await admin.from('svc_work_orders').update(updates).eq('id', call.id)
        if (target === 'completed' && archive) await archiveDispatchEmail(call, last.kind === 'approved' ? last.msgId : undefined, result)
      }
      await attachImports(admin, call.id, evs, result)
      tally(result, target)
    } catch (e: any) {
      result.errors.push(`${wo}: ${e.message}`)
    }
  }
}

/** Every rpdispatcher approval / rejection notice on file, oldest first (paged — there are more than 1,000). */
async function billingNotices(admin: Admin, onlyWo?: string) {
  const rows: { received_at: string; subject: string | null; sender: string | null; parsed: any }[] = []
  for (let from = 0; ; from += 1000) {
    let q = admin
      .from('svc_gmail_imports')
      .select('received_at, subject, sender, parsed')
      .eq('mailbox', 'rpdispatcher')
      .or('subject.ilike.%invoice approved%,parsed->>isInvoiceRejection.eq.true')
      .order('received_at', { ascending: true })
      .range(from, from + 999)
    if (onlyWo) q = q.eq('parsed->>woNumber', onlyWo)
    const { data, error } = await q
    if (error) throw new Error(`billing notices: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  return rows
}

/**
 * Invoice state from the customer's own notices, for every call (completed ones included — that is where
 * the 237 missed approvals were, audit 2026-11-05). The latest notice decides: an approval marks the call
 * invoiced and clears an earlier rejection; a rejection after the last approval flags it.
 */
async function replayBilling(admin: Admin, onlyWo: string | undefined, dryRun: boolean, r: ReconcileResult) {
  const latest = new Map<string, { kind: 'approved' | 'rejected'; invoiceNumber: string | null; reason: string | null }>()
  const approvedEver = new Map<string, string | null>()
  for (const n of await billingNotices(admin, onlyWo)) {
    const p = n.parsed ?? {}
    const wo = p.woNumber as string | undefined
    if (!wo || !isTrustedPortalNotice(n.sender ?? '')) continue
    const approved = /invoice approved/i.test(n.subject ?? '')
    const invoiceNumber = (p.invoiceNumber as string | undefined) ?? (n.subject ?? '').match(INV_RE)?.[0] ?? null
    if (approved) approvedEver.set(wo, invoiceNumber ?? approvedEver.get(wo) ?? null)
    latest.set(wo, approved
      ? { kind: 'approved', invoiceNumber, reason: null }
      : { kind: 'rejected', invoiceNumber, reason: (p.invoiceRejectionReason as string | undefined) ?? null })
  }
  const wos = Array.from(latest.keys())
  for (let i = 0; i < wos.length; i += 100) {
    const { data } = await admin
      .from('svc_work_orders')
      .select('id, portal_wo_number, invoiced, invoice_number, invoice_rejected, invoice_rejection_reason')
      .eq('company_id', COMPANY_ID)
      .in('portal_wo_number', wos.slice(i, i + 100))
    for (const w of data ?? []) {
      const ev = latest.get(w.portal_wo_number!)!
      const patch: Record<string, unknown> = {}
      if (ev.kind === 'approved') {
        if (!w.invoiced) { patch.invoiced = true; r.invoicedSet++ }
        if (ev.invoiceNumber && w.invoice_number !== ev.invoiceNumber) patch.invoice_number = ev.invoiceNumber
        if (w.invoice_rejected) { patch.invoice_rejected = false; patch.invoice_rejection_reason = null; r.rejectionsCleared++ }
      } else {
        if (!w.invoice_rejected) { patch.invoice_rejected = true; r.rejectionsSet++ }
        if (ev.reason && w.invoice_rejection_reason !== ev.reason) patch.invoice_rejection_reason = ev.reason
        // An earlier approval still stands for the work it covered.
        if (!w.invoiced && approvedEver.has(w.portal_wo_number!)) { patch.invoiced = true; r.invoicedSet++ }
      }
      if (dryRun || !Object.keys(patch).length) continue
      const { error } = await admin.from('svc_work_orders').update(patch).eq('id', w.id)
      if (error) r.errors.push(`billing ${w.portal_wo_number}: ${error.message}`)
    }
  }
}

/**
 * A call with tickets on file but no technician (the ticket arrived before the call existed, or the sender
 * was not on the roster yet): credit the latest service tech who sent one, else the latest roster sender.
 */
async function fillTechnicians(admin: Admin, onlyWo: string | undefined, dryRun: boolean, r: ReconcileResult) {
  let q = admin.from('svc_work_orders').select('id, portal_wo_number')
    .eq('company_id', COMPANY_ID).eq('archived', false).is('assigned_technician_id', null).not('portal_wo_number', 'is', null)
  if (onlyWo) q = q.eq('portal_wo_number', onlyWo)
  const { data: calls } = await q.limit(5000)
  if (!calls?.length) return
  const { data: techs } = await admin.from('svc_technicians').select('id, role, personal_email').eq('is_active', true)
  const byEmail = new Map((techs ?? []).filter(t => t.personal_email).map(t => [t.personal_email!.toLowerCase(), t]))
  const woToCall = new Map(calls.map(c => [c.portal_wo_number!, c.id]))
  const wos = Array.from(woToCall.keys())
  const pick = new Map<string, { at: string; id: string; tech: boolean }>()
  for (let i = 0; i < wos.length; i += 60) {
    const { data } = await admin
      .from('svc_gmail_imports')
      .select('received_at, sender, parsed')
      .eq('mailbox', 'rpinvoicing')
      .in('parsed->>woNumber', wos.slice(i, i + 60))
      .limit(2000)
    for (const t of data ?? []) {
      const wo = (t.parsed as any)?.woNumber as string | undefined
      const tech = byEmail.get((t.sender ?? '').toLowerCase())
      if (!wo || !tech || !isTicketSender(t.sender ?? '')) continue
      const cand = { at: t.received_at, id: tech.id, tech: tech.role === 'service_tech' }
      const cur = pick.get(wo)
      // A service tech's ticket beats a manager's forward; otherwise the latest one wins.
      if (!cur || (cand.tech && !cur.tech) || (cand.tech === cur.tech && cand.at > cur.at)) pick.set(wo, cand)
    }
  }
  for (const [wo, p] of pick) {
    r.techsAssigned++
    if (dryRun) continue
    const { error } = await admin.from('svc_work_orders').update({ assigned_technician_id: p.id }).eq('id', woToCall.get(wo)!).is('assigned_technician_id', null)
    if (error) r.errors.push(`tech ${wo}: ${error.message}`)
  }
}

function tally(r: ReconcileResult, target: string) {
  if (target === 'completed') r.toCompleted++
  else if (target === 'rtn_needed') r.toRtn++
  else if (target === 'in_progress') r.toInProgress++
  else if (target === 'closed') r.archivedClosed++
}

/** Point tech notes that were logged `no_match` at the call they belong to. */
async function attachImports(admin: Admin, workOrderId: string, evs: Evidence[], r: ReconcileResult) {
  const ids = evs.filter(e => e.importId).map(e => e.importId!)
  if (!ids.length) return
  const { data } = await admin.from('svc_gmail_imports').update({ status: 'matched', matched_work_order_id: workOrderId }).in('id', ids).eq('status', 'no_match').select('id')
  r.importsAttached += data?.length ?? 0
}

/**
 * Completed / closed ⇒ clear the dispatch email out of rpdispatcher (the standing rule), plus the
 * rpdispatcher notice that closed it, if it was one. Best-effort — a Gmail hiccup never blocks the status.
 */
async function archiveDispatchEmail(
  call: { dispatch_gmail_thread_id: string | null; dispatch_gmail_message_id: string | null },
  noticeMsgId: string | undefined,
  r: ReconcileResult,
) {
  try {
    if (call.dispatch_gmail_thread_id) await archiveThread('dispatcher', call.dispatch_gmail_thread_id)
    else if (call.dispatch_gmail_message_id) await archiveMessage('dispatcher', call.dispatch_gmail_message_id)
    if (noticeMsgId) await archiveMessage('dispatcher', noticeMsgId)
    r.emailsArchived++
  } catch (e: any) { r.errors.push(`archive dispatch email: ${e.message}`) }
}
