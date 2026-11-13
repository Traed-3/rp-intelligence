import { SUPABASE_URL } from '@/lib/supabase/keys'

/**
 * A receipt link is only trusted when it points at this project's own `receipts` storage bucket.
 * `expenses.receipt_url` is filled from a form field, so anything else (another site, javascript:,
 * data:) is treated as no receipt rather than being opened, framed or shown as an image.
 */
export function safeReceiptUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const home = new URL(SUPABASE_URL)
    if (u.protocol !== 'https:' || u.origin !== home.origin) return null
    if (!u.pathname.startsWith('/storage/v1/object/public/receipts/')) return null
    return u.toString()
  } catch {
    return null
  }
}
