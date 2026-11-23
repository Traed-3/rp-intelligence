import Link from 'next/link'
import { ArrowRight, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEFAULT_CARD_STYLE, type CardStyle } from '@/lib/ui-prefs'

export type Figure = { label: string; value: string | number; alert?: boolean }

/** Icon colors for the "Navy and Gold" look (the other two looks use gold icons on navy). */
const ACCENT: Record<string, string> = {
  maintenance: 'bg-blue-100 text-blue-700',
  service: 'bg-green-100 text-green-700',
  construction: 'bg-amber-100 text-amber-700',
  my_plate: 'bg-blue-100 text-blue-700',
  billing: 'bg-purple-100 text-purple-700',
  inventory: 'bg-sky-100 text-sky-700',
  compliance: 'bg-red-100 text-red-700',
}

/**
 * A department square on the Dashboard, in the look the person picked in Settings → Personalize (lib/ui-prefs.ts CardStyle):
 *  - gold-icons:  navy band across the top, gold icon (same gold as the side menu), gold rule under the band (standard)
 *  - navy-header: the same navy band with white icons
 *  - navy-gold:   white square with a navy cap on top, navy title with a short gold bar under it, colored icons
 * `href` left out = a picture of the card (Personalize preview), not a link.
 */
export function DepartmentCard({ cardKey, href, title, icon: Icon, figures, allClear, badge, look = DEFAULT_CARD_STYLE }: {
  cardKey: string
  href?: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  figures: Figure[]
  allClear?: boolean
  badge?: string
  look?: CardStyle
}) {
  const banded = look !== 'navy-gold'
  const body = (
    <>
      {badge && (
        <span className="absolute -top-2.5 right-12 z-10 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200 shadow-sm">
          {badge}
        </span>
      )}

      {banded ? (
        <div className="rp-band">
          <div className="flex items-center gap-3 min-w-0">
            <span className="rp-band-icon"><Icon className="w-5 h-5" /></span>
            <h2 className="rp-band-title">{title}</h2>
          </div>
          <ArrowRight className="rp-band-arrow w-4 h-4 shrink-0" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className={cn('w-9 h-9 shrink-0 rounded-xl flex items-center justify-center', ACCENT[cardKey] ?? ACCENT.maintenance)}>
              <Icon className="w-5 h-5" />
            </span>
            <h2 className="rp-cap-title">{title}</h2>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0 text-gray-300 group-hover:text-blue-500 group-hover:translate-x-0.5 transition-all" />
        </div>
      )}

      {allClear ? (
        <div className="flex items-center gap-2 text-green-700 text-sm font-medium py-2">
          <CheckCircle className="w-4 h-4" /> All caught up
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {figures.map((f) => (
            <div key={f.label}>
              <p className={`text-2xl font-bold ${f.alert ? 'text-red-600' : 'text-gray-900'}`}>{f.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{f.label}</p>
            </div>
          ))}
        </div>
      )}
    </>
  )
  const cls = cn('rp-card group relative p-5 flex flex-col', banded ? 'rp-card-banded' : 'rp-card-capped', href && 'rp-card-link')
  return href
    ? <Link href={href} className={cls} data-look={look}>{body}</Link>
    : <div className={cls} data-look={look} aria-hidden>{body}</div>
}
