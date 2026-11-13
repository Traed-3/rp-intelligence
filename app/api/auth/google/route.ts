import { NextRequest, NextResponse } from 'next/server'

// Google sign-in was removed 11/13/26 (Trae): accounts are set up in Settings -> Users with a starter password.
// Old bookmarks and buttons land back on the login page.
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/login?google=off', request.url))
}
