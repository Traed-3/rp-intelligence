import { createRoot } from 'react-dom/client'
import { RpmailApp } from '@/components/rpmail/rpmail-app'
import { replyQuoteHtml } from '@/lib/rpmail/rich'

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
const sentLog: unknown[] = []
;(window as unknown as { __sent: unknown[] }).__sent = sentLog
const item = (m: M) => ({ mailbox_id: BOX, id: m.id, thread_id: m.t, date: m.date, from_name: m.name, from_addr: m.addr, to_addrs: m.to, subject: m.subject, snippet: m.text.split('\n')[0].slice(0, 120), unread: !!m.unread, starred: false, has_att: !!m.files?.length, in_inbox: !!m.inbox, sent: !!m.sent, site: null, po: null, labels: [] })
const box = () => ({ id: BOX, name: 'Ann', address: ME, kind: 'personal', crew_reads: false, connected: true, inbox: msgs.filter(m => m.inbox).length, unread: msgs.filter(m => m.unread).length, newest: now, needs: 0, last_sync_at: new Date().toISOString(), last_error: null, loading: null, signature: 'Ann Owner\nRappahannock Petroleum', can_send: true, can_delete: true })
const state = () => ({ enabled: true, name: 'Ann Owner', role: 'owner', googleReady: true, personalAddress: ME, loginEmail: ME, boxes: [box()], note: null, prefs: { hidden: [], order: [], undo_secs: 0 } })
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), location.origin)
  const op = url.pathname.replace('/api/rpmail/', ''), q = url.searchParams
  const body = init?.body ? JSON.parse(String(init.body)) : {}
  await new Promise(r => setTimeout(r, op === 'message' ? 350 : 60))
  if (op === 'state') return json(state())
  if (op === 'overview') return json({ prefs: state().prefs, boxes: [box()], needs: [], foryou: [], plate: { items: [], error: null }, summary: null, moves: [], now: Date.now() })
  if (op === 'sync') return json({ done: true })
  if (op === 'labels') return json({ labels: [], can_edit: true })
  if (op === 'templates') return json({ templates: [{ id: 't1', name: 'Permit received', body: 'The permit is in hand.\nWork can start Monday.' }] })
  if (op === 'contacts') return json({ contacts: [] })
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
    return json({ from: ME, to: m.addr, cc: '', subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, quoted: 'On Mon, ' + m.name + ' wrote:\n> ' + m.text.split('\n').join('\n> '), forward: false, attachments: [], signature: 'Ann Owner\nRappahannock Petroleum' })
  }
  if (op === 'send') {
    sentLog.push(body)
    const src = msgs.find(x => x.id === body.id)
    if (!body.draft) msgs.push({ id: 's' + sentLog.length, t: src?.t ?? 'TS' + sentLog.length, name: 'Ann Owner', addr: ME, to: body.to, date: Date.now(), subject: body.subject, sent: true, text: body.body, html: body.html })
    return json({ ok: true, sent: true, to: body.to, from: ME })
  }
  if (op === 'mark') { for (const m of msgs) { const src = msgs.find(x => x.id === body.id); if (src && m.t === src.t && !body.unread) m.unread = false; if (m.id === body.id && body.unread) m.unread = true } return json({ ok: true }) }
  return json({ ok: true, moves: [], n: 0, templates: [], labels: [], rules: [], blocks: [], items: [] })
}

createRoot(document.getElementById('root')!).render(<div className="p-4 sm:p-6 max-w-[1500px] mx-auto"><RpmailApp localUrl={null} /></div>)
