import Link from 'next/link'
import { requireConstruction } from '@/lib/construction-guard'
import { CONSTRUCTION_PLAYBOOK_HTML } from '@/lib/help-playbook'
import { PLAYBOOK_GUIDE } from '@/lib/help'

// Technical Help > Construction Playbook. For people who have the Construction module (the same check as the
// Construction pages); everyone else is sent away. The guide is plain HTML shown in a locked frame (no scripts).
export default async function ConstructionPlaybookPage() {
  await requireConstruction()
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="rp-title">{PLAYBOOK_GUIDE.title}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{PLAYBOOK_GUIDE.summary}</p>
        </div>
        <Link href="/help" className="text-sm text-muted-foreground hover:text-foreground">← Technical Help</Link>
      </div>
      <iframe title={PLAYBOOK_GUIDE.title} srcDoc={CONSTRUCTION_PLAYBOOK_HTML} sandbox=""
        className="w-full h-[calc(100dvh-12rem)] min-h-[480px] rounded-xl border border-border bg-white" />
    </div>
  )
}
