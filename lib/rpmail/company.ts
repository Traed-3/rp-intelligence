import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { UserError } from './gmail'
import { isMailAdmin, Forbidden, type Me } from './access'
import { logActivity } from './activity'

// RPMail: rules a company writes for itself about what may not be sent. They sit on top of the one rule that is
// built in and cannot be switched off (customer pricing never goes to or from a mailbox the crew reads).

export type ContentRule = {
  id: string; name: string; words: string[]; on: boolean
  /** 'crew': not to or from a mailbox the crew reads. 'all': not from RPMail at all. */
  scope: 'crew' | 'all'
}

export async function contentRules(companyId: string): Promise<ContentRule[]> {
  const { data } = await createAdminClient().from('rpmail_company').select('data').eq('company_id', companyId).maybeSingle()
  const list = (data?.data as { blocked?: unknown } | undefined)?.blocked
  return Array.isArray(list) ? (list as ContentRule[]).filter(r => r && typeof r.name === 'string' && Array.isArray(r.words)) : []
}

/** An owner saves the whole list. */
export async function contentSave(who: Me, p: { rules?: unknown }) {
  if (!isMailAdmin(who.role)) throw new Forbidden('Only an owner can change the blocked-content rules.')
  if (!Array.isArray(p.rules)) throw new UserError('Nothing to save.')
  if (p.rules.length > 20) throw new UserError('Keep it to 20 rules or fewer.')
  const rules: ContentRule[] = p.rules.map(raw => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    const words = [...new Set((Array.isArray(r.words) ? r.words : String(r.words ?? '').split(/[,\n]/)).map(w => String(w).replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean))]
    if (!name) throw new UserError('Give each rule a name, for example Margins.')
    if (!words.length) throw new UserError(`"${name}" needs at least one word or phrase to look for.`)
    if (words.length > 40) throw new UserError(`"${name}" has more than 40 words or phrases. Split it into two rules.`)
    const short = words.find(w => w.length < 3), long = words.find(w => w.length > 60)
    if (short) throw new UserError(`"${short}" is too short to block on: it would catch ordinary words. Use three characters or more.`)
    if (long) throw new UserError(`Keep each word or phrase to 60 characters or fewer.`)
    return { id: typeof r.id === 'string' && /^[0-9a-f-]{36}$/.test(r.id) ? r.id : randomUUID(), name, words, scope: r.scope === 'all' ? 'all' : 'crew', on: r.on !== false }
  })
  const { error } = await createAdminClient().from('rpmail_company').upsert({ company_id: who.company_id, data: { blocked: rules }, updated_by: who.id, updated_at: new Date().toISOString() }, { onConflict: 'company_id' })
  if (error) throw new Error('Could not save the rules.')
  await logActivity(who, 'content_rules', { detail: rules.length ? rules.map(r => `${r.name}${r.on ? '' : ' (off)'}`).join(', ') : 'all removed' })
  return { ok: true, rules }
}

const found = (text: string, phrase: string) => {
  const p = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp((/^\w/.test(phrase) ? '\\b' : '') + p + (/\w$/.test(phrase) ? '\\b' : ''), 'i').test(text)
}

/**
 * Stops a message that breaks one of the company's rules. `text` is everything that would go out: subject, body,
 * quoted mail and attachment names. `crewReads` is the set of addresses the crew reads.
 */
export function contentGuard(rules: ContentRule[], fromAddr: string, recipients: string[], text: string, crewReads: Set<string>) {
  const tail = 'Take it out to send (check the quoted text below your reply and the attachment names too).'
  for (const r of rules) {
    if (!r.on) continue
    const word = r.words.find(w => found(text, w))
    if (!word) continue
    if (r.scope === 'all') throw new UserError(`Blocked by your company's rule "${r.name}": this mentions "${word}". ${tail}`)
    if (crewReads.has(fromAddr.toLowerCase())) throw new UserError(`Blocked by your company's rule "${r.name}": this mentions "${word}" and would go out from ${fromAddr}, where the crew can read the Sent mail. ${tail}`)
    const hit = recipients.filter(a => crewReads.has(a.toLowerCase()))
    if (hit.length) throw new UserError(`Blocked by your company's rule "${r.name}": this mentions "${word}" and is addressed to ${hit.join(', ')}. Remove that address or take it out.`)
  }
}
