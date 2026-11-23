import { createAdminClient } from '@/lib/supabase/admin'
import { gmail } from './gmail'
import type { Mailbox } from './access'

// RPMail: what happens to mail the moment it arrives in a mailbox. Blocked senders first, then the mailbox's rules.
// It runs inside the regular check for new mail and only ever looks at mail that was not in the index before, so
// nothing older is touched and a rule never fires twice on the same message. Nothing is ever deleted for good:
// "Trash" is Gmail's Trash, which Gmail keeps for 30 days.

export type RuleMatch = { from?: string; to?: string; subject?: string }
export type RuleAction = { label?: string; archive?: boolean; read?: boolean; star?: boolean; quiet?: boolean; trash?: boolean }
export type Rule = { id: string; name: string; position: number; enabled: boolean; match: RuleMatch; action: RuleAction }

type Arrived = { gmail_id: string; from_name: string | null; from_addr: string | null; to_addrs: string | null; cc_addrs: string | null; subject: string | null
  labels: string[] | null; unread: boolean; starred: boolean }

const has = (hay: string, needle?: string) => !needle || hay.toLowerCase().includes(needle.toLowerCase())
/** Every part the rule names must be found (not case-sensitive). A rule that names nothing matches nothing. */
export function ruleMatches(m: RuleMatch, r: Pick<Arrived, 'from_name' | 'from_addr' | 'to_addrs' | 'cc_addrs' | 'subject'>): boolean {
  if (!(m.from || m.to || m.subject)) return false
  return has(`${r.from_name ?? ''} ${r.from_addr ?? ''}`, m.from) && has(`${r.to_addrs ?? ''} ${r.cc_addrs ?? ''}`, m.to) && has(r.subject ?? '', m.subject)
}

export async function onArrival(box: Pick<Mailbox, 'id'>, ids: string[]): Promise<{ blocked: number; ruled: number }> {
  const out = { blocked: 0, ruled: 0 }
  if (!ids.length) return out
  const admin = createAdminClient()
  const [{ data: bl }, { data: rl }] = await Promise.all([
    admin.from('rpmail_blocks').select('addr').eq('mailbox_id', box.id),
    admin.from('rpmail_rules').select('id, name, position, enabled, match, action').eq('mailbox_id', box.id).eq('enabled', true).order('position', { ascending: true }),
  ])
  const blocked = new Set((bl ?? []).map(b => String(b.addr).toLowerCase()))
  const rules = (rl ?? []) as Rule[]
  if (!blocked.size && !rules.length) return out
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('rpmail_messages').select('gmail_id, from_name, from_addr, to_addrs, cc_addrs, subject, labels, unread, starred')
      .eq('mailbox_id', box.id).eq('in_inbox', true).eq('sent', false).in('gmail_id', ids.slice(i, i + 200))
    for (const r of (data ?? []) as Arrived[]) {
      const row = () => admin.from('rpmail_messages')
      const hits = rules.filter(x => ruleMatches(x.match ?? {}, r)).map(x => x.action ?? {})
      const isBlocked = blocked.has(String(r.from_addr ?? '').toLowerCase())
      if (isBlocked || hits.some(a => a.trash)) {
        await gmail(box.id, `messages/${r.gmail_id}/trash`, { method: 'POST' })
        await row().delete().eq('mailbox_id', box.id).eq('gmail_id', r.gmail_id)
        if (isBlocked) out.blocked++; else out.ruled++
        continue
      }
      if (!hits.length) continue
      const labels = [...new Set(hits.map(a => a.label).filter((l): l is string => !!l && /^Label_[A-Za-z0-9_-]{1,40}$/.test(l)))]
      const archive = hits.some(a => a.archive), read = hits.some(a => a.read), star = hits.some(a => a.star), quiet = hits.some(a => a.quiet)
      const add = [...labels, ...(star ? ['STARRED'] : [])], remove = [...(archive ? ['INBOX'] : []), ...(read ? ['UNREAD'] : [])]
      if (add.length || remove.length) await gmail(box.id, `messages/${r.gmail_id}/modify`, { method: 'POST', body: { ...(add.length ? { addLabelIds: add } : {}), ...(remove.length ? { removeLabelIds: remove } : {}) } })
      await row().update({
        labels: [...new Set([...(r.labels ?? []), ...labels])], ...(archive ? { in_inbox: false } : {}), ...(read ? { unread: false } : {}), ...(star ? { starred: true } : {}), ...(quiet ? { quiet: true } : {}),
      }).eq('mailbox_id', box.id).eq('gmail_id', r.gmail_id)
      out.ruled++
    }
  }
  return out
}
