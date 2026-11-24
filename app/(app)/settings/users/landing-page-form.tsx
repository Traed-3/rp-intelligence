'use client'

import { useTransition } from 'react'
import { LANDING_PAGE_OPTIONS, DEFAULT_LANDING_PAGE } from '@/lib/landing-pages'

export function LandingPageForm({
  userId,
  currentPage,
  onUpdate,
}: {
  userId: string
  currentPage: string | null
  onUpdate: (page: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={currentPage ?? DEFAULT_LANDING_PAGE}
      disabled={isPending}
      onChange={e => {
        const newPage = e.target.value
        startTransition(() => onUpdate(newPage))
      }}
      className="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 bg-card"
    >
      {LANDING_PAGE_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}
