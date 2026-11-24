import { createRoot } from 'react-dom/client'
import { RpmailApp } from '@/components/rpmail/rpmail-app'
import { RpmailSettings } from '@/components/rpmail/rpmail-settings'
import RpmailHelpPage from '@/app/(app)/help/rpmail/page'
import { keptWording } from '@/lib/rpmail/rich'
import { replyQuoteHtml } from '@/lib/rpmail/rich'
import { uploads } from './supabase-shim'

// A stand-in for the server: a mailbox with a few conversations, held in memory. Nothing leaves this page.
type M = { id: string; t: string; name: string; addr: string; to: string; date: number; subject: string; text: string; html?: string; unread?: boolean; sent?: boolean; inbox?: boolean; files?: { name: string; size: number }[] }
const BOX = 'box1', ME = 'ann@gmail.com', now = Date.now(), H = 3_600_000
const gq = (who: string, body: string) => `<div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Mon, Nov 23, 2026 at 9:00 AM ${who} wrote:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote></div>`
const msgs: M[] = [
  { id: 'a1', t: 'T1', name: 'Pat Vendor', addr: 'pat@vendor.com', to: ME, date: now - 50 * H, subject: 'Parts for 34006', inbox: true,
    text: 'Hi Ann,\n\nCan you confirm the order for 34006? We need the count of spill buckets by Friday.\n\nPat', html: '<div dir="ltr">Hi Ann,<div><br></div><div>Can you confirm the order for 34006? We need the count of spill buckets by Friday.</div><div><br></div><div>Pat</div></div>' },
  { id: 'a2', t: 'T1', name: 'Ann Owner', addr: ME, to: 'pat@vendor.com', date: now - 30 * H, subject: 'Re: Parts for 34006', sent: true,
    text: 'Confirmed:\n- 4 spill buckets\n- 2 drop tubes\n\nOn Mon, Pat Vendor <pat@vendor.com> wrote:\n> Hi Ann,\n> Can you confirm the order for 34006?',
    html: '<div dir="ltr"><div><b>Confirmed:</b></div><ul><li>4 spill buckets</li><li>2 drop tubes</li></ul><div><br></div>' + replyQuoteHtml('On Mon, Pat Vendor <pat@vendor.com> wrote:', 'Hi Ann,\nCan you confirm the order for 34006?') + '</div>' },
  { id: 'a3', t: 'T1', name: 'Pat Vendor', addr: 'pat@vendor.com', to: ME, date: now - 2 * H, subject: 'Re: Parts for 34006', unread: true, inbox: true, files: [{ name: 'packing-list.pdf', size: 48_000 }, { name: 'photo.jpg', size: 912_000 }],
    text: 'Thanks. Shipping Tuesday, tracking to follow.\n\nOn Mon, Nov 23, 2026 at 9:00 AM Ann Owner <ann@gmail.com> wrote:\n> Confirmed:\n> - 4 spill buckets\n> - 2 drop tubes',
    html: '<div dir="ltr">Thanks. Shipping Tuesday, tracking to follow.</div><br>' + gq('Ann Owner &lt;ann@gmail.com&gt;', '<div><b>Confirmed:</b></div><ul><li>4 spill buckets</li><li>2 drop tubes</li></ul>') },
  ...Array.from({ length: 12 }, (_, i): M => ({ id: 'b' + i, t: 'T2', name: i % 2 ? 'Ann Owner' : 'Bo Inspector', addr: i % 2 ? ME : 'bo@county.gov', to: i % 2 ? 'bo@county.gov' : ME, date: now - (200 - i * 10) * H,
    subject: (i ? 'Re: ' : '') + 'Permit inspection SU-4710', sent: !!(i % 2), unread: i >= 10, inbox: !(i % 2), text: `Message number ${i + 1} about the inspection window.\n\n> earlier text\n> more earlier text` })),
  { id: 'c1', t: 'T3', name: 'Shop News', addr: 'newsletter@shop.com', to: ME, date: now - 5 * H, subject: 'November specials', inbox: true, text: 'November specials\nBig savings on fittings.',
    html: '<table width="600"><tr><td><img src="https://example.com/banner.png" width="600" height="200" alt="banner"><h1>November specials</h1><p>Big savings on fittings.</p>' + '<p>More text here to make this long.</p>'.repeat(30) + '</td></tr></table>' },
  { id: 'd1', t: 'T4', name: 'Ann Owner', addr: ME, to: 'crew@rp.com', date: now - 8 * H, subject: 'Fwd: Drawing', sent: true, text: 'FYI\n\n---------- Forwarded message ---------\nFrom: Pat\n\nSee the drawing.',
    html: '<div dir="ltr">FYI<br><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: Pat</div><br>See the drawing.</div></div>' },
  { id: 'e1', t: 'T5', name: 'Solo Tech', addr: 'solo@rp.com', to: ME, date: now - 9 * H, subject: 'Truck Q17 back in service', inbox: true, unread: true, text: 'Q17 is back from the shop.' },
]
// Drafts saved in Gmail Drafts. Sending one takes it off this list, as Gmail does.
const drafts = [
  { id: 'r1', date: now - 26 * H, to: 'bo@county.gov', subject: 'Inspection window for SU-4710', text: 'Bo, can we move the inspection to Thursday?', html: '<div>Bo, can we move the inspection to <b>Thursday</b>?</div>', files: [{ i: 0, name: 'site-plan.pdf', size: 210_000 }] },
  { id: 'r2', date: now - 3 * H, to: '', subject: '', text: 'Notes for Monday', html: '<div>Notes for Monday</div><ul><li>Order drop tubes</li></ul>', files: [] as { i: number; name: string; size: number }[] },
]
const sentLog: unknown[] = []
;(window as unknown as { __sent: unknown[]; __uploads: Map<string, File> }).__sent = sentLog
;(window as unknown as { __uploads: Map<string, File> }).__uploads = uploads
const MY_ID = '11111111-1111-4111-8111-111111111111'
// A sent picture is shown as a grey box: the real thing travels inside the mail, which this page does not make.
const PICTURE = `<img alt="picture" src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#cfd6e0"/><text x="120" y="66" font-size="16" text-anchor="middle" fill="#445">picture</text></svg>')}">`
const item = (m: M) => ({ mailbox_id: BOX, id: m.id, thread_id: m.t, date: m.date, from_name: m.name, from_addr: m.addr, to_addrs: m.to, subject: m.subject, snippet: m.text.split('\n')[0].slice(0, 120), unread: !!m.unread, starred: false, has_att: !!m.files?.length, in_inbox: !!m.inbox, sent: !!m.sent, site: null, po: null, labels: [] })
// The signature and the templates start out formatted, and remember what is saved while the page is open.
const sig = { text: 'Ann Owner\nRappahannock Petroleum', html: '<div><b>Ann Owner</b></div><div><i>Rappahannock Petroleum</i></div>' as string | null }
const templates: { id: string; name: string; body: string; html: string | null }[] = [
  { id: 't1', name: 'Permit received', body: 'The permit is in hand.\n- Work can start Monday\n- Call before you dig', html: '<div>The <b>permit</b> is in hand.</div><ul><li>Work can start Monday</li><li>Call before you dig</li></ul>' },
  { id: 't2', name: 'Plain thanks', body: 'Thanks, got it.', html: null },
]
const box = () => ({ id: BOX, name: 'Ann', address: ME, kind: 'personal', crew_reads: false, connected: true, inbox: msgs.filter(m => m.inbox).length, unread: msgs.filter(m => m.unread).length, newest: now, needs: 0, last_sync_at: new Date().toISOString(), last_error: null, loading: null, signature: sig.text, signature_html: sig.html, can_send: true, can_delete: true })
const state = () => ({ enabled: true, name: 'Ann Owner', role: 'owner', googleReady: true, personalAddress: ME, loginEmail: ME, boxes: [box()], note: null, prefs: { hidden: [], order: [], undo_secs: 0 } })
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin)
  const op = url.pathname.replace('/api/rpmail/', ''), q = url.searchParams
  const body = init?.body ? JSON.parse(String(init.body)) : {}
  await new Promise(r => setTimeout(r, op === 'message' ? 350 : 60))
  if (op === 'state') return json(state())
  if (op === 'overview') {
    // A plate item and a job line, so the dashboard's Done buttons can be seen.
    const plate = [{ id: 'p1', title: '41333 testing-failure repair: schedule + report', detail: 'Waiting on the report from Dave', kind: 'task', site_number: '41333', priority: 2, due_date: null, status: 'open', waiting_on: null, mail: null, mail_n: 0 }]
    const job = item(msgs.find(m => m.id === 'a3')!)
    return json({ prefs: state().prefs, boxes: [box()], needs: [job], foryou: [{ ...job, why: 'Site 34006' }], plate: { items: plate, error: null }, summary: null, moves: [], now: Date.now() })
  }
  if (op === 'sync') return json({ done: true })
  if (op === 'labels') return json({ labels: [], can_edit: true })
  if (op === 'templates') return json({ templates })
  if (op === 'template_save') { const k = keptWording(body.html, body.body, 20_000); templates.push({ id: 't' + (templates.length + 1), name: String(body.name), body: k.text, html: k.html }); sentLog.push({ template: body }); return json({ ok: true }) }
  if (op === 'signature') { const k = keptWording(body.html, body.text, 4000); sig.text = k.text; sig.html = k.html; sentLog.push({ signature: body }); return json({ ok: true, ...k }) }
  if (op === 'prefs') return json({ prefs: { ...state().prefs, ...body } })
  if (op === 'contacts') return json({ contacts: [] })
  if (op === 'drafts') return json({ drafts: drafts.map(d => ({ id: d.id, thread_id: d.id, date: d.date, to: d.to, subject: d.subject, snippet: d.text.slice(0, 80) })) })
  if (op === 'draft_open') { const d = drafts.find(x => x.id === q.get('draft')); return d ? json({ draft: d.id, to: d.to, cc: '', subject: d.subject, html: d.html, reply: false, attachments: d.files }) : json({ error: 'That draft is no longer in Gmail.' }, 400) }
  if (op === 'attach_prepare') return json({ path: `${MY_ID}/${crypto.randomUUID()}/${String(body.name)}`, token: 'tok' })
  if (op === 'attach_remove') { uploads.delete(String(body.path)); return json({ ok: true }) }
  if (op === 'messages') {
    const by = new Map<string, M[]>()
    for (const m of msgs) by.set(m.t, [...(by.get(m.t) ?? []), m])
    const rows = [...by.values()].map(g => { const n = [...g].sort((a, b) => b.date - a.date)[0]; return { ...item(n), unread: g.some(x => x.unread), count: g.length } }).sort((a, b) => b.date - a.date)
    return json({ messages: rows })
  }
  if (op === 'message') {
    const m = msgs.find(x => x.id === q.get('id'))
    if (!m) return json({ error: 'That message is no longer in Gmail.' }, 400)
    if (m.id === 'b3') return json({ error: 'Gmail is busy with this mailbox right now. Try again in a moment.' }, 429)
    return json({ ...item(m), cc_addrs: '', to_full: m.to, cc_full: '', text: m.text, html: m.html ?? null, done: false, hidden: false,
      attachments: (m.files ?? []).map((f, i) => ({ i, name: f.name, type: 'application/pdf', size: f.size, inline: false })),
      thread: msgs.filter(x => x.t === m.t && x.id !== m.id).sort((a, b) => a.date - b.date).map(x => { const i = item(x); return { id: i.id, date: i.date, from_name: i.from_name, from_addr: i.from_addr, to_addrs: i.to_addrs, snippet: i.snippet, unread: i.unread, sent: i.sent } }) })
  }
  if (op === 'draft_prep') {
    const m = msgs.find(x => x.id === q.get('id'))!
    return json({ from: ME, to: m.addr, cc: '', subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, quoted: 'On Mon, ' + m.name + ' wrote:\n> ' + m.text.split('\n').join('\n> '), forward: false, attachments: [], signature: sig.text, signature_html: sig.html })
  }
  if (op === 'send') {
    sentLog.push(body)
    if (body.draft_id && !body.draft) drafts.splice(drafts.findIndex(d => d.id === body.draft_id), 1)
    const src = msgs.find(x => x.id === body.id)
    if (!body.draft) msgs.push({ id: 's' + sentLog.length, t: src?.t ?? 'TS' + sentLog.length, name: 'Ann Owner', addr: ME, to: body.to, date: Date.now(), subject: body.subject, sent: true, text: body.body, html: body.html ? String(body.html).replace(/<img src="\/api\/rpmail\/attach_view[^"]*">/g, PICTURE) : undefined })
    return json({ ok: true, sent: true, to: body.to, from: ME })
  }
  if (op === 'mark') { for (const m of msgs) { const src = msgs.find(x => x.id === body.id); if (src && m.t === src.t && !body.unread) m.unread = false; if (m.id === body.id && body.unread) m.unread = true } return json({ ok: true }) }
  return json({ ok: true, moves: [], n: 0, templates: [], labels: [], rules: [], blocks: [], items: [] })
}

// Add #settings to the address for the person's own Settings page, or #help for the RPMail guide, instead of the mail page.
createRoot(document.getElementById('root')!).render(<div className="p-4 sm:p-6 max-w-[1500px] mx-auto">{location.hash === '#settings' ? <RpmailSettings /> : location.hash === '#help' ? <RpmailHelpPage /> : <RpmailApp localUrl={null} />}</div>)
