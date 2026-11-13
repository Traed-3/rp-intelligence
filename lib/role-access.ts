// ============================================================
// Role lockdown (Trae, 11/13/26): field and shop roles are DENY BY DEFAULT.
//   - service techs, construction techs and mechanics never see anything accounting related (Quotes & Invoices,
//     Expenses, Reports & Payroll, card audit, vendor paperwork) or HR related (DQF & Certs).
//   - shop employees only see the shop side: Maintenance & Fleet, Assets, Repair Tickets, Shop & Time Clock.
// PURE module (no server-only imports): proxy.ts enforces it on every request, lib/nav-items.ts hides the links.
// A page that is not listed here is closed to these roles, so anything new stays hidden until it is added on purpose.
// ============================================================

export const FIELD_ROLES: readonly string[] = ['service_tech', 'construction_tech', 'mechanic']
export const SHOP_ONLY_ROLES: readonly string[] = ['shop_employee']

type R = string | null | undefined

export const isFieldRole = (role: R) => FIELD_ROLES.includes(role ?? '')
export const isShopOnly = (role: R) => SHOP_ONLY_ROLES.includes(role ?? '')
/** Roles that go through the allowlist below. Everyone else is governed by the per-module guards as before. */
export const isLockedRole = (role: R) => isFieldRole(role) || isShopOnly(role)
/** Accounting and HR are closed to these roles no matter what else is granted (the DQF access list included). */
export const noAccountingOrHr = (role: R) => isLockedRole(role)

/** Settings (every page under it, Personalize and Alerts included) is for owners, managers and admins only. */
export const SETTINGS_ROLES: readonly string[] = ['owner', 'manager', 'construction_manager', 'construction_admin']
export const canUseSettings = (role: R) => SETTINGS_ROLES.includes(role ?? '')
const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(p + '/')

/** Forms section (surveys, test reports): service techs and construction techs, never mechanics or shop employees. */
const FORMS_PATHS = ['/forms', '/construction/surveys', '/api/construction/surveys', '/api/construction/survey-photos']

// The shop side of the app.
const SHOP_PAGES = ['/maintenance', '/assets', '/tickets', '/shop', '/time', '/notifications']
const SHOP_MOBILE = ['/mobile/report-issue', '/mobile/mileage', '/mobile/ticket']
const SHOP_API = ['/api/assistant', '/api/push', '/api/upload', '/api/tickets', '/api/auth', '/api/daily-summary']

// Techs and mechanics also get the field side. Not here on purpose: /billing, /expenses, /reports, /compliance,
// /review, /my, /inventory/receive (vendor invoices and packing slips) and the rest of /construction.
const FIELD_PAGES = [
  ...SHOP_PAGES, '/dashboard', '/mobile', '/service', '/calendar', '/forms', '/construction/surveys',
  '/inventory/parts', '/inventory/stock', '/inventory/transfers', '/inventory/locations',
  '/expenses/new',   // turn in their own receipt (photo-first form); the expense list, reports and card audit stay closed
]
const FIELD_API = [...SHOP_API, '/api/inventory', '/api/construction/surveys', '/api/construction/survey-photos', '/api/construction/sites/search', '/api/expenses/scan']

// Hub pages opened by exact address only (their sub-pages are listed one by one above).
const SHOP_EXACT = ['/', '/mobile']
const FIELD_EXACT = [...SHOP_EXACT, '/inventory']

export const SHOP_HOME = '/maintenance'
export const FIELD_HOME = '/dashboard'
/** Where a locked role is sent when it asks for a page it may not have. */
export const lockedRoleHome = (role: R) => (isShopOnly(role) ? SHOP_HOME : FIELD_HOME)

/** May this role open this path? Roles that are not locked are only held to the Settings rule here. */
export function roleMayVisit(role: R, pathname: string): boolean {
  if (under(pathname, '/settings') && !canUseSettings(role)) return false
  if (!isLockedRole(role)) return true
  if (role === 'mechanic' && FORMS_PATHS.some(p => under(pathname, p))) return false
  if (pathname.includes('..') || pathname.includes('\\') || /%2e|%5c|%2f/i.test(pathname)) return false   // no dot-segment or encoded tricks out of the allowed prefixes
  const hit = (p: string) => pathname === p || pathname.startsWith(p + '/')
  const shop = isShopOnly(role)
  if ((shop ? SHOP_EXACT : FIELD_EXACT).includes(pathname)) return true
  if (pathname.startsWith('/api/')) return (shop ? SHOP_API : FIELD_API).some(hit)
  return shop ? [...SHOP_PAGES, ...SHOP_MOBILE].some(hit) : FIELD_PAGES.some(hit)
}

/** Landing page for a locked role: its saved choice if that page is allowed, otherwise its home. */
export function lockedLanding(role: R, saved: string | null | undefined): string {
  return saved && roleMayVisit(role, saved) ? saved : lockedRoleHome(role)
}
