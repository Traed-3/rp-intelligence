import Link from 'next/link'
import { type TicketPart, fmtDay, hoursLabel } from '@/lib/ticket-log'

export type TicketDocRow = {
  id: string; subject: string | null; sender: string | null; received_at: string | null; work_date: string | null
  extract_status: string; technician: string | null; onsite_hours: number | null; crew_size: number | null
  completion: string | null; front_text: string | null; transcript: string | null; parts: TicketPart[] | null
}

export const TICKET_DOC_COLUMNS = 'id, subject, sender, received_at, work_date, extract_status, technician, onsite_hours, crew_size, completion, front_text, transcript, parts'

/** "Tickets sent in" on a call or a construction job: each ticket's date, tech, hours, what it says and its parts. */
export function TicketDocsCard({ docs, className = '' }: { docs: TicketDocRow[]; className?: string }) {
  if (!docs.length) return null
  return (
    <div className={`rp-card p-5 ${className}`}>
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Tickets sent in ({docs.length})</h2>
      <ul className="divide-y divide-gray-100">
        {docs.map(d => {
          const parts = Array.isArray(d.parts) ? d.parts : []
          const text = (d.front_text || d.transcript || '').trim()
          return (
            <li key={d.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                <span className="font-medium text-gray-900">{fmtDay(d.work_date ?? d.received_at)}</span>
                <span className="text-gray-600">{d.technician || d.sender || '—'}</span>
                {d.onsite_hours != null && <span className="text-gray-500 tabular-nums">{hoursLabel(d.onsite_hours, d.crew_size)} h</span>}
                {d.completion === 'rtn' && <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200">RTN</span>}
                {d.completion === 'complete' && <span className="text-xs px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-200">Complete</span>}
                <Link href={`/service/tickets/inbox/${d.id}?from=log`} className="text-xs font-medium text-blue-600 hover:text-blue-800 ml-auto">Open ticket →</Link>
              </div>
              {d.extract_status === 'done'
                ? <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1 line-clamp-6">{text || 'Nothing readable on it.'}</p>
                : <p className="text-xs text-gray-400 mt-1">Not typed out yet — open it to read the scan.</p>}
              {parts.length > 0 && (
                <p className="text-xs text-gray-600 mt-1.5">
                  <span className="text-gray-400">Parts:</span>{' '}
                  {parts.map(p => `${p.qty != null ? `${p.qty} × ` : ''}${p.description || ''}${p.part_number ? ` (${p.part_number})` : ''}`).join('; ')}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
