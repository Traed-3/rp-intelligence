/**
 * Order emails in Trae's own voice, the way he has been sending them to ICON, Source and Spatco from tdodson.rp:
 *   "ICON Team: Placing this order per take-off GC091026-11 for SU-4710 (Sunoco Exxon, 4710 Williamsburg Rd, Richmond, VA 23231).
 *    Quantities and prices as quoted: … Shannon, can we get a PO# for this? Thank you!"
 * Pure: the plate builds the draft here, stores it on the task, and hands it to the mail client or to the Proton Bridge push.
 */
export type OrderVendorKey = 'icon' | 'icon_support' | 'source' | 'spatco' | 'morgan' | 'other'

export const ORDER_VENDORS: Record<OrderVendorKey, { label: string; to: string; greeting: string }> = {
  icon:   { label: 'ICON Containment',      to: 'orders@icontainment.com',       greeting: 'ICON Team:' },
  icon_support: { label: 'ICON tech support (surveys)', to: 'techsupport@icontainment.com', greeting: 'Gary & Team:' },
  source: { label: 'Source North America',  to: 'ddixon@sourcena.com',           greeting: 'David,' },
  spatco: { label: 'Spatco (RJ Stumpfl)',   to: 'Ronald.Stumpfl@spatco.com',     greeting: 'RJ,' },
  morgan: { label: 'Morgan Brothers',       to: 'sales@morgan-brothers.net',     greeting: 'Erin,' },
  other:  { label: 'Other vendor',          to: '',                              greeting: 'Hello,' },
}

export const ORDER_CC = ['sparsons.rp@gmail.com', 'econstruction.rp@gmail.com']
export const SHIP_TO = 'Rappahannock Petroleum, 225 Ritter Rd., Winchester, VA 22602, ATTN: Starsky Dodson'

export type OrderDraftInput = {
  vendor: OrderVendorKey
  to?: string | null
  site: string
  siteName?: string | null        // "Global Exxon", "Sunoco", "7-Eleven"
  address?: string | null
  workOrder?: string | null
  takeoff?: string | null         // ICON take-off / Source quote number
  items: string                   // one per line, as Trae types them: "(4) IRF 5B3.5x3.2AC - … - $459.00 each"
  shipTo?: string | null
  askPo?: boolean
  note?: string | null
}

export type OrderDraft = { to: string; cc: string[]; subject: string; body: string }

export function buildOrderDraft(i: OrderDraftInput): OrderDraft {
  const v = ORDER_VENDORS[i.vendor] ?? ORDER_VENDORS.other
  const where = [i.siteName, i.address].filter(Boolean).join(', ')
  const ref = i.takeoff ? (i.vendor === 'icon' ? ` per take-off ${i.takeoff}` : ` per your quote ${i.takeoff}`) : ''
  const subject = i.vendor === 'icon'
    ? `${i.site} ICON Material Order${i.takeoff ? ` - Take-Off ${i.takeoff}` : ''}${i.workOrder ? ` - ${i.workOrder}` : ''}`
    : `${i.site} Material Order${i.takeoff ? ` - ${i.takeoff}` : ''}${i.workOrder ? ` - ${i.workOrder}` : ''}`
  const items = i.items.split('\n').map(s => s.trim()).filter(Boolean).join('\n')
  const lines = [
    v.greeting,
    '',
    `Placing this order${ref} for ${i.site}${where ? ` (${where})` : ''}${i.workOrder ? `, work order ${i.workOrder}` : ''}${i.takeoff ? '. Quantities and prices as quoted:' : ':'}`,
    '',
    items || '(items)',
    '',
    `Please confirm pricing and ship date. Ship to ${i.shipTo || SHIP_TO}, marked ${i.site}.`,
  ]
  if (i.note) lines.push('', i.note.trim())
  if (i.askPo !== false) lines.push('', 'Shannon, can we get a PO# for this? Thank you!')
  lines.push('', 'Trae Dodson', 'Rappahannock Petroleum')
  return { to: (i.to || v.to).trim(), cc: ORDER_CC, subject, body: lines.join('\n') }
}

export function mailtoHref(d: OrderDraft): string {
  const q = new URLSearchParams({ cc: d.cc.join(','), subject: d.subject, body: d.body })
  return `mailto:${encodeURIComponent(d.to)}?${q.toString().replace(/\+/g, '%20')}`
}

/**
 * The survey email, the way Trae sends them: "Gary & Team: The following attachment is the survey forms and pics of entry
 * fittings needed. Please let me know if you have any questions." To tech support with orders copied, Shannon + econstruction CC.
 */
export function buildSurveyEmail(i: { site: string; siteName?: string | null; address?: string | null; sumps: string[]; request: 'quote' | 'order' }): OrderDraft {
  const where = [i.siteName, i.address].filter(Boolean).join(', ')
  const subject = `${i.site} ICON Material ${i.request === 'order' ? 'Quote - Order' : 'Quote Request'}${i.sumps.length ? ` (${i.sumps.join(', ')})` : ''}`
  const body = [
    'Gary & Team:',
    '',
    `The following attachment is the survey forms and pics of the entry fittings needed at ${i.site}${where ? ` (${where})` : ''}${i.sumps.length ? `: ${i.sumps.join(', ')}` : ''}. Please put together the part numbers and pricing${i.request === 'order' ? ' so we can place the order' : ''}. Let me know if you have any questions and thank you for your help!`,
    '',
    'Trae Dodson',
    'Rappahannock Petroleum',
  ].join('\n')
  return { to: `${ORDER_VENDORS.icon_support.to}, ${ORDER_VENDORS.icon.to}`, cc: ORDER_CC, subject, body }
}
