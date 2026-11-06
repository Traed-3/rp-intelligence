/**
 * Parsing for the service-dispatch mailboxes (rpdispatcher / rpinvoicing).
 *
 * Three portals land in rpdispatcher, each with a distinct sender name and
 * a distinct structured body:
 *   - "7HELP Service Desk"  (7-Eleven)  — WOT######## / INC########
 *   - "WTSC"                (Wawa)      — FWKD########
 *   - "IT Service Desk"     (Sunoco)    — WOT######## (no incident number)
 *
 * rpinvoicing gets a *forward* of the original dispatch email from a field
 * tech's personal @rp.gmail address, with one line of their own text on top
 * ("COMPLETE", "INCOMPLETE RTN WITH MAG SENSOR", etc.) before the quoted
 * original message.
 */

import { stripHtml, getHeader, parseSender } from '@/lib/gmail-parser'

// ── Shared ────────────────────────────────────────────────────────────────────

const WO_NUMBER = /\b(WOT\d+|FWKD\d+)\b/

export function extractWorkOrderNumber(text: string): string | null {
  return text.match(WO_NUMBER)?.[1] ?? null
}

export function extractIncidentNumber(text: string): string | null {
  return text.match(/\bINC\d+\b/)?.[0] ?? null
}

function decode(b64?: string): string {
  if (!b64) return ''
  try { return Buffer.from(b64, 'base64url').toString('utf-8') } catch { return '' }
}

function findPart(payload: any, mime: string): string {
  if (!payload) return ''
  if (payload.mimeType === mime && payload.body?.data) return decode(payload.body.data)
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mime)
    if (found.trim()) return found
  }
  return ''
}

/** Same body-extraction logic as the fleet parser (text/plain preferred, HTML stripped as fallback). */
export function extractBody(payload: any): string {
  if (!payload) return ''
  const plain = payload.mimeType === 'text/plain' && payload.body?.data
    ? decode(payload.body.data) : findPart(payload, 'text/plain')
  if (plain.trim()) return stripHtml(plain)
  const html = payload.mimeType === 'text/html' && payload.body?.data
    ? decode(payload.body.data) : findPart(payload, 'text/html')
  if (html.trim()) return stripHtml(html)
  return stripHtml(decode(payload.body?.data))
}

export { getHeader, parseSender }

// ── Dispatch email parsing (rpdispatcher) ───────────────────────────────────

export type SourcePortal = '7help' | 'wtsc' | 'it_service_desk' | 'unknown'

export interface ParsedDispatch {
  sourcePortal:    SourcePortal
  clientName:      string | null
  woNumber:        string | null
  incidentNumber:  string | null
  siteNumber:      string | null
  siteName:        string | null
  siteAddress:     string | null
  siteCity:        string | null
  siteState:       string | null
  priorityRaw:     string | null
  priorityRank:    number | null   // 1 (most urgent) .. 5
  isInvoiceRejection: boolean
  invoiceRejectionReason: string | null
  isAssignmentOnly: boolean        // "has been assigned" / "mentioned" / "priority changed" — no new detail to extract
  isCancellation: boolean          // the portal cancelled the call — close it, never open one
  isRedirected: boolean            // 7-Eleven moved the call to another service provider — it is no longer ours
  isTerminated: boolean            // Wawa "FWKD… is Terminated" — the call is dead
  isInvoiceApproved: boolean       // the customer approved our invoice — the job is done and billed
  invoiceNumber: string | null     // INV###### from an invoice notice
}

/**
 * Closure notices (invoice approved / rejected, cancelled / redirected / terminated) change a call, so they only
 * count when they genuinely come from the customer's ticketing system: a service-now.com sender (7-Eleven, Wawa)
 * or energytransfer.com (Sunoco's invoice portal), and — when
 * Gmail recorded an Authentication-Results line — SPF or DKIM actually passed. A display name or subject
 * line alone is trivially forged by anyone who can email the inbox.
 */
export function isTrustedPortalNotice(senderEmail: string, authenticationResults?: string | null): boolean {
  if (!/@(?:service-now|energytransfer)\.com$/i.test(senderEmail.trim())) return false
  if (authenticationResults && !/\b(?:dkim|spf)=pass\b/i.test(authenticationResults)) return false
  return true
}

function detectPortal(senderName: string, subject: string): SourcePortal {
  const n = senderName.toLowerCase()
  if (n.includes('7help')) return '7help'
  if (n.includes('wtsc')) return 'wtsc'
  if (n.includes('it service desk')) return 'it_service_desk'
  // Fallback by subject shape
  if (/FWKD\d+/.test(subject)) return 'wtsc'
  if (/7-eleven/i.test(subject)) return '7help'
  if (/work order task/i.test(subject)) return 'it_service_desk'
  return 'unknown'
}

function normalizePriority(portal: SourcePortal, raw: string | null): number | null {
  if (!raw) return null
  const m = raw.match(/P(\d)/i) || raw.match(/Priority\s*:?\s*(\d)/i)
  if (m) return parseInt(m[1], 10)
  return null
}

export function parseDispatchEmail(subject: string, body: string, senderName: string): ParsedDispatch {
  const portal = detectPortal(senderName, subject)
  const woNumber = extractWorkOrderNumber(subject) ?? extractWorkOrderNumber(body)
  const incidentNumber = extractIncidentNumber(subject) ?? extractIncidentNumber(body)

  // "… / INV05306531 Invoice Approved" — 7-Eleven signing off on our invoice. Checked first so a
  // body that happens to mention "rejected" never turns an approval into a rejection.
  const isInvoiceApproved = /invoice approved/i.test(subject)
  const invoiceNumber = subject.match(/\bINV\d+\b/)?.[0] ?? body.match(/\bINV\d+\b/)?.[0] ?? null
  const isInvoiceRejection = !isInvoiceApproved && (/invoice.*(rejected|invoice rejected)/i.test(subject) || /invoice.*rejected/i.test(body))
  const invoiceRejectionReasonMatch = body.match(/Rejection Reason:\s*([^\n]+)/i) || body.match(/rejected by [^\n]+ with the following reason:\s*([^\n]+)/i)
  const invoiceRejectionReason = invoiceRejectionReasonMatch ? invoiceRejectionReasonMatch[1].trim() : null

  const isAssignmentOnly = /has been assigned$|mentioned in|priority has been changed/i.test(subject.trim())

  // 7-Eleven sends "Work Order WOT… has been Canceled", Sunoco's dispatchers
  // write "site called and canceled WOT…", and the older portal sends
  // "SERVICE CANCELLED FOR SERVICE REQUEST #…". Any of them means the call is
  // dead: the work order must be closed, and must never be created.
  const isCancellation = /has been cancell?ed\b/i.test(subject)
    || /service cancell?ed\b/i.test(subject)
    || /\bcancell?ed\s+(?:WOT|FWKD)\d+/i.test(subject)
    || /\bcancell?ed\s+(?:WOT|FWKD)\d+/i.test(body)

  // "Work Order WOT… has been redirected to another Service Provider" (7-Eleven) and
  // "FWKD… is Terminated" (Wawa): the call has left our hands. Close it like a cancellation.
  const isRedirected = /has been redirected/i.test(subject)
  const isTerminated = /\bis terminated\b/i.test(subject)

  let siteNumber: string | null = null
  let siteName: string | null = null
  let siteAddress: string | null = null
  let siteCity: string | null = null
  let siteState: string | null = null
  let clientName: string | null = null
  let priorityRaw: string | null = null

  if (portal === '7help') {
    clientName = '7-Eleven'
    const pm = subject.match(/Priority\s+(P\d[^-]*-[^W]+)/i)
    priorityRaw = pm ? pm[1].trim() : (subject.match(/P\d/)?.[0] ?? null)

    // "Store Location: 7-ELEVEN STORE - 40400 Store Address: 7320 GAMBRILL RD,SPRINGFIELD,VA,US,22150"
    const locMatch = body.match(/Store Location:\s*([^\n]+?)\s*-\s*(\d+)\s*Store Address:\s*([^\n]+)/i)
    if (locMatch) {
      siteName = locMatch[1].trim()
      siteNumber = locMatch[2].trim()
      const addrParts = locMatch[3].split(',').map(s => s.trim())
      siteAddress = addrParts[0] ?? null
      siteCity    = addrParts[1] ?? null
      siteState   = addrParts[2] ?? null
    } else {
      // IT Service Desk-style "Location 80003586" fallback inside a 7help-detected email
      const locNum = subject.match(/Location\s+(\d+)/i)
      if (locNum) siteNumber = locNum[1]
    }
  } else if (portal === 'wtsc') {
    clientName = 'Wawa'
    const pm = body.match(/Priority\s*:\s*(\d)/i)
    priorityRaw = pm ? `Priority ${pm[1]}` : null
    const storeMatch = body.match(/Store\s*:\s*(\S+)/i)
    siteNumber = storeMatch ? storeMatch[1].trim() : null
    const tagMatch = body.match(/TAG\s*:\s*\d+\s+([^\n]+?)\s+Callers Name/i)
    siteName = tagMatch ? tagMatch[1].trim() : null
  } else if (portal === 'it_service_desk') {
    clientName = 'Sunoco'
    const pm = subject.match(/Priority\s+(\d[^,\n]*)/i)
    priorityRaw = pm ? pm[1].trim() : null
    const locNum = subject.match(/Location\s+(\d+)/i)
    siteNumber = locNum ? locNum[1] : null
    // Address is the first standalone address-shaped line in the body
    const addrMatch = body.match(/([0-9][^\n,]+),\s*([A-Z][A-Za-z .]+),\s*([A-Z]{2}),?\s*\d{5}/)
    if (addrMatch) {
      siteAddress = addrMatch[1].trim()
      siteCity    = addrMatch[2].trim()
      siteState   = addrMatch[3].trim()
    }
  }

  return {
    sourcePortal: portal,
    clientName,
    woNumber,
    incidentNumber,
    siteNumber,
    siteName,
    siteAddress,
    siteCity,
    siteState,
    priorityRaw,
    priorityRank: normalizePriority(portal, priorityRaw),
    isInvoiceRejection,
    invoiceRejectionReason,
    isAssignmentOnly,
    isCancellation,
    isRedirected,
    isTerminated,
    isInvoiceApproved,
    invoiceNumber,
  }
}

// ── Completion email parsing (rpinvoicing) ──────────────────────────────────

export type CompletionStatus = 'complete' | 'incomplete' | 'rtn' | 'unknown'

export interface ParsedCompletion {
  woNumber:   string | null
  status:     CompletionStatus
  note:       string
}

const FORWARD_MARKERS = [
  /-{5,}\s*Forwarded message\s*-{5,}/i,
  /Begin forwarded message:/i,
  // Gmail's reply header — "On Wed, Aug 5, 2026 at 11:46 AM IT Service Desk wrote:" — everything after it is the
  // quoted original dispatch, not the tech's own words, so it must never be searched for "return"/"RTN".
  /\n\s*On [^\n]{5,140}\bwrote:/i,
]

/** The tech's own line(s) sit above the quoted original — split there. */
function techNote(body: string): string {
  let cut = body.length
  for (const marker of FORWARD_MARKERS) {
    const m = body.match(marker)
    if (m && m.index !== undefined && m.index < cut) cut = m.index
  }
  return body.slice(0, cut).trim()
}

// Mobile mail clients often run the message straight into the signature line
// with no space/newline ("CompleteSent from my iPhone"), which breaks the
// \b word-boundary matching below — insert one back before classifying.
function insertSignatureBoundary(text: string): string {
  return text.replace(/(\S)(sent from my (?:iphone|ipad|ipod|android|galaxy|mobile))/gi, '$1 $2')
}

/**
 * "Return trip needed", the way techs actually write it: RTN / NTR (need to return) / retrip / "return trip" /
 * "need(s) to return" / "will return" / "return with" / "come back". This is the ONLY thing that keeps a call
 * open once a ticket for it reaches rpinvoicing (Trae, 2026-10-12): a ticket that does not say a return is
 * needed means the call is complete.
 */
export const RTN_RE = /\bntr\b|\brtn\b|re-?trip|return trip|return call|return needed|need.{0,4}to return|needs? (a )?return|return visit|\bwill (?:need to )?return\b|\breturn with\b|\breturning\b|\bcome back\b/i

/** Classify a tech's note (the line(s) above the forwarded original). Exported so stored notes can be re-read with the current rules. */
export function classifyCompletionNote(note: string): CompletionStatus {
  const noteLower = insertSignatureBoundary(note).toLowerCase()
  let status: CompletionStatus = 'unknown'
  if (RTN_RE.test(noteLower)) {
    status = 'rtn'
  } else if (/incompl/i.test(noteLower)) {   // also catches typos like "Incomplerte"
    status = 'incomplete'
  } else if (
    /\bcomplet(?:e|ed)\b|job complete/i.test(noteLower) ||
    // Techs almost always lead with the status word — catches it even when a
    // mail client glues it straight into the next word with no space at all
    // (e.g. "COMPLETEGILBARCO WARRANTY TICKET").
    /^complet(?:e|ed)/i.test(noteLower)
  ) {
    status = 'complete'
  }

  return status
}

export function parseCompletionEmail(subject: string, body: string): ParsedCompletion {
  const woNumber = extractWorkOrderNumber(subject) ?? extractWorkOrderNumber(body)
  const note = techNote(body)
  const status = classifyCompletionNote(note)
  return { woNumber, status, note: note.slice(0, 1000) }
}

/** A ticket's outcome under the standing rule: RTN wording = return trip, anything else = complete. */
export function ticketOutcome(note: string): 'rtn' | 'complete' {
  return RTN_RE.test(insertSignatureBoundary(note).toLowerCase()) ? 'rtn' : 'complete'
}

/** Cut the quoted reply/forward off a stored note so only the tech's own words are read. */
export function techWords(note: string): string {
  return techNote(note)
}

/** The office's own re-forward of a ticket (rpinvoicing@gmail.com sending to itself). */
export function isOfficeSender(email: string): boolean {
  return /^rpinvoicing@gmail\.com$/i.test(email.trim())
}

/**
 * Staff who send service tickets: the techs and service managers (first-initial-lastname.rp@gmail.com). Construction,
 * receipts and office-admin addresses are excluded — a foreman's field ticket or an office comment is not a service ticket.
 */
export function isTicketSender(email: string): boolean {
  const e = email.trim().toLowerCase()
  return /\.rp@gmail\.com$/.test(e) && !/^(const|econstruction|constructionreceipts|sparsons|sdodson|fdodson|tdodson|maintenance)/.test(e)
}
