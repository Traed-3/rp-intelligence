import { redirect } from 'next/navigation'
import { Mail, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RpmailApp } from '@/components/rpmail/rpmail-app'

// RPMail (Trae, 11/20/26). Per user, never per role.
//   * A person with a row in rpmail_links has their own mail manager on their own computer: this page only links
//     to it, and none of that mail is stored in or sent through RP Intelligence.
//   * Everyone else gets the built-in RPMail, and only if they turn it on. Each person connects their own Gmail with
//     "Sign in with Google"; shared mailboxes are ticked per person by an owner in Settings -> RPMail.
export const dynamic = 'force-dynamic'

export default async function RpmailPage({ searchParams }: { searchParams: Promise<{ connected?: string; connect_error?: string }> }) {
  const q = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { data: link } = await admin.from('rpmail_links').select('url, note').eq('profile_id', user.id).maybeSingle()
  const { data: on } = await admin.from('rpmail_users').select('enabled').eq('profile_id', user.id).maybeSingle()

  if (link && !on?.enabled) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <div className="mb-5">
          <h1 className="rp-title">RPMail</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your mail manager. Every inbox, your jobs and what needs a reply, in one place.</p>
        </div>
        <div className="rp-card p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="rounded-lg p-2 bg-primary/10 text-primary"><Mail className="w-6 h-6" /></span>
            <div>
              <h2 className="font-semibold text-gray-900">Open your RPMail</h2>
              <p className="text-sm text-gray-500">It opens in its own tab. This page is only on your login.</p>
            </div>
          </div>
          <a href={link.url} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
            Open RPMail <ExternalLink className="w-4 h-4" />
          </a>
          {link.note && <p className="mt-4 text-xs text-gray-500">{link.note}</p>}
          <p className="mt-1 text-xs text-gray-500">Your mail stays on your own computer. RP Intelligence does not store or read it.</p>
        </div>
      </div>
    )
  }

  return <RpmailApp localUrl={link?.url ?? null} connected={/^[0-9a-f-]{36}$/.test(q.connected ?? '') ? q.connected : undefined} connectError={q.connect_error?.slice(0, 300)} />
}
