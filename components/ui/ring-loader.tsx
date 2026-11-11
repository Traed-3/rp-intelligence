import { cn } from '@/lib/utils'

/**
 * The app's loading mark: the ring from the logo drawing itself.
 * Sized by className (defaults to 1rem so it drops in where a spinner icon was)
 * and coloured by the current text colour.
 */
export function RingLoader({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" role="status" aria-label={label} className={cn('rp-ring w-4 h-4 shrink-0', className)}>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" pathLength={100} className="rp-ring-arc" />
    </svg>
  )
}

/** Ring + check that draw once — the "it went through" mark. */
export function RingCheck({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden className={cn('w-16 h-16', className)}>
      <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="3" pathLength={100} className="rp-check-ring" transform="rotate(-90 24 24)" />
      <path d="M14.5 24.5l6.5 6.5 12.5-13.5" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" pathLength={100} className="rp-check-mark" />
    </svg>
  )
}
