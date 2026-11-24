/**
 * Tools & supplies bought for a truck/asset, plus the repeat-purchase check
 * that tells management "this was already bought recently — find out why".
 */

import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export const TOOL_STATUSES = ['on_truck', 'lost', 'replaced', 'consumed', 'removed'] as const
export type ToolStatus = (typeof TOOL_STATUSES)[number]

export const TOOL_STATUS_LABEL: Record<ToolStatus, string> = {
  on_truck: 'On truck',
  lost: 'Lost',
  replaced: 'Replaced',
  consumed: 'Used up',
  removed: 'Removed',
}

export const DEFAULT_REPEAT_WINDOW_MONTHS = 12

export interface ToolType {
  id: string
  name: string
  kind: 'tool' | 'supply' | 'fluid'
  repeat_window_months: number
}

export interface ToolItemLite {
  id: string
  type_id: string | null
  item_name: string
  quantity: number
  total_cost: number
  purchased_on: string
}

/** "Extension Cords" and "extension cord" match; free-text fallback when no type is picked. */
export function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ')
}

function monthsApart(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.abs((da.getTime() - db.getTime()) / (86400000 * 30.4375))
}

/** Earlier/later purchases of the same item type on the same asset inside the watch window. */
export function findRepeats(
  existing: ToolItemLite[],
  candidate: { id?: string; type_id: string | null; item_name: string; purchased_on: string },
  windowMonths: number,
): ToolItemLite[] {
  const wanted = normalizeItemName(candidate.item_name)
  return existing
    .filter((e) => e.id !== candidate.id)
    .filter((e) =>
      candidate.type_id && e.type_id
        ? e.type_id === candidate.type_id
        : normalizeItemName(e.item_name) === wanted,
    )
    .filter((e) => monthsApart(e.purchased_on, candidate.purchased_on) <= windowMonths)
    .sort((a, b) => b.purchased_on.localeCompare(a.purchased_on))
}

export async function loadRepeatsForNewItem(
  admin: AdminClient,
  args: {
    assetId: string
    typeId: string | null
    itemName: string
    purchasedOn: string
    windowMonths: number
    excludeId?: string
  },
): Promise<ToolItemLite[]> {
  const { data } = await admin
    .from('asset_tool_items')
    .select('id, type_id, item_name, quantity, total_cost, purchased_on')
    .eq('asset_id', args.assetId)
  return findRepeats(
    (data ?? []).map((r) => ({ ...r, quantity: Number(r.quantity), total_cost: Number(r.total_cost) })),
    { id: args.excludeId, type_id: args.typeId, item_name: args.itemName, purchased_on: args.purchasedOn },
    args.windowMonths,
  )
}
