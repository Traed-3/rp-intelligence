// ============================================================
// Field Surveys access — who may use the survey screens and what the locked-down role may reach.
// PURE module (no server-only imports): used by proxy.ts, server pages, API routes and client components.
// ============================================================
import { CON_READ_ROLES, CON_WRITE_ROLES } from '@/lib/construction'

/** Role for people (Glen Blankenship, 10/2/26) who may use Field Surveys and nothing else in RP Intelligence. */
export const SURVEY_ONLY_ROLE = 'field_surveyor'
/** Roles that can run surveys without having the Construction module (the crew's phones). */
export const SURVEY_TECH_ROLES: readonly string[] = ['construction_tech', SURVEY_ONLY_ROLE]

type P = { id?: string | null; role?: string | null } | null | undefined

export const isSurveyOnly = (role?: string | null) => role === SURVEY_ONLY_ROLE
export const canUseFieldSurveys = (p: P) => !!p?.id && (CON_READ_ROLES.includes(p.role ?? '') || SURVEY_TECH_ROLES.includes(p.role ?? ''))
export const canEditFieldSurveys = (p: P) => !!p?.id && (CON_WRITE_ROLES.includes(p.role ?? '') || SURVEY_TECH_ROLES.includes(p.role ?? ''))
/** The locked-down role only sees surveys it started itself. */
export const surveyOwnOnly = (role?: string | null) => isSurveyOnly(role)

export const SURVEY_ONLY_HOME = '/construction/surveys'

/** Every brand-new sign-in starts locked to Field Surveys. Only an owner or manager in Settings > Users can give anyone more. */
export const DEFAULT_NEW_USER_ROLE = SURVEY_ONLY_ROLE
const PAGE_PREFIXES = ['/construction/surveys']
const API_PREFIXES = ['/api/construction/surveys', '/api/construction/survey-photos']

/** Allow-list for the locked-down role: everything not listed here is refused by proxy.ts. */
export function surveyOnlyMayVisit(pathname: string): boolean {
  if (pathname.includes('..') || pathname.includes('\\') || /%2e|%5c/i.test(pathname)) return false   // no dot-segment or encoded tricks out of the allowed prefixes
  const hit = (p: string) => pathname === p || pathname.startsWith(p + '/')
  return PAGE_PREFIXES.some(hit) || API_PREFIXES.some(hit)
}
