/**
 * Public demo mode (demo.rpintelligence.app).
 *
 * The demo is a SEPARATE Vercel project pointed at a SEPARATE Supabase project
 * (rp-intelligence-demo) that holds only fictional data. It never has the
 * production keys. Demo mode is switched on with NEXT_PUBLIC_DEMO_MODE=1 and
 * only ever does two things: shows demo-only UI (banner, one-click sign-in)
 * and turns OFF anything that would reach the outside world or let a visitor
 * lock others out (emails, push, uploads, password and user-account changes).
 */

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1'

/** The shared login every visitor uses. Its password lives only in the demo project's env. */
export const DEMO_EMAIL = 'demo@demo.rpintelligence.app'

/** The demo Supabase project. Demo-only service-role code runs against this database and nothing else. */
const DEMO_SUPABASE_URL = 'https://mkgxfxnvubravxrqvhdi.supabase.co'

export function demoDatabaseIsSafe(): boolean {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  return IS_DEMO && url === DEMO_SUPABASE_URL
}

export const DEMO_BLOCKED_MESSAGE = 'That is turned off in the demo, so the sample data stays usable for everyone.'
export const DEMO_UPLOAD_MESSAGE = 'File uploads are turned off in the demo.'

/** First names baked into a few screens (My Plate's plate partner and PO contact). The demo uses the fictional staff instead. */
export const PLATE_PARTNER_NAME = IS_DEMO ? 'Casey' : 'Starsky'
export const PO_CONTACT_NAME = IS_DEMO ? 'Taylor' : 'Shannon'
