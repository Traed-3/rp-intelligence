import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginLogo } from '../login/login-logo'
import { ChangePasswordForm } from './form'

export const dynamic = 'force-dynamic'

/** Shown at first sign-in with a temporary password (profiles.must_change_password); proxy.ts sends people here. */
export default async function ChangePasswordPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <LoginLogo />
        <div className="rp-card p-8 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-700">Choose your own password</p>
            <p className="text-xs text-gray-500 mt-1">You signed in with a temporary password. Pick one only you know before going any further. Signed in as {user.email}.</p>
          </div>
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  )
}
