import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createAdminClient } from '@/lib/supabase/admin'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/keys'
import { VALID_LANDING_PAGES, DEFAULT_LANDING_PAGE } from '@/lib/landing-pages'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')

  // Determine the base URL for redirects. Prefer the address the user is
  // actually on (so preview deployments and localhost keep the session on the
  // same domain), falling back to NEXT_PUBLIC_APP_URL only if no host header.
  const host = request.headers.get('host') ?? ''
  const origin = host
    ? (host.includes('localhost') ? `http://${host}` : `https://${host}`)
    : (process.env.NEXT_PUBLIC_APP_URL ?? '')

  if (oauthError) {
    console.error('[callback] OAuth provider error:', oauthError)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`
    )
  }

  if (!code) {
    console.error('[callback] No code in request')
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  // The redirect response where session cookies will be written
  const redirectToDashboard = NextResponse.redirect(`${origin}/dashboard`)

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          // Reads all cookies from the incoming request — this is where the
          // code_verifier set by /api/auth/google lives.
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Write the session tokens into the redirect response so the browser
          // receives them as it lands on /dashboard.
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectToDashboard.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  console.log(
    '[callback] exchanging code, cookies present:',
    request.cookies.getAll().map(c => c.name).join(',') || 'NONE'
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.session) {
    console.error('[callback] exchangeCodeForSession error:', error?.message)
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error?.message ?? 'auth_failed')}`
    )
  }

  console.log('[callback] session established for user:', data.user.id)

  // Where this user lands after login — NULL/unset falls back to /dashboard.
  // Filled in below once we know which profile row (existing or newly linked) applies.
  let landingPage: string | null = null
  let denied = false

  // Ensure a profile row exists for this user (first-login setup)
  try {
    const admin = createAdminClient()

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, default_landing_page')
      .eq('id', data.user.id)
      .maybeSingle()

    if (existingProfile) {
      landingPage = existingProfile.default_landing_page
    }

    if (!existingProfile) {
      // Check if there's a pre-created profile for this email (added via "Add Employee" flow)
      // Supabase email-links the Google identity automatically, so data.user.id will be the
      // same as the pre-created auth user ID. But if the profile was created with a different
      // auth user ID, we fall back to an email lookup.
      const userEmail = data.user.email?.toLowerCase()
      const { data: emailProfile } = userEmail
        ? await admin.from('profiles').select('id, default_landing_page').eq('email', userEmail).maybeSingle()
        : { data: null }

      if (emailProfile && emailProfile.id !== data.user.id) {
        // A pre-created profile exists with this email but a different UUID —
        // update it to the actual auth user ID so it matches going forward.
        // (This is rare; normally Supabase links identities and keeps the same UUID.)
        await admin.from('profiles').update({ id: data.user.id }).eq('id', emailProfile.id)
        landingPage = emailProfile.default_landing_page
        console.log('[callback] linked pre-created profile to auth user')
      } else if (emailProfile) {
        landingPage = emailProfile.default_landing_page
      } else {
        // Not on the employee list: nobody set up a profile for this email in Settings → Users.
        // Sign-ins only work for people an owner or manager added, so drop the account Google just created.
        await admin.auth.admin.deleteUser(data.user.id)
        console.log('[callback] sign-in refused, no profile for', userEmail)
        denied = true
      }
    }
  } catch (profileErr) {
    // Non-fatal — the app layout has a belt-and-suspenders fallback
    console.error('[callback] profile creation error:', profileErr)
  }

  // redirectToDashboard already carries the session cookies (set via the
  // cookies.setAll closure above) — just repoint its Location if this user
  // has a non-default landing page configured in Settings > Users.
  // A fresh response, so none of the session cookies set above reach the browser.
  if (denied) return NextResponse.redirect(`${origin}/login?denied=1`)

  const finalPath = landingPage && (VALID_LANDING_PAGES as readonly string[]).includes(landingPage)
    ? landingPage
    : DEFAULT_LANDING_PAGE
  redirectToDashboard.headers.set('location', `${origin}${finalPath}`)

  return redirectToDashboard
}
