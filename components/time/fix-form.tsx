import { nyParts } from '@/lib/time-clock'

/**
 * The boxes for one shift: day, clock-in, clock-out, unpaid break, reason. Plain form, no browser code:
 * the times are Eastern wall-clock times and the server turns them into moments (buildFix in lib/time-clock.ts).
 * Used by the manager's fix, "add a missed day" and the employee's "my time is wrong".
 */
export function FixFields({ clockIn, clockOut, breakMinutes, notePlaceholder, noteLabel = 'Reason' }: {
  clockIn?: string | null
  clockOut?: string | null
  breakMinutes?: number | null
  notePlaceholder: string
  noteLabel?: string
}) {
  const i = clockIn ? nyParts(clockIn) : null
  const o = clockOut ? nyParts(clockOut) : null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <label className="block">
        <span className="rp-label">Day</span>
        <input type="date" name="day" required defaultValue={i?.day ?? ''} className="rp-input mt-1" />
      </label>
      <label className="block">
        <span className="rp-label">Clock in</span>
        <input type="time" name="in" required defaultValue={i?.hhmm ?? ''} className="rp-input mt-1" />
      </label>
      <label className="block">
        <span className="rp-label">Clock out</span>
        <input type="time" name="out" required defaultValue={o?.hhmm ?? ''} className="rp-input mt-1" />
      </label>
      <label className="block">
        <span className="rp-label">Unpaid break (min)</span>
        <input type="number" name="break" min={0} max={600} step={5} inputMode="numeric" defaultValue={breakMinutes ?? 0} className="rp-input mt-1" />
      </label>
      <label className="block col-span-2 sm:col-span-4">
        <span className="rp-label">{noteLabel}</span>
        <input type="text" name="note" required maxLength={300} placeholder={notePlaceholder} className="rp-input mt-1" />
      </label>
      <p className="col-span-2 sm:col-span-4 text-xs text-muted-foreground -mt-1">
        Eastern time. A clock-out earlier than the clock-in counts as past midnight.
      </p>
    </div>
  )
}

/** Green or red line at the top of a page after a form comes back. */
export function FormMessage({ done, error }: { done?: string; error?: string }) {
  if (error) return <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger">{error}</p>
  if (done) return <p role="status" className="mb-4 rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium text-success">{done}</p>
  return null
}
