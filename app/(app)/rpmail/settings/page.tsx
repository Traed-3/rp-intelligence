import Link from 'next/link'
import { redirect } from 'next/navigation'
import { me } from '@/lib/rpmail/access'
import { RpmailSettings } from '@/components/rpmail/rpmail-settings'

// RPMail -> Settings: one place for everything a person can set for themselves. (What an owner sets for the whole
// company is under Settings -> RPMail.) Only for someone who has RPMail turned on.
export const dynamic = 'force-dynamic'

export default async function RpmailOwnSettingsPage() {
  const who = await me()
  if (!who) redirect('/login')
  if (!who.enabled) redirect('/rpmail')
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/rpmail" className="text-sm text-muted-foreground hover:text-foreground">← RPMail</Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="rp-title">Settings</h1>
      </div>
      <RpmailSettings />
    </div>
  )
}
