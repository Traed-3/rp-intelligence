import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } from '@/lib/supabase/keys'
import { VALID_LANDING_PAGES, DEFAULT_LANDING_PAGE } from '@/lib/landing-pages'
import { moduleForPath } from '@/lib/modules'
import { isSurveyOnly, surveyOnlyMayVisit, SURVEY_ONLY_HOME } from '@/lib/field-surveys'

// profiles has RLS enabled with zero policies defined (every other read of it
// in this app goes through the service-role admin client for that reason) —
// querying it with the session-bound anon-key client below silently returns
// nothing. Needed for both the is_active check and the /login landing-page
// lookup, so a plain admin client here (proxy.ts already runs on the Node
// runtime, not Edge — no restriction on using the service-role key).
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// In Next.js 16, middleware is renamed to "proxy" and uses the nodejs runtime.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // /api/gmail/*, /api/svc/*, /api/billing/* and /api/daily-summary routes
  // enforce their own auth (CRON_SECRET for the cron paths, session check for
  // in-app dry_run), so they bypass the global login redirect. /api/billing/
  // was missing here, which meant every unauthenticated cron hit to
  // /api/billing/inbox-sync (the econstruction/constructionreceipts/
  // rpinvoicing/maintenance billing-inbox sync, every 15 min) got redirected
  // to /login instead of running — "succeeding" in CI with an HTTP 307 body
  // while doing nothing. Only in-app "Sync now" clicks (already logged in)
  // ever actually ran.
  // /api/compliance/check (daily DQF & certification expiry check) checks CRON_SECRET itself, same as the rest.
  // PWA manifest + service worker must be reachable without a session so the
  // app icon / theme apply on install.
  const publicPaths = ['/login', '/auth/', '/api/auth/', '/api/gmail/', '/api/svc/', '/api/billing/', '/api/daily-summary', '/api/compliance/check', '/manifest.webmanifest', '/sw.js']
  const isPublic = publicPaths.some((p) => pathname.startsWith(p))

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // The locked-down Field Survey role must not reach the cron / in-app API paths that bypass the login gate above
  // (e.g. the in-app daily summary only needs "a logged-in user"). Cron calls carry no session, so they are unaffected.
  if (user && isPublic && ['/api/gmail/', '/api/svc/', '/api/billing/', '/api/daily-summary'].some((p) => pathname.startsWith(p))) {
    const { data: who } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (isSurveyOnly(who?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only for pages the login gate actually covers, plus /login itself (to
  // catch a stale session there too) — skip it for the cron/webhook/PWA
  // paths above, which either carry no session cookie at all or shouldn't
  // have a real navigation bounced mid-fetch (manifest.webmanifest, sw.js).
  if (user && (pathname === '/login' || !isPublic)) {
    // Settings → Users has an Active/Inactive toggle, but until now nothing
    // actually enforced it — a deactivated employee could still sign in and
    // use the whole app. This is the one place every authenticated request
    // already passes through, so it's the right spot to cut them off.
    const { data: profile } = await admin
      .from('profiles')
      .select('is_active, default_landing_page, role')
      .eq('id', user.id)
      .maybeSingle()

    // Signed in but not on the user list (e.g. an account left over from before sign-ins were limited
    // to employees): sign them out. On /login itself just clear the session so the page can show.
    if (!profile) {
      await supabase.auth.signOut()
      const out = pathname === '/login' ? supabaseResponse : NextResponse.redirect(new URL('/login?denied=1', request.url))
      supabaseResponse.cookies.getAll().forEach((c) => out.cookies.set(c))
      return out
    }

    if (profile?.is_active === false) {
      await supabase.auth.signOut()
      const redirect = NextResponse.redirect(new URL('/login?disabled=1', request.url))
      // signOut() clears the session cookies via the setAll callback above,
      // which reassigns supabaseResponse — carry those cleared cookies onto
      // the response we actually return, or the browser keeps the old ones.
      supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c))
      return redirect
    }

    if (pathname === '/login') {
      // Rare path (already-signed-in user manually hits /login, e.g. an old
      // bookmark) — still honor their configured landing page for consistency
      // with the actual login flows in auth/callback and the password form.
      const page = isSurveyOnly(profile?.role) ? SURVEY_ONLY_HOME : profile?.default_landing_page
      const landingPage = page && (VALID_LANDING_PAGES as readonly string[]).includes(page) ? page : DEFAULT_LANDING_PAGE
      return NextResponse.redirect(new URL(landingPage, request.url))
    }

    // Field Survey Only accounts: deny by default. Only the survey screens and their two API routes are reachable;
    // every other page redirects to the surveys list and every other API path answers 403.
    if (isSurveyOnly(profile?.role)) {
      if (surveyOnlyMayVisit(pathname)) return supabaseResponse
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.redirect(new URL(SURVEY_ONLY_HOME, request.url))
    }

    // Per-user module blocks (Settings → Users). Checked after the /login
    // special case above, since /login itself is never a blockable module.
    const moduleKey = moduleForPath(pathname)
    if (moduleKey) {
      const { data: block } = await admin
        .from('profile_module_blocks')
        .select('module')
        .eq('profile_id', user.id)
        .eq('module', moduleKey)
        .maybeSingle()
      if (block) {
        return NextResponse.redirect(new URL(`/dashboard?blocked=${moduleKey}`, request.url))
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Exclude Next.js internals, static files, AND the auth callback so the
    // OAuth code exchange is not interfered with by the proxy session check.
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
