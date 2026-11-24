'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Wraps a status badge. When `value` changes while the badge is on screen
 * (someone marks a job complete, a permit issued…), a navy panel with a check
 * wipes across it once. Nothing plays on first render.
 */
export function ChangeFlash({ value, children }: { value: string; children: React.ReactNode }) {
  const prev = useRef(value)
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (prev.current === value) return
    prev.current = value
    setRun((n) => n + 1)
  }, [value])

  return (
    <span className="relative inline-flex overflow-hidden rounded-full align-middle">
      {children}
      {run > 0 && (
        <span key={run} aria-hidden className="rp-flash">
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
            <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </span>
  )
}
