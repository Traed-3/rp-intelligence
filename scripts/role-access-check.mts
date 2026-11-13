// Checks the role lockdown rules (lib/role-access.ts + the nav).  Run: npx tsx scripts/role-access-check.mts
import { roleMayVisit, canAssignPlate, lockedLanding } from '../lib/role-access'
import { buildNav, allowedDashboardCards } from '../lib/nav-items'
import { canReadCompliance } from '../lib/compliance'
import { canUseFieldSurveys } from '../lib/field-surveys'
import { moduleForPath } from '../lib/modules'

let bad = 0
const expect = (what: string, got: unknown, want: unknown) => { if (got !== want) { bad++; console.log(`FAIL ${what}: got ${got}, want ${want}`) } }

const ACCOUNTING_HR = ['/billing', '/billing/quotes', '/billing/invoices/abc', '/expenses', '/expenses/abc', '/expenses/report', '/expenses/cards', '/expenses/fuel',
  '/reports', '/reports/payroll', '/compliance', '/compliance/employees/abc', '/compliance/audit', '/inventory/receive', '/inventory/receive/queue/abc',
  '/settings/company', '/settings/payment-methods', '/settings/users', '/review', '/construction', '/construction/jobs',
  '/api/billing/quotes/abc/pdf', '/api/billing/inbox-sync', '/api/compliance/documents/abc', '/api/reports/payroll-csv', '/api/reports/expenses-csv',
  '/api/expenses/card-audit-csv', '/api/construction/documents/abc', '/api/construction/reports/csv', '/api/svc/gmail-sync', '/api/gmail/sync',
  '/expenses/new/../cards', '/expenses/new%2f..%2fcards', '/some-new-page']
const FIELD_OK = ['/my', '/dashboard', '/mobile', '/mobile/service-ticket/abc', '/maintenance', '/assets/abc', '/tickets/abc', '/shop/clock', '/time', '/service', '/service/abc',
  '/inventory', '/inventory/parts/abc', '/inventory/stock', '/calendar', '/notifications',
  '/expenses/new', '/api/expenses/scan', '/api/assistant', '/api/upload', '/api/tickets/abc/status']
const SHOP_OK = ['/my', '/maintenance', '/maintenance/oil-changes', '/assets', '/assets/abc', '/tickets', '/tickets/abc', '/shop', '/shop/clock', '/shop/my-tasks', '/time',
  '/mobile', '/mobile/report-issue', '/mobile/mileage', '/mobile/ticket/abc/work', '/notifications', '/api/assistant', '/api/upload']
const SHOP_NO = ['/dashboard', '/service', '/service/abc', '/inventory', '/inventory/parts', '/calendar', '/construction/surveys', '/expenses/new', '/mobile/service-ticket',
  '/mobile/daily-update', '/mobile/survey', '/api/inventory/parts/search', '/api/expenses/scan', '/forms', '/construction/surveys/tests', '/api/construction/surveys/abc/pdf']

for (const role of ['service_tech', 'construction_tech', 'mechanic']) {
  for (const p of ACCOUNTING_HR) expect(`${role} ${p}`, roleMayVisit(role, p), false)
  for (const p of FIELD_OK) expect(`${role} ${p}`, roleMayVisit(role, p), true)
}
for (const p of [...ACCOUNTING_HR, ...SHOP_NO]) expect(`shop_employee ${p}`, roleMayVisit('shop_employee', p), false)
for (const p of SHOP_OK) expect(`shop_employee ${p}`, roleMayVisit('shop_employee', p), true)
const SETTINGS = ['/settings', '/settings/users', '/settings/personalize', '/settings/alerts', '/settings/company', '/settings/payment-methods']
const FORMS = ['/forms', '/construction/surveys', '/construction/surveys/abc', '/construction/surveys/tests', '/construction/surveys/tests/abc', '/api/construction/surveys/abc/pdf', '/api/construction/survey-photos/abc']
for (const role of ['owner', 'manager', 'construction_manager', 'construction_admin'])
  for (const p of [...ACCOUNTING_HR, ...FIELD_OK, ...SETTINGS, ...FORMS]) expect(`${role} ${p} (unchanged)`, roleMayVisit(role, p), true)
for (const role of ['office_staff', 'parts_manager', 'viewer', 'shop_manager', 'estimator', 'service_tech', 'construction_tech', 'mechanic', 'shop_employee', 'field_surveyor'])
  for (const p of SETTINGS) expect(`${role} ${p} (settings closed)`, roleMayVisit(role, p), false)
for (const role of ['office_staff', 'parts_manager', 'viewer'])
  for (const p of [...ACCOUNTING_HR.filter(x => !x.startsWith('/settings')), ...FIELD_OK]) expect(`${role} ${p} (unchanged)`, roleMayVisit(role, p), true)
for (const role of ['service_tech', 'construction_tech']) {
  for (const p of FORMS) expect(`${role} ${p} (forms)`, roleMayVisit(role, p), true)
  expect(`${role} can fill forms`, canUseFieldSurveys({ id: 'x', role }), true)
  expect(`${role} has Forms in the menu`, buildNav({ role, userId: 'x' }).sidebar.some(i => i.href === '/forms'), true)
}
for (const p of FORMS) expect(`mechanic ${p} (no forms)`, roleMayVisit('mechanic', p), false)
for (const role of ['service_tech', 'construction_tech', 'mechanic', 'shop_employee', 'office_staff', 'parts_manager', 'viewer', 'owner'])
  expect(`${role} has My Plate in the menu`, buildNav({ role, userId: 'x' }).sidebar.some(i => i.href === '/my'), true)
expect('a tech cannot assign to other plates', canAssignPlate('service_tech'), false)
expect('a manager can assign to other plates', canAssignPlate('manager'), true)
expect('tech first screen is My Plate', lockedLanding('service_tech', null), '/my')
expect('shop first screen is the shop dashboard', lockedLanding('shop_employee', null), '/maintenance')
expect('mechanic cannot fill forms', canUseFieldSurveys({ id: 'x', role: 'mechanic' }), false)
expect('a Construction block does not hide forms', moduleForPath('/construction/surveys/tests'), null)
expect('a Construction block still hides jobs', moduleForPath('/construction/jobs'), 'construction')

for (const role of ['service_tech', 'construction_tech', 'mechanic', 'shop_employee']) {
  expect(`${role} DQF even when on the access list`, canReadCompliance({ id: 'x', role }, true), false)
  const nav = buildNav({ role, userId: 'x', complianceGranted: true })
  const links = [...nav.sidebar, ...nav.defaultTabs, ...nav.tabChoices].map(i => i.href)
  for (const h of links) expect(`${role} menu link ${h}`, roleMayVisit(role, h), true)
  const cards = allowedDashboardCards({ role, userId: 'x', complianceGranted: true }).map(c => c.key)
  expect(`${role} billing card`, cards.includes('billing'), false)
  expect(`${role} DQF card`, cards.includes('compliance'), false)
  console.log(role.padEnd(18), 'menu:', nav.sidebar.map(i => i.label).join(', '), '| phone:', nav.defaultTabs.map(i => i.label).join(', '), '| cards:', cards.join(', ') || '-')
}
expect('Peggy (construction_admin, on the list) keeps DQF', canReadCompliance({ id: 'x', role: 'construction_admin' }, true), true)
console.log(bad ? `${bad} FAILED` : 'ALL PASS'); process.exit(bad ? 1 : 0)
