// Shared bits for the ticket log (Service -> Tickets -> All tickets): the record of every
// ticket emailed in, what is written on the front, and the parts written on the back.

export type TicketPart = { qty: number | null; description: string; part_number: string | null; source: string | null }
export type TicketPage = { name: string; kind: string; note: string | null }

export const PAGE_KIND_LABEL: Record<string, string> = {
  ticket_front: 'Ticket — front',
  ticket_back: 'Ticket — back / parts',
  parts_tag: 'Part tag',
  packing_list: 'Packing list',
  printout: 'Printout',
  portal_screenshot: 'Work order screen',
  site_photo: 'Site photo',
  other: 'Other',
}

export const LOG_VIEWS = [
  { value: 'all',      label: 'All tickets' },
  { value: 'parts',    label: 'With parts' },
  { value: 'rtn',      label: 'Return needed' },
  { value: 'unlinked', label: 'Not tied to a call or job' },
  { value: 'untyped',  label: 'Not typed yet' },
  { value: 'copies',   label: 'Forwarded copies' },
  { value: 'noticket', label: 'Sent without a ticket' },
] as const
export type LogView = typeof LOG_VIEWS[number]['value']

/** Strip the characters that mean something in a PostgREST filter so a search box can never break the query. */
export function safeSearch(q: string | undefined | null): string {
  return (q ?? '').replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** The site to show for a ticket: the call's store, else what is written on the ticket, else the email subject. */
export function ticketSite(d: { ticket_site?: string | null; subject?: string | null }, wo?: { site_number: string | null } | null, job?: { site_number: string | null } | null): string {
  return wo?.site_number || job?.site_number || d.ticket_site || (d.subject ?? '').replace(/^\s*((fwd?|fw|re):\s*)+/i, '').slice(0, 40) || '—'
}

export function fmtDay(d: string | null | undefined): string {
  if (!d) return '—'
  // A plain date (work_date) is shown as that calendar day, never shifted by the time zone.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export function hoursLabel(hours: number | null | undefined, crew: number | null | undefined): string {
  if (hours == null) return '—'
  return crew && crew > 1 ? `${hours} × ${crew}` : String(hours)
}
