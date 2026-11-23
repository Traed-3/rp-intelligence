import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { UserError } from './gmail'
import { myMailboxes, Forbidden, type Me } from './access'
import { ADDR_RE } from './parse'
import type { OutFile } from './mime'
import { keptWording } from './rich'

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
const PICTURE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
/** What kind of picture the bytes really are, whatever the file is called. Null for anything that is not one of the four kinds. */
function pictureKind(b: Buffer): string | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return 'image/gif'
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  return null
}
const NOT_A_PICTURE = 'That file is not a picture RPMail can place in the text (PNG, JPEG, GIF or WebP). Attach it as a file instead.'

async function loadPicture(who: Pick<Me, 'id'>, path: unknown): Promise<OutFile> {
  if (!mine(who, path)) throw new UserError('One of the pictures in the message is not yours to send. Take it out and put it in again.')
  const name = path.split('/')[2]
  if (!PICTURE_TYPES[name.split('.').pop()?.toLowerCase() ?? '']) throw new UserError(NOT_A_PICTURE)
  const { data, error } = await createAdminClient().storage.from(OUTBOX).download(path)
  if (error || !data) throw new UserError(`The picture ${name} is no longer waiting to be sent. Take it out of the message and put it in again.`)
  if (data.size > MAX_ATTACH) throw new UserError('That picture is over 20 MB.')
  const bytes = Buffer.from(await data.arrayBuffer())
  const type = pictureKind(bytes)
  if (!type) throw new UserError(NOT_A_PICTURE)
  return { name, type, data: bytes }
}

/** The pictures a person placed in the text of a message, read back for sending. Only their own, and only real pictures. */
export async function takePictures(who: Me, paths: string[]): Promise<{ files: OutFile[]; paths: string[] }> {
  const list = [...new Set(paths)]
  if (list.length > 20) throw new UserError('Put 20 pictures or fewer in one message.')
  const files: OutFile[] = []
  let total = 0
  for (const path of list) {
    const f = await loadPicture(who, path)
    total += f.data.length
    if (total > MAX_ATTACH) throw new UserError('The pictures add up to more than 20 MB, which is more than email can carry. Take one out.')
    files.push(f)
  }
  return { files, paths: list }
}

/**
 * Shows a person one of their own waiting pictures, for the message box they are writing in. Never anyone else's, and
 * never anything that is not a picture: the type sent back comes from the bytes, not from the file's name.
 */
export async function attachView(who: Me, p: Record<string, string>): Promise<Response> {
  if (!mine(who, p.path)) throw new Forbidden('That picture is not yours.')
  const f = await loadPicture(who, p.path)
  return new Response(new Uint8Array(f.data), { headers: {
    'Content-Type': f.type, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=600',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } })
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
  const { data } = await createAdminClient().from('rpmail_templates').select('id, name, body, html').eq('profile_id', who.id).order('name').limit(100)
  return { templates: data ?? [] }
}
export async function templateSave(who: Me, p: { id?: unknown; name?: unknown; body?: unknown; html?: unknown }) {
  // A template may carry formatting. The HTML is cleaned here and the plain wording taken from the cleaned copy.
  const kept = keptWording(p.html, p.body, 20_000)
  const name = String(p.name ?? '').trim().slice(0, 80), body = kept.text, html = kept.html
  if (!name) throw new UserError('Give the template a name.')
  if (!body.trim()) throw new UserError('The template is empty.')
  const admin = createAdminClient()
  if (typeof p.id === 'string' && UUID.test(p.id)) {
    const { data } = await admin.from('rpmail_templates').update({ name, body, html, updated_at: new Date().toISOString() }).eq('id', p.id).eq('profile_id', who.id).select('id')
    if (!data?.length) throw new UserError('That template is not yours.')
  } else {
    const { count } = await admin.from('rpmail_templates').select('id', { count: 'exact', head: true }).eq('profile_id', who.id)
    if ((count ?? 0) >= 100) throw new UserError('You have 100 templates. Delete one first.')
    const { error } = await admin.from('rpmail_templates').insert({ profile_id: who.id, name, body, html })
    if (error) throw new Error('Could not save the template.')
  }
  return { ok: true }
}
export async function templateDelete(who: Me, p: { id?: unknown }) {
  if (typeof p.id !== 'string' || !UUID.test(p.id)) throw new UserError('No such template.')
  await createAdminClient().from('rpmail_templates').delete().eq('id', p.id).eq('profile_id', who.id)
  return { ok: true }
}
