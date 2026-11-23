import { NextRequest, NextResponse } from 'next/server'
import { me, requireMe, mailboxFor, Forbidden, type Me } from '@/lib/rpmail/access'
import { Busy, NotConnected, UserError } from '@/lib/rpmail/gmail'
import { syncMailbox } from '@/lib/rpmail/sync'
import { state, overview } from '@/lib/rpmail/overview'
import { notifyTest } from '@/lib/rpmail/background'
import { plateDone, plateAdd } from '@/lib/rpmail/overview'
import { listMessages, searchGmail, readMessage, readAttachment, markRead, fileMessage, undoMove, markDone, setSignature, draftPrep, sendMail } from '@/lib/rpmail/mail-ops'
import { setPrefs, doneList, setStar, bulk } from '@/lib/rpmail/extras'
import { attachPrepare, attachRemove, contacts, templateList, templateSave, templateDelete } from '@/lib/rpmail/compose-ops'
import { setEnabled, disconnect, oauthStart, adminState, adminSetUser, adminSaveShared, adminDeleteShared, adminGrant } from '@/lib/rpmail/connect'

// RPMail API. One address per action: /api/rpmail/<op>.
// Every action needs a signed-in person (proxy.ts) and, for anything that touches mail, RPMail turned on for that
// person and the mailbox on their own login (lib/rpmail/access.ts). Nothing here is decided by role alone.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Q = Record<string, string>
type B = Record<string, unknown>

// Reads. `any` = works before RPMail is turned on (the setup screen needs it).
const GETS: Record<string, { any?: boolean; run: (who: Me, q: Q, req: NextRequest) => Promise<unknown> }> = {
  state: { any: true, run: who => state(who) },
  overview: { run: who => overview(who) },
  messages: { run: (who, q) => listMessages(who, q) },
  message: { run: (who, q) => readMessage(who, q) },
  attachment: { run: (who, q) => readAttachment(who, q) },
  contacts: { run: (who, q) => contacts(who, q) },
  templates: { run: who => templateList(who) },
  done_list: { run: who => doneList(who) },
  draft_prep: { run: (who, q) => draftPrep(who, q) },
  connect: { any: true, run: async (who, q, req) => NextResponse.redirect(await oauthStart(who, q.mailbox, req.nextUrl.origin)) },
  admin_state: { any: true, run: who => adminState(who) },
}

// Changes. All are POST with a JSON body, from this site only.
const POSTS: Record<string, { any?: boolean; run: (who: Me, b: B) => Promise<unknown> }> = {
  enable: { any: true, run: (who, b) => setEnabled(who, b.on !== false) },
  disconnect: { any: true, run: (who, b) => disconnect(who, b) },
  sync: { run: async (who, b) => syncMailbox(await mailboxFor(who, b.mailbox)) },
  search: { run: (who, b) => searchGmail(who, b) },
  mark: { run: (who, b) => markRead(who, b) },
  file: { run: (who, b) => fileMessage(who, b) },
  undo: { run: (who, b) => undoMove(who, b) },
  done: { run: (who, b) => markDone(who, b) },
  attach_prepare: { run: (who, b) => attachPrepare(who, b) },
  attach_remove: { run: (who, b) => attachRemove(who, b) },
  template_save: { run: (who, b) => templateSave(who, b) },
  template_delete: { run: (who, b) => templateDelete(who, b) },
  prefs: { run: (who, b) => setPrefs(who, b) },
  notify_test: { run: who => notifyTest(who) },
  star: { run: (who, b) => setStar(who, b) },
  bulk: { run: (who, b) => bulk(who, b) },
  signature: { run: (who, b) => setSignature(who, b) },
  send: { run: (who, b) => sendMail(who, b) },
  plate_done: { run: (who, b) => plateDone(who, b) },
  plate_add: { run: (who, b) => plateAdd(who, b) },
  admin_user: { any: true, run: (who, b) => adminSetUser(who, b) },
  admin_shared: { any: true, run: (who, b) => adminSaveShared(who, b) },
  admin_shared_delete: { any: true, run: (who, b) => adminDeleteShared(who, b) },
  admin_grant: { any: true, run: (who, b) => adminGrant(who, b) },
}

function fail(e: unknown) {
  if (e instanceof Forbidden) return NextResponse.json({ error: e.message }, { status: 403 })
  if (e instanceof NotConnected) return NextResponse.json({ error: e.message, notConnected: true }, { status: 409 })
  if (e instanceof Busy) return NextResponse.json({ error: e.message, busy: true }, { status: 503 })
  if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 })
  // Never echo an unexpected error to the browser, and never log request bodies (they can hold mail text).
  console.error('rpmail:', e instanceof Error ? e.message.slice(0, 300) : 'error')
  return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
}

async function person(any: boolean | undefined): Promise<Me> {
  if (!any) return requireMe()
  const who = await me()
  if (!who) throw new Forbidden('Sign in first.')
  return who
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ op: string }> }) {
  const { op } = await ctx.params
  const h = GETS[op]
  if (!h) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const who = await person(h.any)
    const out = await h.run(who, Object.fromEntries(req.nextUrl.searchParams), req)
    return out instanceof Response ? out : NextResponse.json(out, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    if (op === 'connect' && (e instanceof UserError || e instanceof Forbidden)) {
      return NextResponse.redirect(new URL('/rpmail?connect_error=' + encodeURIComponent(e.message), req.nextUrl.origin))
    }
    return fail(e)
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ op: string }> }) {
  const { op } = await ctx.params
  const h = POSTS[op]
  if (!h) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Changes are only accepted from this site's own pages.
  const origin = req.headers.get('origin')
  if (!origin || new URL(origin).host !== req.nextUrl.host || !(req.headers.get('content-type') ?? '').includes('application/json')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const who = await person(h.any)
    const body = await req.json().catch(() => ({})) as B
    return NextResponse.json(await h.run(who, body && typeof body === 'object' ? body : {}), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return fail(e)
  }
}
