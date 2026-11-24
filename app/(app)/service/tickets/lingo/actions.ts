'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LINGO_CATEGORIES, canEditLingo } from '@/lib/ticket-log'

export type LingoState = { error?: string; ok?: string } | null

async function me() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await createAdminClient().from('profiles').select('id, company_id, role').eq('id', user.id).single()
  return data
}

const text = (fd: FormData, k: string, max: number) => ((fd.get(k) as string | null) ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null

/** Add a word, or update it if the term is already on the list (matched without regard to capitals). */
export async function saveLingo(_state: LingoState, fd: FormData): Promise<LingoState> {
  const p = await me()
  if (!p || !canEditLingo(p.role)) return { error: 'You do not have permission to change the list.' }
  const term = text(fd, 'term', 60)
  const meaning = text(fd, 'meaning', 300)
  if (!term) return { error: 'Type the word or abbreviation.' }
  if (!meaning) return { error: 'Type what it means.' }
  const category = LINGO_CATEGORIES.some(c => c.value === fd.get('category')) ? String(fd.get('category')) : 'general'
  const row = { meaning, misreads: text(fd, 'misreads', 200), note: text(fd, 'note', 300), category, is_active: true, updated_at: new Date().toISOString() }

  const admin = createAdminClient()
  const { data: existing } = await admin.from('company_lingo').select('id').eq('company_id', p.company_id).ilike('term', term.replace(/[%_\\]/g, m => `\\${m}`)).maybeSingle()
  const { error } = existing
    ? await admin.from('company_lingo').update({ term, ...row }).eq('id', existing.id).eq('company_id', p.company_id)
    : await admin.from('company_lingo').insert({ company_id: p.company_id, term, created_by: p.id, ...row })
  if (error) return { error: error.message }
  revalidatePath('/service/tickets/lingo')
  return { ok: existing ? `Updated ${term}.` : `Added ${term}.` }
}

export async function removeLingo(id: string): Promise<void> {
  const p = await me()
  if (!p || !canEditLingo(p.role)) return
  await createAdminClient().from('company_lingo').delete().eq('id', id).eq('company_id', p.company_id)
  revalidatePath('/service/tickets/lingo')
}
