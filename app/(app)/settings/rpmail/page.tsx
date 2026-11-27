import Link from 'next/link'
import { redirect } from 'next/navigation'
import { me, isMailAdmin } from '@/lib/rpmail/access'
import { RpmailAdmin } from '@/components/rpmail/rpmail-admin'
import { Mail } from '@/components/icons/solar'
import { TitleIcon } from '@/components/ui/title-icon'

// Settings -> RPMail (owners only): who has RPMail turned on, which shared mailboxes each person gets, and the
// shared mailboxes themselves. Per person, never per role.
export const dynamic = 'force-dynamic'

export default async function RpmailSettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; connect_error?: string }> }) {
  const q = await searchParams
  const who = await me()
  if (!who) redirect('/login')
  if (!isMailAdmin(who.role)) redirect('/settings')
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/settings" className="text-sm text-muted-foreground hover:text-foreground">← Settings</Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="rp-title"><TitleIcon icon={Mail} tone="gold" />RPMail</h1>
      </div>
      <RpmailAdmin connected={q.connected} connectError={q.connect_error?.slice(0, 300)} />
    </div>
  )
}
