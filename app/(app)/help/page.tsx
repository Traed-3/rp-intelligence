import Link from 'next/link'
import { FileText, PlayCircle, Smartphone, Mail } from 'lucide-react'
import { HELP_GUIDES, HOME_SCREEN_GUIDE, RPMAIL_GUIDE } from '@/lib/help'

// Technical Help: how-to guides and videos. Open to everyone who signs in (lib/role-access.ts lists /help for the
// locked roles). New guides are added in lib/help.ts.
export default function HelpPage() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="rp-title">Technical Help</h1>
        <p className="text-sm text-gray-500 mt-0.5">How-to guides and short videos. Tap one to watch it or open the printable guide.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href={HOME_SCREEN_GUIDE.href} className="rp-card rp-card-link p-5 block">
          <div className="flex items-center gap-3 mb-2">
            <span className="rounded-lg p-2 bg-primary/10 text-primary"><Smartphone className="w-5 h-5" /></span>
            <h2 className="font-semibold text-gray-900">{HOME_SCREEN_GUIDE.title}</h2>
          </div>
          <p className="text-sm text-gray-500">{HOME_SCREEN_GUIDE.summary}</p>
          <p className="mt-3 text-xs text-gray-500">{HOME_SCREEN_GUIDE.audience} · Works on this device</p>
          <p className="mt-2 text-xs font-medium text-blue-600">Open →</p>
        </Link>
        <Link href={RPMAIL_GUIDE.href} className="rp-card rp-card-link p-5 block">
          <div className="flex items-center gap-3 mb-2">
            <span className="rounded-lg p-2 bg-primary/10 text-primary"><Mail className="w-5 h-5" /></span>
            <h2 className="font-semibold text-gray-900">{RPMAIL_GUIDE.title}</h2>
          </div>
          <p className="text-sm text-gray-500">{RPMAIL_GUIDE.summary}</p>
          <p className="mt-3 text-xs text-gray-500">{RPMAIL_GUIDE.audience} · Step-by-step guide</p>
          <p className="mt-2 text-xs font-medium text-blue-600">Open →</p>
        </Link>
        {HELP_GUIDES.map(g => (
          <Link key={g.slug} href={`/help/${g.slug}`} className="rp-card rp-card-link p-5 block">
            <div className="flex items-center gap-3 mb-2">
              <span className="rounded-lg p-2 bg-primary/10 text-primary">{g.video ? <PlayCircle className="w-5 h-5" /> : <FileText className="w-5 h-5" />}</span>
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
