import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RpmailApp } from '@/components/rpmail/rpmail-app'

// The mail window: the same RPMail as /rpmail, with the mailboxes and folders in the navy menu on the left.
// The RPMail menu entry opens it in a window of its own (lib/rpmail/window.ts) and brings it back without reloading.
// A person whose RPMail is their own linked one (rpmail_links, built-in RPMail off) is sent to /rpmail, which links to it.
export const dynamic = 'force-dynamic'

export default async function MailWindowPage({ searchParams }: { searchParams: Promise<{ connected?: string; connect_error?: string }> }) {
  const q = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/login?denied=1')
  const { data: link } = await admin.from('rpmail_links').select('url').eq('profile_id', user.id).maybeSingle()
  const { data: on } = await admin.from('rpmail_users').select('enabled').eq('profile_id', user.id).maybeSingle()
  if (link && !on?.enabled) redirect('/rpmail')
  return <RpmailApp windowed localUrl={link?.url ?? null} connected={/^[0-9a-f-]{36}$/.test(q.connected ?? '') ? q.connected : undefined} connectError={q.connect_error?.slice(0, 300)} />
}
