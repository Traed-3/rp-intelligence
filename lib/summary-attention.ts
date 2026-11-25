/**
 * The "Still needs attention" part of the daily shop summary (app/api/daily-summary/route.ts).
 *
 * It used to be one flat list ("- Review queue (someone@gmail.com): subject") of every email ever parked
 * in the review queue. Now:
 *  - only what is still open is handed in (the sync closes review emails the shop archived),
 *  - emails are grouped by place (861, 211, 225 / office) or "Trucks and equipment",
 *  - a job and its replies / forwards are one line, newest first, with the date and who sent it,
 *  - each group shows at most `MAX_PER_GROUP` lines and says how many older ones are left.
 *
 * Pure: no database, no clock. Tested in tests/summary-attention.test.ts.
 */

export type ReviewItem = { sender: string | null; subject: string | null; received_at: string | null }
export type OpenTicket = { asset: string | null; title: string | null; status: string | null }

export const MAX_PER_GROUP = 8
const TZ = 'America/New_York'

// Company properties the shop looks after. A subject that names one is filed under it.
const PLACES: { key: string; label: string; re: RegExp }[] = [
  { key: '861', label: '861', re: /(^|[^\d])861([^\d]|$)/ },
  { key: '211', label: '211', re: /(^|[^\d])211([^\d]|$)/ },
  { key: '225', label: '225 Ritter Rd / office', re: /(^|[^\d])225([^\d]|$)|\boffice\b|\bservice department\b/i },
]
const OTHER = 'Trucks and equipment'

/** "Re: Fwd: 211 Water Heater " -> "211 Water Heater" */
export function baseSubject(subject: string | null): string {
  let s = (subject ?? '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/^(re|fwd?|fw)\s*:\s*/i, '')
    if (next === s) break
    s = next
  }
  return s
}

function placeOf(subject: string): string {
  for (const p of PLACES) if (p.re.test(subject)) return p.label
  return OTHER
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'numeric', day: 'numeric' }).format(d)
}

type Job = { subject: string; latest: string; count: number; senders: string[] }

export function renderAttention(
  review: ReviewItem[],
  unassigned: OpenTicket[],
  opts: { initialsOf: (email: string) => string; statusLabel: (s: string | null) => string },
): string[] {
  if (!review.length && !unassigned.length) return []
  const out: string[] = ['## Still needs attention', '']

  if (unassigned.length) {
    out.push(`### New tickets with nobody assigned (${unassigned.length})`, '')
    for (const t of unassigned) {
      const title = (t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
      out.push(`- **${t.asset ?? '(no asset)'}** ${title} _(${opts.statusLabel(t.status)})_`)
    }
    out.push('')
  }

  if (review.length) {
    // One line per job: the email and its replies / forwards share a subject
    const jobs = new Map<string, Job>()
    for (const r of review) {
      const subject = baseSubject(r.subject) || '(no subject)'
      const key = subject.toLowerCase()
      const who = r.sender ? opts.initialsOf(r.sender) : ''
      const at = r.received_at ?? ''
      const j = jobs.get(key)
      if (!j) { jobs.set(key, { subject, latest: at, count: 1, senders: who ? [who] : [] }); continue }
      j.count++
      if (at > j.latest) j.latest = at
      if (who && !j.senders.includes(who)) j.senders.push(who)
    }

    const groups = new Map<string, Job[]>()
    for (const j of jobs.values()) {
      const g = placeOf(j.subject)
      groups.set(g, [...(groups.get(g) ?? []), j])
    }
    const order = [OTHER, ...PLACES.map(p => p.label)].filter(g => groups.has(g))

    out.push(`### Emails still in the Inbox with no truck matched (${jobs.size})`, '')
    out.push('_Open Email Review to put each one on a truck or dismiss it. Archiving the email in the shop mailbox clears it here._', '')
    for (const g of order) {
      const list = groups.get(g)!.sort((a, b) => b.latest.localeCompare(a.latest))
      out.push(`**${g}** (${list.length})`)
      for (const j of list.slice(0, MAX_PER_GROUP)) {
        const date = shortDate(j.latest)
        const who = j.senders.length ? ` — ${j.senders.join(', ')}` : ''
        const more = j.count > 1 ? ` _(${j.count} emails)_` : ''
        out.push(`- ${date ? `${date}: ` : ''}${j.subject.slice(0, 110)}${who}${more}`)
      }
      if (list.length > MAX_PER_GROUP) out.push(`- and ${list.length - MAX_PER_GROUP} older`)
      out.push('')
    }
  }

  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}
