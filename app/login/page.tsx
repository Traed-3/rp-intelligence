import { LoginLogo } from './login-logo'
import { SignInButton } from './sign-in-button'
import { PasswordLoginForm } from './password-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ disabled?: string; denied?: string }>
}) {
  const { disabled, denied } = await searchParams

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
            That account isn&apos;t set up in RP Intelligence. Sign in with your company Gmail, or ask the office to add you.
          </div>
        )}

        {/* Card */}
        <div className="rp-card p-8 space-y-5">

          {/* Email + password (master / admin login) */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Sign in with password</p>
            <PasswordLoginForm />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Google OAuth */}
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-3">Sign in with Gmail</p>
            <SignInButton />
          </div>

          <p className="text-xs text-center text-gray-400">
            Access is limited to RPS employees only.
          </p>
        </div>
      </div>
    </main>
  )
}
