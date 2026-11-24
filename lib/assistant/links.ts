// Which text in an Ask RPS answer may become a link. Answers can carry text that came from records (ticket notes,
// emails), so a link is only ever made to a page inside this app: a single leading "/", a known first part of the
// address, and nothing that a browser could read as another site ("//host", "\\host", "/\host", "@", ":").

const APP_SECTIONS = new Set([
  'my', 'dashboard', 'maintenance', 'assets', 'tickets', 'shop', 'time', 'construction', 'service', 'billing',
  'inventory', 'compliance', 'calendar', 'expenses', 'reports', 'training', 'help', 'forms', 'mobile', 'rpmail',
  'settings', 'notifications', 'review',
])

/** The path itself if it is a safe link inside the app, otherwise null. */
export function safeAppPath(raw: string): string | null {
  const path = raw.trim()
  if (path.length > 200) return null
  if (!/^\/[A-Za-z0-9][A-Za-z0-9/_\-?=&.%]*$/.test(path)) return null   // one leading slash, then a letter or digit
  if (path.includes('//') || path.includes('\\') || /%2f|%5c|%2e%2e/i.test(path) || path.includes('..')) return null
  const first = path.slice(1).split(/[/?]/)[0]
  return APP_SECTIONS.has(first) ? path : null
}
