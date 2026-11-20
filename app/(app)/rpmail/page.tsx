import { redirect } from 'next/navigation'
import { Mail, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// RPMail: a person's own mail manager, linked from here (Trae, 11/20/26).
// Per user, never per role: only someone with a row in rpmail_links sees the menu entry or this page, and each
// person's row points at their own RPMail. The mail itself is not stored in or sent through RP Intelligence;
// this page only opens the person's RPMail, which runs on their own computer.
export const dynamic = 'force-dynamic'

export default async function RpmailPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { data: link } = await admin.from('rpmail_links').select('url, note').eq('profile_id', user.id).maybeSingle()
  if (!link) redirect('/dashboard')

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
