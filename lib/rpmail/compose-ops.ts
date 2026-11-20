import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { UserError } from './gmail'
import { myMailboxes, type Me } from './access'
import { ADDR_RE } from './parse'
import type { OutFile } from './mime'

// RPMail: what the "write a message" box needs besides sending: files waiting to be attached, the address book
// that fills in as you type, and the person's own templates.

export const OUTBOX = 'rpmail-outbox'
export const MAX_ATTACH = 20_000_000
const UUID = /^[0-9a-f-]{36}$/
const safeName = (n: unknown) => String(n ?? '').replace(/[\\/\r\n\t"<>|:*?\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'file'
/** A waiting file belongs to the person whose id starts its path. Anything else is refused. */
const mine = (who: Pick<Me, 'id'>, path: unknown): path is string =>
  typeof path === 'string' && path.startsWith(who.id + '/') && !path.includes('..') && path.length < 400 && path.split('/').length === 3

/** Step 1 of attaching a file: get a one-time upload ticket. The browser then sends the file straight to storage. */
export async function attachPrepare(who: Me, p: { name?: unknown; size?: unknown }) {
  const size = Number(p.size) || 0
  if (size <= 0) throw new UserError('That file is empty.')
  if (size > MAX_ATTACH) throw new UserError('That file is over 20 MB, which is more than email can carry. Share it another way (a Dropbox link, for example).')
  const path = `${who.id}/${randomUUID()}/${safeName(p.name)}`
  const { data, error } = await createAdminClient().storage.from(OUTBOX).createSignedUploadUrl(path)
  if (error || !data) throw new Error('Could not get ready to attach the file.')
  return { path, token: data.token }
}

export async function attachRemove(who: Me, p: { path?: unknown }) {
  if (!mine(who, p.path)) throw new UserError('No such file.')
  await createAdminClient().storage.from(OUTBOX).remove([p.path])
  return { ok: true }
}

/** The files a person attached, read back for sending. Only their own; total size is checked by the caller. */
export async function takeAttachments(who: Me, paths: unknown): Promise<{ files: OutFile[]; paths: string[] }> {
  const list = Array.isArray(paths) ? [...new Set(paths)] : []
  if (list.length > 15) throw new UserError('Attach 15 files or fewer.')
  const files: OutFile[] = [], ok: string[] = []
  const store = createAdminClient().storage.from(OUTBOX)
  let total = 0
  for (const path of list) {
    if (!mine(who, path)) throw new UserError('One of the attached files is not yours to send. Remove it and attach it again.')
    const { data, error } = await store.download(path)
    if (error || !data) throw new UserError(`The attached file ${path.split('/')[2]} is missing. Remove it and attach it again.`)
    // Stop as soon as the running total passes the cap, before the file is copied into memory (the size typed into
    // attach_prepare is only a claim; the bucket itself refuses any single file over 20 MB).
    total += data.size
    if (total > MAX_ATTACH) throw new UserError('The attachments add up to more than 20 MB, which is more than email can carry. Take one off.')
    files.push({ name: path.split('/')[2], type: data.type || 'application/octet-stream', data: Buffer.from(await data.arrayBuffer()) })
    ok.push(path)
  }
  return { files, paths: ok }
}
export async function dropAttachments(paths: string[]) {
  if (paths.length) await createAdminClient().storage.from(OUTBOX).remove(paths).catch(() => null)
}

/** Names and addresses from the mail in this person's own mailboxes that match what they are typing. */
export async function contacts(who: Me, p: Record<string, string>) {
  const q = (p.q ?? '').replace(/[,()%_*\\"']/g, ' ').trim().slice(0, 60)
  if (q.length < 2) return { contacts: [] }
  const boxes = (await myMailboxes(who)).map(b => b.id)
  if (!boxes.length) return { contacts: [] }
  const admin = createAdminClient()
  const [{ data: from }, { data: to }] = await Promise.all([
    admin.from('rpmail_messages').select('from_name, from_addr').in('mailbox_id', boxes).eq('bulk', false)
      .or(`from_addr.ilike.%${q}%,from_name.ilike.%${q}%`).order('date', { ascending: false }).limit(150),
    admin.from('rpmail_messages').select('to_addrs').in('mailbox_id', boxes).eq('sent', true).ilike('to_addrs', `%${q}%`).order('date', { ascending: false }).limit(100),
  ])
  const seen = new Map<string, { name: string; addr: string; n: number }>()
  const add = (addr: string, name: string, weight: number) => {
    const a = addr.trim().toLowerCase()
    if (!ADDR_RE.test(a)) return
    const cur = seen.get(a)
    if (cur) { cur.n += weight; if (!cur.name && name) cur.name = name } else seen.set(a, { name: name && name.toLowerCase() !== a ? name : '', addr: a, n: weight })
  }
  // People you have written to count for more than people who have written to you.
  for (const r of to ?? []) for (const a of String(r.to_addrs ?? '').split(',')) if (a.toLowerCase().includes(q.toLowerCase())) add(a, '', 3)
  for (const r of from ?? []) add(String(r.from_addr ?? ''), String(r.from_name ?? ''), 1)
  return { contacts: [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 8).map(({ name, addr }) => ({ name, addr })) }
}

export async function templateList(who: Me) {
  const { data } = await createAdminClient().from('rpmail_templates').select('id, name, body').eq('profile_id', who.id).order('name').limit(100)
  return { templates: data ?? [] }
}
export async function templateSave(who: Me, p: { id?: unknown; name?: unknown; body?: unknown }) {
  const name = String(p.name ?? '').trim().slice(0, 80), body = String(p.body ?? '').slice(0, 20_000)
  if (!name) throw new UserError('Give the template a name.')
  if (!body.trim()) throw new UserError('The template is empty.')
  const admin = createAdminClient()
  if (typeof p.id === 'string' && UUID.test(p.id)) {
    const { data } = await admin.from('rpmail_templates').update({ name, body, updated_at: new Date().toISOString() }).eq('id', p.id).eq('profile_id', who.id).select('id')
    if (!data?.length) throw new UserError('That template is not yours.')
  } else {
    const { count } = await admin.from('rpmail_templates').select('id', { count: 'exact', head: true }).eq('profile_id', who.id)
    if ((count ?? 0) >= 100) throw new UserError('You have 100 templates. Delete one first.')
    const { error } = await admin.from('rpmail_templates').insert({ profile_id: who.id, name, body })
    if (error) throw new Error('Could not save the template.')
  }
  return { ok: true }
}
export async function templateDelete(who: Me, p: { id?: unknown }) {
  if (typeof p.id !== 'string' || !UUID.test(p.id)) throw new UserError('No such template.')
  await createAdminClient().from('rpmail_templates').delete().eq('id', p.id).eq('profile_id', who.id)
  return { ok: true }
}
