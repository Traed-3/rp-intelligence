'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'

type Option   = { value: string; label: string; icon: string }
type Ticket   = { id: string; ticket_number: string; title: string; unit_number: string | null }

export function StatusSelector({
  options,
  currentStatus,
  currentTicketId,
  myTickets,
  updateStatusAction,
  disabled,
}: {
  options: Option[]
  currentStatus: string
  currentTicketId: string | null
  myTickets: Ticket[]
  updateStatusAction: (status: string, ticketId?: string | null, note?: string | null) => Promise<void>
  disabled: boolean
}) {
  const [selected, setSelected] = useState(currentStatus)
  const [ticketId, setTicketId] = useState(currentTicketId ?? '')
  const [note, setNote] = useState('')
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function handleSelect(value: string) {
    setSelected(value)
    setSaved(false)
    if (value !== 'working_on_ticket') setTicketId('')
  }

  function handleSave() {
    startTransition(async () => {
      await updateStatusAction(
        selected,
        selected === 'working_on_ticket' ? ticketId || null : null,
        note || null
      )
      setSaved(true)
    })
  }

  return (
    <div className="space-y-4">
      {/* Status grid */}
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleSelect(opt.value)}
            disabled={disabled}
            className={cn(
              'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left',
              disabled && 'opacity-40 cursor-not-allowed',
              selected === opt.value
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : 'bg-card text-gray-700 border-gray-200 hover:border-gray-400'
            )}
          >
            <span className="text-lg leading-none">{opt.icon}</span>
            <span className="leading-tight">{opt.label}</span>
          </button>
        ))}
      </div>

      {/* Ticket picker if working_on_ticket */}
      {selected === 'working_on_ticket' && myTickets.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Which ticket?</label>
          <select
            value={ticketId}
            onChange={e => setTicketId(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Select ticket —</option>
            {myTickets.map(t => (
              <option key={t.id} value={t.id}>
                {t.ticket_number} — {t.title.slice(0, 35)}{t.unit_number ? ` (${t.unit_number})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Optional note */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Brief task note…"
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={disabled}
        />
      </div>

      <button
        onClick={handleSave}
        disabled={isPending || disabled}
        className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {isPending ? 'Saving…' : saved ? '✓ Status Updated' : 'Save Status'}
      </button>
    </div>
  )
}
