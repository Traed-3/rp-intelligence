// Checks the role lockdown rules (lib/role-access.ts + the nav).  Run: npx tsx scripts/role-access-check.mts
import { roleMayVisit } from '../lib/role-access'
import { buildNav, allowedDashboardCards } from '../lib/nav-items'
import { canReadCompliance } from '../lib/compliance'

let bad = 0
const expect = (what: string, got: unknown, want: unknown) => { if (got !== want) { bad++; console.log(`FAIL ${what}: got ${got}, want ${want}`) } }

const ACCOUNTING_HR = ['/billing', '/billing/quotes', '/billing/invoices/abc', '/expenses', '/expenses/abc', '/expenses/report', '/expenses/cards', '/expenses/fuel',
  '/reports', '/reports/payroll', '/compliance', '/compliance/employees/abc', '/compliance/audit', '/inventory/receive', '/inventory/receive/queue/abc',
  '/settings/company', '/settings/payment-methods', '/settings/users', '/review', '/my', '/construction', '/construction/jobs',
  '/api/billing/quotes/abc/pdf', '/api/billing/inbox-sync', '/api/compliance/documents/abc', '/api/reports/payroll-csv', '/api/reports/expenses-csv',
  '/api/expenses/card-audit-csv', '/api/construction/documents/abc', '/api/construction/reports/csv', '/api/svc/gmail-sync', '/api/gmail/sync',
  '/expenses/new/../cards', '/expenses/new%2f..%2fcards', '/some-new-page']
const FIELD_OK = ['/dashboard', '/mobile', '/mobile/service-ticket/abc', '/maintenance', '/assets/abc', '/tickets/abc', '/shop/clock', '/time', '/service', '/service/abc',
  '/inventory', '/inventory/parts/abc', '/inventory/stock', '/calendar', '/notifications', '/settings', '/settings/personalize', '/settings/alerts',
  '/construction/surveys', '/construction/surveys/tests/abc', '/expenses/new', '/api/expenses/scan', '/api/assistant', '/api/upload', '/api/tickets/abc/status']
const SHOP_OK = ['/maintenance', '/maintenance/oil-changes', '/assets', '/assets/abc', '/tickets', '/tickets/abc', '/shop', '/shop/clock', '/shop/my-tasks', '/time',
  '/mobile', '/mobile/report-issue', '/mobile/mileage', '/mobile/ticket/abc/work', '/notifications', '/settings', '/settings/personalize', '/api/assistant', '/api/upload']
const SHOP_NO = ['/dashboard', '/service', '/service/abc', '/inventory', '/inventory/parts', '/calendar', '/construction/surveys', '/expenses/new', '/mobile/service-ticket',
  '/mobile/daily-update', '/mobile/survey', '/api/inventory/parts/search', '/api/expenses/scan']

for (const role of ['service_tech', 'construction_tech', 'mechanic']) {
  for (const p of ACCOUNTING_HR) expect(`${role} ${p}`, roleMayVisit(role, p), false)
  for (const p of FIELD_OK) expect(`${role} ${p}`, roleMayVisit(role, p), true)
}
for (const p of [...ACCOUNTING_HR, ...SHOP_NO]) expect(`shop_employee ${p}`, roleMayVisit('shop_employee', p), false)
for (const p of SHOP_OK) expect(`shop_employee ${p}`, roleMayVisit('shop_employee', p), true)
for (const role of ['owner', 'manager', 'office_staff', 'construction_manager', 'construction_admin', 'parts_manager', 'viewer'])
  for (const p of [...ACCOUNTING_HR, ...FIELD_OK]) expect(`${role} ${p} (unchanged)`, roleMayVisit(role, p), true)

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
