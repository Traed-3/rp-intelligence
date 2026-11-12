import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Tone } from './status-pill'

const toneText: Partial<Record<Tone, string>> = { danger: 'text-danger', warning: 'text-warning', success: 'text-success', info: 'text-info' }

/** One number with its label. Color only when the number is a signal (overdue, rejected…). */
export function StatTile({ value, label, tone, href, className }: {
  value: React.ReactNode
  label: React.ReactNode
  tone?: Tone
  href?: string
  className?: string
}) {
  const body = (
    <>
      <div className={cn('rp-stat-value', tone && toneText[tone])}>{value}</div>
      <div className="rp-stat-label">{label}</div>
    </>
  )
  const cls = cn('rp-card block p-4', href && 'rp-card-link', className)
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}
