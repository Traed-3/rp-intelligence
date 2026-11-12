import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { CountUp } from './count-up'

type Color = 'blue' | 'red' | 'orange' | 'yellow' | 'green' | 'gray' | 'purple'

const COLOR_MAP: Record<Color, { gradient: string; glow: string }> = {
  blue:   { gradient: 'from-blue-500 to-blue-700',     glow: 'shadow-blue-500/30' },
  red:    { gradient: 'from-red-500 to-rose-600',      glow: 'shadow-red-500/30' },
  orange: { gradient: 'from-orange-400 to-orange-600', glow: 'shadow-orange-500/30' },
  yellow: { gradient: 'from-amber-400 to-amber-500',   glow: 'shadow-amber-500/30' },
  green:  { gradient: 'from-green-500 to-emerald-600', glow: 'shadow-green-500/30' },
  gray:   { gradient: 'from-slate-500 to-slate-700',   glow: 'shadow-slate-500/30' },
  purple: { gradient: 'from-violet-500 to-purple-600', glow: 'shadow-purple-500/30' },
}

export function StatCard({
  label,
  value,
  icon: Icon,
  color = 'blue',
  href,
  alert = false,
}: {
  label: string
  value: string | number
  icon: LucideIcon
  color?: Color
  href?: string
  alert?: boolean
}) {
  const c = COLOR_MAP[color]
  const content = (
    <div className={cn(
      'rp-card group p-5 flex items-center gap-4 transition-all duration-200',
      href && 'hover:shadow-lg hover:-translate-y-1 cursor-pointer',
      alert && Number(value) > 0 && 'ring-2 ring-red-400/60'
    )}>
      <div className={cn(
        'p-3 rounded-xl bg-gradient-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-105',
        c.gradient, c.glow
      )}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <CountUp value={value} className="block text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums tracking-tight leading-none" />
        <p className="text-xs font-medium text-gray-500 mt-1">{label}</p>
      </div>
    </div>
  )

  if (href) return <Link href={href}>{content}</Link>
  return content
}
