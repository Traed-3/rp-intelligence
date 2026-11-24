import Link from 'next/link'
import { FileText, PlayCircle, Smartphone, Mail, LifeBuoy, HardHat } from 'lucide-react'
import { HELP_GUIDES, HOME_SCREEN_GUIDE, RPMAIL_GUIDE, PLAYBOOK_GUIDE } from '@/lib/help'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadConstruction } from '@/lib/construction'
import { TitleIcon } from '@/components/ui/title-icon'

// Technical Help: how-to guides and videos. Open to everyone who signs in (lib/role-access.ts lists /help for the
// locked roles). New guides are added in lib/help.ts.
export default async function HelpPage() {
  // The Construction Playbook tile shows only to people who have the Construction module (its page checks the same).
  const { data: { user } } = await (await createClient()).auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = user ? await admin.from('profiles').select('id, company_id, role').eq('id', user.id).maybeSingle() : { data: null }
  const { data: block } = user ? await admin.from('profile_module_blocks').select('module').eq('profile_id', user.id).eq('module', 'construction').maybeSingle() : { data: null }
  const playbook = !!profile && canReadConstruction(profile) && !block
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="rp-title"><TitleIcon icon={LifeBuoy} tone="navy" />Technical Help</h1>
        <p className="text-sm text-gray-500 mt-0.5">How-to guides and short videos. Tap one to watch it or open the printable guide.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href={HOME_SCREEN_GUIDE.href} className="rp-card rp-card-link p-5 block">
          <div className="flex items-center gap-3 mb-2">
            <span className="rounded-lg p-2 rp-icon-navy"><Smartphone className="w-5 h-5" /></span>
            <h2 className="font-semibold text-gray-900">{HOME_SCREEN_GUIDE.title}</h2>
          </div>
          <p className="text-sm text-gray-500">{HOME_SCREEN_GUIDE.summary}</p>
          <p className="mt-3 text-xs text-gray-500">{HOME_SCREEN_GUIDE.audience} · Works on this device</p>
          <p className="mt-2 text-xs font-medium text-blue-600">Open →</p>
        </Link>
        <Link href={RPMAIL_GUIDE.href} className="rp-card rp-card-link p-5 block">
          <div className="flex items-center gap-3 mb-2">
            <span className="rounded-lg p-2 rp-icon-navy"><Mail className="w-5 h-5" /></span>
            <h2 className="font-semibold text-gray-900">{RPMAIL_GUIDE.title}</h2>
          </div>
          <p className="text-sm text-gray-500">{RPMAIL_GUIDE.summary}</p>
          <p className="mt-3 text-xs text-gray-500">{RPMAIL_GUIDE.audience} · Step-by-step guide</p>
          <p className="mt-2 text-xs font-medium text-blue-600">Open →</p>
        </Link>
        {playbook && (
          <Link href={PLAYBOOK_GUIDE.href} className="rp-card rp-card-link p-5 block">
            <div className="flex items-center gap-3 mb-2">
              <span className="rounded-lg p-2 rp-icon-navy"><HardHat className="w-5 h-5" /></span>
              <h2 className="font-semibold text-gray-900">{PLAYBOOK_GUIDE.title}</h2>
            </div>
            <p className="text-sm text-gray-500">{PLAYBOOK_GUIDE.summary}</p>
            <p className="mt-3 text-xs text-gray-500">{PLAYBOOK_GUIDE.audience} · Step-by-step guide</p>
            <p className="mt-2 text-xs font-medium text-blue-600">Open →</p>
          </Link>
        )}
        {HELP_GUIDES.map(g => (
          <Link key={g.slug} href={`/help/${g.slug}`} className="rp-card rp-card-link p-5 block">
            <div className="flex items-center gap-3 mb-2">
              <span className="rounded-lg p-2 rp-icon-navy">{g.video ? <PlayCircle className="w-5 h-5" /> : <FileText className="w-5 h-5" />}</span>
              <h2 className="font-semibold text-gray-900">{g.title}</h2>
            </div>
            <p className="text-sm text-gray-500">{g.summary}</p>
            <p className="mt-3 text-xs text-gray-500">
              {g.audience}
              {g.video ? ` · Video ${g.video.length}` : ''}
              {g.pdf ? ` · Guide ${g.pdf.pages} ${g.pdf.pages === 1 ? 'page' : 'pages'}` : ''}
            </p>
            <p className="mt-2 text-xs font-medium text-blue-600">Open →</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
