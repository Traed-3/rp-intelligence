import { NextRequest, NextResponse } from 'next/server'
import { me } from '@/lib/rpmail/access'
import { oauthFinish } from '@/lib/rpmail/connect'
import { UserError } from '@/lib/rpmail/gmail'

// Google sends the person back here after "Sign in with Google" for a mailbox. The person must still be signed in
// to RP Intelligence, and the one-time ticket in the link must be the one made for them a few minutes earlier.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin))
  const who = await me()
  if (!who) return to('/login')
  try {
    return to(await oauthFinish(who, req.nextUrl.searchParams, req.nextUrl.origin))
  } catch (e) {
    const msg = e instanceof UserError ? e.message : 'The sign-in did not finish. Try again.'
    return to('/rpmail?connect_error=' + encodeURIComponent(msg))
  }
}
