import { createAdminClient } from '@/lib/supabase/admin'
import { UserError } from './gmail'
import { mailboxFor, type Me } from './access'
import { indexRow, gid } from './mail-ops'

// RPMail: snooze and remind me. Each one is the person's own: nothing changes in Gmail, and nobody else who has the
// same mailbox sees any difference.

const YEAR = 366 * 86_400_000

/**
 * Snooze a conversation until a time (it leaves this person's Inbox and Needs you lists, then comes back), or ask
 * to be reminded at a time if nobody has replied by then (nothing is hidden). `on: false` cancels either.
 */
export async function setSnooze(who: Me, p: { mailbox?: unknown; id?: unknown; until?: unknown; kind?: unknown; on?: unknown }) {
  const box = await mailboxFor(who, p.mailbox)
  const id = gid(p.id)
  const row = await indexRow(box, id)
  const admin = createAdminClient()
  if (p.on === false) {
    await admin.from('rpmail_snoozes').delete().eq('profile_id', who.id).eq('mailbox_id', box.id).eq('thread_id', row.thread_id)
    return { ok: true, snoozed: false }
  }
  const kind = p.kind === 'remind' ? 'remind' : 'snooze'
  const at = typeof p.until === 'number' ? p.until : Date.parse(String(p.until ?? ''))
  if (!Number.isFinite(at) || at < Date.now() + 30_000) throw new UserError('Pick a time that is still to come.')
  if (at > Date.now() + YEAR) throw new UserError('Pick a time within the next year.')
  const { error } = await admin.from('rpmail_snoozes').upsert({
    profile_id: who.id, mailbox_id: box.id, gmail_id: id, thread_id: row.thread_id, subject: (row.subject ?? '').slice(0, 300),
    kind, until: new Date(at).toISOString(), woke_at: null, created_at: new Date().toISOString(),
  }, { onConflict: 'profile_id,mailbox_id,thread_id' })
  if (error) throw new Error('Could not save that.')
  return { ok: true, snoozed: true, kind, until: at }
}
