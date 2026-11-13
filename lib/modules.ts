/**
 * The blockable app sections for per-user module access (Settings → Users).
 * `prefixes` are the route prefixes proxy.ts checks a request's path against
 * to decide which module (if any) it belongs to — kept here as the single
 * source of truth so the enforcement (proxy.ts), the nav (app-nav.tsx) and
 * the Settings checklist all agree on the same list.
 *
 * Deliberately NOT covered yet: /mobile (its screens span several of these
 * modules — clock-in is Shop, field tickets are Service Dispatch, etc. — so
 * a per-page mapping is future work), and anything not listed here
 * (/dashboard, /settings, /calendar, /expenses, /notifications, /review) —
 * those always stay reachable.
 */
export const MODULES = [
  { key: 'maintenance',     label: 'Maintenance & Assets', prefixes: ['/maintenance', '/assets'] },
  { key: 'shop',            label: 'Shop & Time Clock',     prefixes: ['/shop', '/time'] },
  { key: 'tickets',         label: 'Repair Tickets',        prefixes: ['/tickets'] },
  { key: 'construction',    label: 'Construction',          prefixes: ['/construction'] },
  { key: 'service_dispatch', label: 'Service Dispatch',     prefixes: ['/service'] },
  { key: 'billing',         label: 'Quotes & Invoices',     prefixes: ['/billing'] },
  { key: 'inventory',       label: 'Inventory',             prefixes: ['/inventory'] },
  { key: 'reports_payroll', label: 'Reports & Payroll',     prefixes: ['/reports'] },
  { key: 'compliance',      label: 'DQF & Certifications',  prefixes: ['/compliance'] },
] as const

export type ModuleKey = typeof MODULES[number]['key']
export const MODULE_KEYS = MODULES.map(m => m.key) as ModuleKey[]

export function moduleLabel(key: string): string {
  return MODULES.find(m => m.key === key)?.label ?? key
}

/** Which module (if any) a request path belongs to. */
export function moduleForPath(pathname: string): ModuleKey | null {
  // The Forms section (surveys, test reports) lives under /construction/surveys but is its own section:
  // a Construction block on a service tech must not take their forms away.
  if (pathname === '/construction/surveys' || pathname.startsWith('/construction/surveys/')) return null
  for (const m of MODULES) {
    if (m.prefixes.some(p => pathname.startsWith(p))) return m.key
  }
  return null
}
