import { NextRequest, NextResponse } from 'next/server'

// Google sign-in was removed 11/13/26 (Trae). This used to finish the Google hand-off; it now refuses it, so a
// Google sign-in started any other way never becomes a session here. proxy.ts also signs out any Google session.
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/login?google=off', request.url))
}
