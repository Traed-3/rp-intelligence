import { cn } from '@/lib/utils'

/** Status colors mean something: danger = act now, warning = watch, success = done/good, info = in motion, neutral = no signal. */
export type Tone = 'danger' | 'warning' | 'success' | 'info' | 'brand' | 'muted' | 'neutral'

export function StatusPill({ tone = 'neutral', dot, className, children }: {
  tone?: Tone
  dot?: boolean
  className?: string
  children: React.ReactNode
}) {
  return <span className={cn('rp-pill', className)} data-tone={tone} data-dot={dot ? '' : undefined}>{children}</span>
}
