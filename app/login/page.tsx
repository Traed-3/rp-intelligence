import { LoginLogo } from './login-logo'
import { PasswordLoginForm } from './password-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string; denied?: string; google?: string }>
}) {
  const { disabled, denied, google } = await searchParams

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo / brand */}
        <LoginLogo />

        {disabled === '1' && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Your account has been disabled. Contact your manager if this is unexpected.
          </div>
        )}

        {denied === '1' && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            That account isn&apos;t set up in RP Intelligence. Ask the office to add you.
          </div>
        )}

        {google === 'off' && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Google sign-in is turned off. Sign in with your email and the password the office gave you.
          </div>
        )}

        {/* Card */}
        <div className="rp-card p-8 space-y-5">

          {/* Email + password is the only way in (Google sign-in was removed 11/13/26). */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Sign in</p>
            <PasswordLoginForm />
          </div>

          <p className="text-xs text-center text-gray-400">
            Access is limited to RPS employees. The office sets up your account and gives you a starter password.
          </p>
        </div>
      </div>
    </main>
  )
}
