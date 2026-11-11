import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInventory } from '@/lib/inventory-guard'
import { signedAttachmentUrl, type Extracted, type ThreadReply } from '@/lib/billing-inbox-sync'
import { InboxDocumentForm, type QueueLine } from '@/components/inventory/inbox-document-form'
import { fmtDate, money } from '@/lib/inventory'

const KIND_LABEL: Record<string, string> = { packing_slip: 'Packing slip', vendor_invoice: 'Vendor invoice', receipt: 'Receipt', vendor_quote: 'Vendor quote', customer_invoice: 'Our invoice', other: 'Paperwork' }

export default async function ReceiveQueueDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { company_id, canWrite } = await requireInventory()
  const admin = createAdminClient()
  const { data: doc } = await admin.from('billing_inbox_documents').select('*, stock_locations(name), profiles(full_name)').eq('id', id).eq('company_id', company_id).maybeSingle()
  if (!doc) notFound()

  const attachments = doc.attachments as { name: string; mime: string; path: string; size: number }[]
  const [urls, { data: locations }, { data: posted }, { data: dupes }] = await Promise.all([
    Promise.all(attachments.map(a => signedAttachmentUrl(a.path))),
    admin.from('stock_locations').select('id, name, kind').eq('company_id', company_id).eq('active', true).in('kind', ['office', 'truck', 'jobsite']).order('kind').order('name'),
    admin.from('inventory_transactions').select('id, qty, unit_cost, created_at, parts(part_number, description), stock_locations(name)').eq('inbox_document_id', id).order('created_at'),
    doc.reference ? admin.from('billing_inbox_documents').select('id, status, received_at, inbox').eq('company_id', company_id).eq('reference', doc.reference).neq('id', id).limit(5) : Promise.resolve({ data: [] as { id: string; status: string; received_at: string; inbox: string }[] }),
  ])
  const ex = doc.extracted as Extracted | null
  const lines: QueueLine[] = (ex?.lines ?? []) as QueueLine[]
  const loc = (doc as unknown as { stock_locations: { name: string } | null }).stock_locations
  const replies = ((doc as unknown as { thread_replies?: ThreadReply[] }).thread_replies ?? [])
  const who = (doc as unknown as { profiles: { full_name: string } | null }).profiles
  const office = (locations ?? []).find(l => l.kind === 'office')
  // Already filed as an expense (by the receipt importer or by hand)? Link to it instead of offering a second one.
  const { data: filedExpense } = doc.kind === 'receipt'
    ? await admin.from('expenses').select('id').eq('company_id', company_id).eq('source_document_id', doc.id).maybeSingle()
    : { data: null }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-5">
        <Link href="/inventory/receive/queue" className="text-sm text-gray-500 hover:text-gray-700">← Receive queue</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{KIND_LABEL[doc.kind] ?? doc.kind}{doc.reference ? <span className="font-mono text-gray-500 text-lg ml-2">#{doc.reference}</span> : null}</h1>
            <p className="text-sm text-gray-500">{doc.vendor ?? doc.sender}{doc.document_date ? ` · dated ${fmtDate(doc.document_date)}` : ''} · arrived {fmtDate(doc.received_at)} in {doc.inbox}</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            {doc.status !== 'new' && <div>{doc.status.replace('_', ' ')} {doc.processed_at ? fmtDate(doc.processed_at) : ''}{who ? ` by ${who.full_name}` : ''}{loc ? ` → ${loc.name}` : ''}</div>}
            {ex?.total != null && <div>Document total {money(ex.total)}{ex.tax != null ? ` · tax ${money(ex.tax)}` : ''}{ex.freight != null ? ` · freight ${money(ex.freight)}` : ''}</div>}
            {doc.kind === 'receipt' && filedExpense && (
              <Link href={`/expenses/${filedExpense.id}`} className="inline-block mt-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400">
                View expense ({doc.sender || doc.sender_email})
              </Link>
            )}
            {doc.kind === 'receipt' && !filedExpense && canWrite && (
              <Link href={`/expenses/new?doc=${doc.id}`} className="inline-block mt-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400">
                Record as expense ({doc.sender || doc.sender_email})
              </Link>
            )}
          </div>
        </div>
      </div>

      {(dupes ?? []).length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Same document number seen before: {(dupes ?? []).map(d => <Link key={d.id} href={`/inventory/receive/queue/${d.id}`} className="underline mr-2">{fmtDate(d.received_at)} ({d.status.replace('_', ' ')})</Link>)} — make sure this isn&apos;t a duplicate before posting.
        </div>
      )}
      {ex?.notes && <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900"><b>Noted on the document:</b> {ex.notes}{ex.po_or_job ? ` · PO/job: ${ex.po_or_job}` : ''}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-4">
          <InboxDocumentForm docId={doc.id} status={doc.status} kind={doc.kind} vendor={doc.vendor} reference={doc.reference} documentDate={doc.document_date} lines={lines}
            locations={locations ?? []} defaultLocation={office?.id ?? null} canWrite={canWrite} extractStatus={doc.extract_status} extractError={doc.extract_error} />

          {(posted ?? []).length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-100">Posted to the ledger</h2>
              <table className="w-full text-sm"><tbody className="divide-y divide-gray-50">
                {(posted ?? []).map(t => { const p = (t as unknown as { parts: { part_number: string | null; description: string } | null }).parts; const l = (t as unknown as { stock_locations: { name: string } | null }).stock_locations; return (
                  <tr key={t.id}><td className="px-5 py-2"><div className="text-gray-900">{p?.description}</div><div className="text-xs font-mono text-gray-400">{p?.part_number ?? ''}</div></td><td className="px-4 py-2 text-right tabular-nums text-green-700 font-medium">+{Number(t.qty)}</td><td className="px-4 py-2 text-right tabular-nums text-gray-600">{t.unit_cost != null ? money(Number(t.unit_cost)) : '—'}</td><td className="px-4 py-2 text-gray-600">{l?.name}</td></tr>) })}
              </tbody></table>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <h2 className="px-5 py-3 font-semibold text-gray-900 border-b border-gray-100">Attachments</h2>
            <ul className="divide-y divide-gray-50">
              {attachments.map((a, i) => (
                <li key={a.path} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="text-gray-900 truncate">{a.name}</span><span className="text-xs text-gray-400 whitespace-nowrap">{Math.round(a.size / 1024)} KB</span></div>
                  {urls[i] ? (
                    /^image\//.test(a.mime) ? <a href={urls[i]!} target="_blank" rel="noopener"><img src={urls[i]!} alt={a.name} className="mt-2 rounded-lg border border-gray-200 max-h-96 object-contain" /></a>
                    : /pdf/.test(a.mime) ? <><iframe src={urls[i]!} title={a.name} className="mt-2 w-full h-[520px] rounded-lg border border-gray-200" /><a href={urls[i]!} target="_blank" rel="noopener" className="text-xs text-blue-600 mt-1 inline-block">Open full size ↗</a></>
                    : <a href={urls[i]!} target="_blank" rel="noopener" className="text-xs text-blue-600 mt-1 inline-block">Download ↗</a>
                  ) : <span className="text-xs text-red-600">link unavailable</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-sm">
            <div className="font-semibold text-gray-900 mb-1">{doc.subject}</div>
            <div className="text-xs text-gray-400 mb-3">{doc.sender} &lt;{doc.sender_email}&gt;</div>
            <p className="text-gray-600 whitespace-pre-line text-xs leading-relaxed">{doc.body_preview}</p>
            {doc.note && <p className="mt-3 text-xs text-gray-500"><b>Note:</b> {doc.note}</p>}
            {replies.length > 0 && (
              <div className="mt-3 text-xs">
                <div className="font-semibold text-gray-700">Replies in the thread</div>
                <ul className="mt-1 space-y-1">
                  {replies.map(r => <li key={r.message_id} className="text-gray-700"><span className="text-gray-400">{new Date(r.at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} · {r.from}:</span> {r.text}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
