'use client'

import { useTransition } from 'react'

// Pick which open job at this site a permit project belongs to (shown only
// when more than one open job exists at the site — the auto-link/auto-create
// logic in lib/permit-job-link.ts already handles the 0-or-1 cases).
export function LinkJobSelect({
  projectId,
  candidates,
  action,
}: {
  projectId: string
  candidates: { id: string; job_number: string | null; stage: string }[]
  action: (projectId: string, jobId: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()
  return (
    <select
      data-no-row-nav
      disabled={isPending}
      defaultValue=""
      onChange={(e) => { if (e.target.value) startTransition(() => { action(projectId, e.target.value) }) }}
      className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
    >
      <option value="" disabled>Which job is this?</option>
      {candidates.map(c => <option key={c.id} value={c.id}>{c.job_number ?? 'Unnumbered'} — {c.stage}</option>)}
    </select>
  )
}
