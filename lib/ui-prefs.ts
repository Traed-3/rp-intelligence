import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-person layout choices, stored in profiles.ui_prefs and edited on
 * Settings → Personalize. These only change what a person SEES and in what
 * order. They never grant access: every list is filtered by role and module
 * access first, and the choices are applied on top.
 */
export type ListPref = { order?: string[]; hidden?: string[] }
export type UiPrefs = { dashboard?: ListPref; nav?: ListPref; tabs?: string[] }

/** Most tabs that fit the phone bottom bar next to "More" without crowding. */
export const MAX_TABS = 5

const strings = (v: unknown, max = 40): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 80))].slice(0, max) : []

const listPref = (v: unknown): ListPref | undefined => {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const order = strings(o.order), hidden = strings(o.hidden)
  return order.length || hidden.length ? { order, hidden } : undefined
}

/** Anything unexpected in the stored value is dropped, so a bad row can never break a page. */
export function parsePrefs(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const out: UiPrefs = {}
  const d = listPref(o.dashboard); if (d) out.dashboard = d
  const n = listPref(o.nav); if (n) out.nav = n
  const t = strings(o.tabs, MAX_TABS); if (t.length) out.tabs = t
  return out
}

/**
 * Put a list in the person's order and mark what they hid. Items they have
 * never seen (new modules, new cards) keep their default place at the end and
 * start visible. `locked` keys can be moved but never hidden.
 */
export function arrange<T extends { key: string }>(items: T[], pref?: ListPref, locked: string[] = []): (T & { hidden: boolean })[] {
  const rank = new Map((pref?.order ?? []).map((k, i) => [k, i]))
  const hidden = new Set(pref?.hidden ?? [])
  return items
    .map((item, i) => ({ item, at: rank.has(item.key) ? rank.get(item.key)! : 1000 + i }))
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => ({ ...item, hidden: hidden.has(item.key) && !locked.includes(item.key) }))
}

export const visible = <T extends { key: string }>(items: T[], pref?: ListPref, locked: string[] = []): T[] =>
  arrange(items, pref, locked).filter(i => !i.hidden)

/** Reads the person's choices. Falls back to defaults on any error so a page never fails over a preference. */
export async function loadUiPrefs(admin: SupabaseClient, profileId: string): Promise<UiPrefs> {
  try {
    const { data, error } = await admin.from('profiles').select('ui_prefs').eq('id', profileId).maybeSingle()
    if (error) return {}
    return parsePrefs((data as { ui_prefs?: unknown } | null)?.ui_prefs)
  } catch {
    return {}
  }
}
