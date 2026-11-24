import { describe, it, expect } from 'vitest'
import { canUseArea, areasFor, canSeeSellPrices, canSeeSiteDetails, ALL_AREAS, type AssistantWho, type AssistantArea } from '@/lib/assistant/access'
import { ALL_TOOLS, toolsFor, runTool } from '@/lib/assistant/registry'
import { roleMayVisit, isFieldRole } from '@/lib/role-access'
import { safeAppPath } from '@/lib/assistant/links'
import { assistantSuggestions } from '@/lib/assistant/suggestions'
import { appGuide } from '@/lib/assistant/knowledge'
import type { AssistantCtx } from '@/lib/assistant/types'

// Ask RPS may only look into a part of the app the person could open as a page. These tests pin that down
// for every role in Settings → Users, so a change to the role rules can never quietly open a back door here.

const ROLES = ['owner', 'manager', 'shop_manager', 'shop_employee', 'mechanic', 'service_tech', 'construction_tech',
  'construction_manager', 'construction_admin', 'parts_manager', 'office_staff', 'viewer']

const who = (role: string, extra: Partial<AssistantWho> = {}): AssistantWho =>
  ({ userId: '00000000-0000-0000-0000-000000000001', role, blockedModules: [], complianceGranted: false, ...extra })

const ctxFor = (w: AssistantWho): AssistantCtx => ({
  ...w, companyId: 'c1', fullName: 'Test Person', page: null,
  // Any database call from a refused tool would be a failure: this stand-in throws if touched.
  admin: new Proxy({}, { get() { throw new Error('database touched') } }) as AssistantCtx['admin'],
})

// The page each area stands for. If the person cannot open it, they must not get the area.
const AREA_PAGE: Record<AssistantArea, string> = {
  assets: '/assets', tickets: '/tickets', shop: '/shop', construction: '/construction', sites: '/construction/sites',
  service: '/service', billing: '/billing', inventory: '/inventory/parts', compliance: '/compliance',
  expenses: '/expenses', calendar: '/calendar', plate: '/my',
}

describe('Ask RPS areas follow the page rules', () => {
  it.each(ROLES)('%s: never gets an area whose page it cannot open', role => {
    for (const area of ALL_AREAS) {
      if (area === 'sites') continue   // techs look sites up from the site survey form; checked below
      if (canUseArea(who(role), area)) expect(roleMayVisit(role, AREA_PAGE[area]), `${role} → ${area}`).toBe(true)
    }
  })

  it('techs, mechanics and shop employees never get accounting or HR', () => {
    for (const role of ['service_tech', 'construction_tech', 'mechanic', 'shop_employee']) {
      for (const area of ['billing', 'compliance', 'expenses'] as AssistantArea[]) {
        expect(canUseArea(who(role), area), `${role} → ${area}`).toBe(false)
        expect(canUseArea(who(role, { complianceGranted: true }), area), `${role} (on DQF list) → ${area}`).toBe(false)
      }
      expect(canSeeSellPrices(who(role))).toBe(false)
    }
  })

  it('shop employees only get the shop side', () => {
    expect(areasFor(who('shop_employee')).sort()).toEqual(['assets', 'plate', 'shop', 'tickets'])
  })

  it('field roles get service and inventory (cost only) but not construction', () => {
    for (const role of ['service_tech', 'construction_tech', 'mechanic']) {
      expect(canUseArea(who(role), 'service')).toBe(true)
      expect(canUseArea(who(role), 'inventory')).toBe(true)
      expect(canUseArea(who(role), 'construction')).toBe(false)
    }
    // Site lookup follows the site search the forms use (open to field roles in lib/role-access.ts), never the shop,
    // and field roles only get the fields that search returns.
    for (const role of ['service_tech', 'construction_tech', 'mechanic']) {
      expect(canUseArea(who(role), 'sites')).toBe(roleMayVisit(role, '/api/construction/sites/search'))
      expect(canSeeSiteDetails(who(role))).toBe(false)
      expect(canUseArea(who(role, { blockedModules: ['construction'] }), 'sites')).toBe(false)
    }
    expect(canUseArea(who('shop_employee'), 'sites')).toBe(false)
  })

  it('Site Lookup is for Construction access; other office roles do not get it', () => {
    for (const role of ROLES) {
      const w = who(role)
      if (canUseArea(w, 'sites') && !isFieldRole(role)) {
        expect(canUseArea(w, 'construction'), role).toBe(true)
        expect(canSeeSiteDetails(w), role).toBe(true)
      }
    }
    for (const role of ['office_staff', 'parts_manager', 'shop_manager']) expect(canUseArea(who(role), 'sites'), role).toBe(false)
    expect(canUseArea(who('owner', { blockedModules: ['construction'] }), 'sites')).toBe(false)
  })

  it('owners see everything', () => {
    expect(areasFor(who('owner')).sort()).toEqual([...ALL_AREAS].sort())
    expect(canSeeSellPrices(who('owner'))).toBe(true)
  })

  it('the DQF access list opens DQF & Certs for an office role, and only for that person', () => {
    expect(canUseArea(who('viewer'), 'compliance')).toBe(false)
    expect(canUseArea(who('viewer', { complianceGranted: true }), 'compliance')).toBe(true)
  })

  it('a module block in Settings → Users takes the area away', () => {
    const blocks: [string, AssistantArea][] = [['construction', 'construction'], ['service_dispatch', 'service'], ['billing', 'billing'],
      ['inventory', 'inventory'], ['compliance', 'compliance'], ['maintenance', 'assets'], ['tickets', 'tickets'], ['shop', 'shop']]
    for (const [module, area] of blocks) {
      expect(canUseArea(who('owner'), area)).toBe(true)
      expect(canUseArea(who('owner', { blockedModules: [module] }), area), `block ${module}`).toBe(false)
    }
  })
})

describe('Ask RPS tools', () => {
  it('every tool has a unique name, an area and a description', () => {
    const names = ALL_TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of ALL_TOOLS) {
      expect(ALL_AREAS).toContain(t.area)
      expect(t.description.length).toBeGreaterThan(20)
      expect(t.name).toMatch(/^[a-z_]{3,64}$/)
    }
  })

  it('a person is only offered tools from their own areas', () => {
    for (const role of ROLES) {
      const w = who(role)
      for (const t of toolsFor(ctxFor(w))) expect(canUseArea(w, t.area), `${role} offered ${t.name}`).toBe(true)
    }
  })

  it('changes are only offered to owners, managers and shop managers', () => {
    for (const role of ROLES) {
      const writes = toolsFor(ctxFor(who(role))).filter(t => t.writes).map(t => t.name)
      if (['owner', 'manager', 'shop_manager'].includes(role)) expect(writes.length, role).toBeGreaterThan(0)
      else expect(writes, role).toEqual([])
    }
  })

  it('a tool outside the person\'s areas is refused without touching the database', async () => {
    const tech = ctxFor(who('service_tech'))
    for (const name of ['find_invoices', 'dqf_attention', 'find_expenses', 'get_job', 'complete_ticket']) {
      const answer = await runTool(name, {}, tech)
      expect(answer, name).toMatch(/^Not allowed/)
    }
    expect(await runTool('no_such_tool', {}, tech)).toMatch(/^Unknown tool/)
  })

  it('suggestions and the app guide only mention what the person can open', () => {
    const shop = who('shop_employee')
    const s = assistantSuggestions(shop).join(' ')
    expect(s).not.toMatch(/invoice|DQF|schedule|service call/i)
    const guide = appGuide(shop)
    expect(guide).toContain('REPAIR TICKETS')
    expect(guide).not.toContain('QUOTES & INVOICES')
    expect(guide).not.toContain('DQF & CERTS')
    expect(guide).not.toContain('CONSTRUCTION (')
    expect(appGuide(who('owner'))).toContain('QUOTES & INVOICES')
    expect(assistantSuggestions(who('owner')).length).toBeLessThanOrEqual(5)
  })
})

describe('links in answers', () => {
  it('only ever link to a page inside the app', () => {
    for (const ok of ['/construction/jobs/f0fe7fb3-9f92-409c-9453-c3d63c9ee1f2', '/my', '/service/tickets/log', '/help/home-screen', '/expenses?month=2026-10'])
      expect(safeAppPath(ok), ok).toBe(ok)
    for (const bad of ['//evil.example/x', '/\\evil.example', '/\\/evil.example', '//', '/', 'https://evil.example', 'javascript:alert(1)',
      '/my//evil.example', '/%2f%2fevil.example', '/../etc', '/unknown-section/x', '/construction/../../x', ' //evil.example', '/@evil.example'])
      expect(safeAppPath(bad), bad).toBeNull()
  })
})
