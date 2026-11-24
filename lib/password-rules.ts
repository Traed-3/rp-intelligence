// ============================================================
// Password rules + generator for Settings > Users > Set password.
// PURE module (no server-only imports): used by the server action and the client modal alike.
// ============================================================

export const MIN_PASSWORD_LENGTH = 10
/** bcrypt, which Supabase uses, silently ignores everything past 72 bytes, so refuse longer ones. */
export const MAX_PASSWORD_BYTES = 72

/** Returns a message the admin can act on, or null when the password is acceptable. */
export function validateNewPassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length === 0) return 'Enter a password.'
  if (pw.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (new TextEncoder().encode(pw).length > MAX_PASSWORD_BYTES) return 'That password is too long. Use 72 characters or fewer.'
  if (pw !== pw.trim()) return 'Remove the spaces at the start or end of the password.'
  return null
}

// No 0/O, 1/l/I or other look-alikes: people read these over the phone and type them on a phone keyboard.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

/** Random password from the browser/Node crypto source. Rejects the biased tail so every character is equally likely. */
export function generatePassword(length = 12): string {
  const out: string[] = []
  const limit = 256 - (256 % ALPHABET.length)
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (b < limit && out.length < length) out.push(ALPHABET[b % ALPHABET.length])
    }
  }
  return out.join('')
}
