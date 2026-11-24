// ============================================================
// Ask RPS — who may use which part of the assistant.
// PURE module (no server-only imports) so it can be tested on its own.
//
// The rule is simple: Ask RPS can only look into a part of the app if the person could open that part as a page.
// Every check below copies the check the page itself (or the menu, lib/nav-items.ts) already makes, so the
// assistant can never become a back door around the role lockdown in lib/role-access.ts, a module block in
// Settings → Users, or the DQF access list.
// ============================================================

import { roleMayVisit, noAccountingOrHr, isLockedRole, isFieldRole, canAssignPlate } from '@/lib/role-access'
import { canReadConstruction } from '@/lib/construction'
import { BILLING_READ_ROLES } from '@/lib/billing'
import { canReadCompliance } from '@/lib/compliance'

export type AssistantWho = {
  userId: string
  role: string
  /** Module keys blocked for this person in Settings → Users (profile_module_blocks). */
  blockedModules: string[]
  /** On the DQF & Certs access list (hr_compliance_settings.access_profile_ids). */
  complianceGranted: boolean
}

/** The parts of the app the assistant can look into. One look-up file per area under lib/assistant/tools. */
export type AssistantArea =
  | 'assets'        // Maintenance & Fleet: assets, maintenance due
  | 'tickets'       // Repair tickets
  | 'shop'          // Shop & Time Clock: who is clocked in
  | 'construction'  // Jobs, schedule, permits, documents, daily updates
  | 'sites'         // Site Lookup (address, brand, equipment at a site)
  | 'service'       // Service Dispatch: calls and the emailed ticket log
  | 'billing'       // Quotes & Invoices (what we charge)
  | 'inventory'     // Parts catalog, stock on hand (cost)
  | 'compliance'    // DQF & Certs
  | 'expenses'      // Expenses / receipts list
  | 'calendar'      // Company calendar
  | 'plate'         // My Plate (own list)

const blocked = (who: AssistantWho, module: string) => who.blockedModules.includes(module)

export function canUseArea(who: AssistantWho, area: AssistantArea): boolean {
  const { role, userId } = who
  const gate = { id: userId, role }
  switch (area) {
    case 'assets':
      return roleMayVisit(role, '/assets') && !blocked(who, 'maintenance')
    case 'tickets':
      return roleMayVisit(role, '/tickets') && !blocked(who, 'tickets')
    case 'shop':
      return roleMayVisit(role, '/shop') && !blocked(who, 'shop')
    case 'construction':
      return canReadConstruction(gate) && roleMayVisit(role, '/construction') && !blocked(who, 'construction')
    case 'sites':
      // Site Lookup is a construction page. Field techs also find sites from their forms (the site search), so they
      // get the same few fields that search gives them (see canSeeSiteDetails). A Construction block stops both.
      return canUseArea(who, 'construction')
        || (isFieldRole(role) && roleMayVisit(role, '/api/construction/sites/search') && !blocked(who, 'construction'))
    case 'service':
      return roleMayVisit(role, '/service') && !blocked(who, 'service_dispatch')
    case 'billing':
      return !noAccountingOrHr(role)
        && (canReadConstruction(gate) || (BILLING_READ_ROLES as readonly string[]).includes(role))
        && roleMayVisit(role, '/billing') && !blocked(who, 'billing')
    case 'inventory':
      return roleMayVisit(role, '/inventory/parts') && !blocked(who, 'inventory')
    case 'compliance':
      return canReadCompliance(gate, who.complianceGranted) && roleMayVisit(role, '/compliance') && !blocked(who, 'compliance')
    case 'expenses':
      return roleMayVisit(role, '/expenses') && !noAccountingOrHr(role)
    case 'calendar':
      return roleMayVisit(role, '/calendar')
    case 'plate':
      return roleMayVisit(role, '/my')
  }
}

/** Everything on file about a site (equipment, notes, store phone) = Site Lookup page; otherwise number, brand, address. */
export const canSeeSiteDetails = (who: AssistantWho) => canUseArea(who, 'construction')

/** Sell prices and markups: never for techs, mechanics or shop employees (the parts page hides them the same way). */
export const canSeeSellPrices = (who: AssistantWho) => !noAccountingOrHr(who.role)

/** May this person put a task on someone else's My Plate (same rule as the plate's "For:" dropdown). */
export const canAssignOthers = (who: AssistantWho) => canAssignPlate(who.role)

/** Roles that may change repair tickets through the assistant (unchanged from the first version). */
export const TICKET_WRITE_ROLES: readonly string[] = ['owner', 'manager', 'shop_manager']
export const canWriteTickets = (who: AssistantWho) => TICKET_WRITE_ROLES.includes(who.role) && canUseArea(who, 'tickets')

export const ALL_AREAS: AssistantArea[] = ['assets', 'tickets', 'shop', 'construction', 'sites', 'service', 'billing', 'inventory', 'compliance', 'expenses', 'calendar', 'plate']

export function areasFor(who: AssistantWho): AssistantArea[] {
  return ALL_AREAS.filter(a => canUseArea(who, a))
}

export { isLockedRole }
