import { HEALTH_STYLE, type Health } from '@/lib/compliance'

export function HealthChip({ health, daysLeft, className = '' }: { health: Health; daysLeft?: number | null; className?: string }) {
  const s = HEALTH_STYLE[health]
  let label = s.label
  if (health === 'expired' && daysLeft != null) label = `Expired ${Math.abs(daysLeft)}d ago`
  else if (health === 'due_soon' && daysLeft != null) label = daysLeft === 0 ? 'Expires today' : `${daysLeft}d left`
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${s.cls} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {label}
    </span>
  )
}
