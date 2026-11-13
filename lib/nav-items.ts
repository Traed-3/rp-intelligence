import {
  LayoutDashboard, Truck, Wrench, ClipboardList, Users, BarChart3, Settings, Receipt, FileText, Home, HardHat,
  CalendarDays, Fuel, Package, ListChecks, ClipboardCheck, ShieldCheck, type LucideIcon,
} from 'lucide-react'
import { canReadConstruction } from '@/lib/construction'
import { canUseFieldSurveys, isSurveyOnly } from '@/lib/field-surveys'
import { BILLING_READ_ROLES } from '@/lib/billing'
import { canReadCompliance } from '@/lib/compliance'
import { roleMayVisit, isFieldRole, noAccountingOrHr } from '@/lib/role-access'

/**
 * The one place that decides which menu entries a person is allowed to see.
 * Used by the sidebar / phone bar (components/app-nav.tsx) and by
 * Settings → Personalize, so the two can never disagree.
 */
export type NavItem = { key: string; href: string; label: string; short?: string; icon: LucideIcon; match?: string[]; construction?: boolean; billing?: boolean; compliance?: boolean; module?: string }

const item = (i: Omit<NavItem, 'key'>): NavItem => ({ key: i.href, ...i })

const navItems: NavItem[] = [
  item({ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }),
  // Everyone has a My Plate (construction roles get the full one, everyone else the simple one).
  item({ href: '/my', label: 'My Plate', short: 'Plate', icon: ListChecks }),
  // Maintenance is a module hub: Assets, Tickets and Shop live inside it
  // (they keep their own URLs, so the module stays highlighted while you're in any of them).
  // Shop/Tickets can be blocked separately from Maintenance itself (see lib/modules.ts),
  // so this hub link only disappears if the Maintenance & Assets module specifically is blocked.
  item({ href: '/maintenance', label: 'Maintenance', short: 'Maint.', icon: Wrench, match: ['/maintenance', '/assets', '/tickets', '/shop'], module: 'maintenance' }),
  // `construction: true` marks a link as gated to the Construction roles.
  item({ href: '/construction', label: 'Construction', short: 'Build', icon: HardHat, construction: true, module: 'construction' }),
  // 7-Eleven / Wawa / Sunoco service calls, synced from rpdispatcher + rpinvoicing.
  item({ href: '/service', label: 'Service Dispatch', short: 'Service', icon: Fuel, module: 'service_dispatch' }),
  item({ href: '/billing', label: 'Quotes & Invoices', short: 'Quotes', icon: FileText, billing: true, module: 'billing' }),
  item({ href: '/inventory', label: 'Inventory', short: 'Stock', icon: Package, module: 'inventory' }),
  item({ href: '/compliance', label: 'DQF & Certs', short: 'DQF', icon: ShieldCheck, compliance: true, module: 'compliance' }),
  // Company-wide calendar that overlays Maintenance and Construction items.
  item({ href: '/calendar', label: 'Calendar', icon: CalendarDays }),
  item({ href: '/expenses', label: 'Expenses', icon: Receipt }),
  item({ href: '/reports', label: 'Reports', icon: BarChart3, module: 'reports_payroll' }),
  item({ href: '/settings', label: 'Settings', icon: Settings }),
]

/** Techs and mechanics cannot open Expenses; they get a straight link to the receipt form instead. */
const receiptLink = item({ href: '/expenses/new', label: 'Submit Receipt', short: 'Receipt', icon: Receipt })

const surveysLink = item({ href: '/construction/surveys', label: 'Field Surveys', short: 'Surveys', icon: ClipboardCheck })
/** Forms: site surveys, ICON boot surveys, hydrostatic and spill bucket test reports (and later pre-trip, accident report). */
const formsLink = item({ href: '/forms', label: 'Forms', icon: ClipboardCheck, match: ['/forms', '/construction/surveys'] })

export type NavWho = { role?: string; userId?: string; blockedModules?: string[]; complianceGranted?: boolean }

export function buildNav({ role, userId, blockedModules, complianceGranted }: NavWho) {
  const canSeeConstruction = canReadConstruction({ id: userId, role })
  const blocked = new Set(blockedModules ?? [])
  const surveyOnly = isSurveyOnly(role)
  // Everyone who can fill out field forms gets the Forms section (service techs, construction techs, the construction roles).
  const canForms = canUseFieldSurveys({ id: userId, role }) && roleMayVisit(role, '/forms')
  // Construction and My Plate show for the construction roles (Settings → role); billing for its own roles too.
  const canSeeBilling = canSeeConstruction || (BILLING_READ_ROLES as readonly string[]).includes(role ?? '')

  /** Sidebar entries this person may see, in the default order. */
  const sidebar: NavItem[] = surveyOnly ? [surveysLink] : navItems.flatMap(i => (i.href === '/service' && canForms ? [i, formsLink] : [i])).filter(i =>
    (canSeeConstruction || !i.construction) &&
    (canSeeBilling || !i.billing) &&
    (canReadCompliance({ id: userId, role }, !!complianceGranted) || !i.compliance) &&
    !(i.module && blocked.has(i.module)) &&
    roleMayVisit(role, i.href)   // techs, mechanics, shop employees: only what lib/role-access.ts lists
  ).flatMap(i => (i.href === '/calendar' && isFieldRole(role) ? [i, receiptLink] : [i]))

  /** The phone bottom bar when the person has not picked their own tabs. */
  const defaultTabs: NavItem[] = surveyOnly ? [{ ...surveysLink, label: 'Surveys' }] : [
    // Kept short so it fits a phone: Dashboard, Assets and the rest are under More.
    item({ href: '/mobile',    label: 'Home',      icon: Home }),
    item({ href: '/my', label: 'Plate', icon: ListChecks }),
    item({ href: '/tickets',   label: 'Tickets',   icon: ClipboardList }),
    item({ href: '/shop',      label: 'Shop',      icon: Users }),
    ...(canSeeConstruction ? [item({ href: '/construction', label: 'Build', icon: HardHat })] : []),
    ...(canForms ? [item({ href: '/forms', label: 'Forms', icon: ClipboardCheck })] : []),
  ].filter(t => roleMayVisit(role, t.href))

  /** Everything this person could put on the phone bar: the default tabs plus every sidebar entry, short labels. */
  const tabChoices: NavItem[] = surveyOnly ? defaultTabs : [
    ...defaultTabs,
    ...sidebar.filter(s => !defaultTabs.some(t => t.href === s.href)).map(s => ({ ...s, label: s.short ?? s.label })),
  ]

  return { sidebar, defaultTabs, tabChoices, surveyOnly }
}

/** Dashboard cards, in default order. `who` decides which of them a person is allowed to have. */
export const DASHBOARD_CARDS = [
  { key: 'maintenance',  label: 'Maintenance & Fleet', desc: 'Open tickets, critical / safety, vehicles down' },
  { key: 'service',      label: 'Service Dispatch',    desc: 'Open work orders, return trips, stale calls, rejected invoices' },
  { key: 'construction', label: 'Construction',        desc: 'Active jobs, documents to review, invoiced this year' },
  { key: 'my_plate',     label: 'My Plate',            desc: 'What is on you and what you are waiting on' },
  { key: 'billing',      label: 'Quotes & Invoices',   desc: 'Open quotes, draft invoices, invoiced this year' },
  { key: 'inventory',    label: 'Inventory',           desc: 'Parts that need a price, paperwork waiting to be received' },
  { key: 'compliance',   label: 'DQF & Certs',         desc: 'DOT items expired or due soon, incomplete driver files' },
] as const
export type DashboardCardKey = typeof DASHBOARD_CARDS[number]['key']

export function allowedDashboardCards({ role, userId, blockedModules, complianceGranted }: NavWho) {
  const blocked = new Set(blockedModules ?? [])
  const con = canReadConstruction({ id: userId, role })
  const allow: Record<DashboardCardKey, boolean> = {
    maintenance: !blocked.has('maintenance'),
    service: !blocked.has('service_dispatch'),
    construction: con && !blocked.has('construction'),
    my_plate: true,
    billing: !noAccountingOrHr(role) && (con || (BILLING_READ_ROLES as readonly string[]).includes(role ?? '')) && !blocked.has('billing'),
    inventory: !blocked.has('inventory'),
    compliance: canReadCompliance({ id: userId, role }, !!complianceGranted) && !blocked.has('compliance'),
  }
  const pageFor: Record<DashboardCardKey, string> = { maintenance: '/maintenance', service: '/service', construction: '/construction', my_plate: '/my', billing: '/billing', inventory: '/inventory', compliance: '/compliance' }
  return DASHBOARD_CARDS.filter(c => allow[c.key] && roleMayVisit(role, pageFor[c.key]))
}
