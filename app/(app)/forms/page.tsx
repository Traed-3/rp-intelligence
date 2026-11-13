import Link from 'next/link'
import { ClipboardCheck, ClipboardList, Droplets, ShieldCheck, Truck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { requireFieldSurveys } from '@/lib/construction-guard'

export const dynamic = 'force-dynamic'

type Tile = { href?: string; icon: LucideIcon; title: string; body: string }

// One place for every form a tech fills out in the field. Open to service techs, construction techs and the
// construction roles (requireFieldSurveys). New forms get a tile here; `href` missing = not built yet.
const TILES: Tile[] = [
  { href: '/construction/surveys', icon: ClipboardCheck, title: 'ICON Boot Surveys', body: 'ICON sump worksheet: entry boots per sump, photos through the camera, PDF for part numbers.' },
  { href: '/construction/surveys/tests', icon: Droplets, title: 'Hydrostatic Test Report', body: 'Sump and UDC integrity tests on the state form: Maryland MDE, Virginia DEQ, West Virginia DEP.' },
  { href: '/construction/surveys/tests', icon: ShieldCheck, title: 'Spill Bucket & Overfill Tests', body: 'Spill bucket and Stage I bucket tests on the same state forms. Finish makes the PDF and emails it.' },
  { icon: ClipboardList, title: 'Site Surveys', body: 'Spill bucket and tank top site surveys.' },
  { icon: Truck, title: 'Pre-Trip Inspection', body: 'Daily truck and trailer walk-around.' },
  { icon: TriangleAlert, title: 'Accident Report', body: 'Vehicle accident or site incident report.' },
]

export default async function FormsPage() {
  await requireFieldSurveys()
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="rp-title">Forms</h1>
        <p className="text-sm text-gray-500 mt-0.5">Field forms for service and construction techs. Fill them out on the phone at the site.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TILES.map(t => {
          const Icon = t.icon
          const inner = (
            <>
              <div className="flex items-center gap-3 mb-2">
                <span className={`rounded-lg p-2 ${t.href ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'}`}><Icon className="w-5 h-5" /></span>
                <h2 className={`font-semibold ${t.href ? 'text-gray-900' : 'text-gray-500'}`}>{t.title}</h2>
              </div>
              <p className="text-sm text-gray-500">{t.body}</p>
              <p className={`mt-3 text-xs font-medium ${t.href ? 'text-blue-600' : 'text-gray-400'}`}>{t.href ? 'Open →' : 'Coming soon'}</p>
            </>
          )
          return t.href
            ? <Link key={t.title} href={t.href} className="rp-card rp-card-link p-5 block">{inner}</Link>
            : <div key={t.title} className="rp-card p-5 opacity-70">{inner}</div>
        })}
      </div>
    </div>
  )
}
