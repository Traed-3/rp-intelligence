// RPMail in its own window (Trae, 11/25/26: "a separate window open for mail so it does not have to keep loading").
// The RPMail menu entry opens /mail in a window named "rpmail". If that window is already open it is only brought to
// the front, never loaded again, so the mail stays as it was left. Runs in the browser only.

export const MAIL_WINDOW = 'rpmail'
export const MAIL_PATH = '/mail'

/** Open the mail window, or bring the open one to the front. Returns false if the browser blocked it. */
export function openMailWindow(): boolean {
  const w = Math.min(1500, Math.round(window.screen.availWidth * 0.92)), h = Math.min(980, Math.round(window.screen.availHeight * 0.92))
  // An empty address finds the window by its name without loading anything in it.
  const win = window.open('', MAIL_WINDOW, `popup=yes,width=${w},height=${h},left=${Math.max(0, window.screen.availWidth - w)},top=0`)
  if (!win) return false
  let fresh = true
  try { fresh = win.location.href === 'about:blank' || !win.location.pathname.startsWith(MAIL_PATH) } catch { fresh = true }
  if (fresh) win.location.href = MAIL_PATH
  win.focus()
  return true
}

/** From the mail window: show a page of RP Intelligence in the main window (it opened this one), or in a new tab. */
export function showInMain(href: string) {
  const main = window.opener as Window | null
  try {
    if (main && !main.closed && main.location.origin === window.location.origin) { main.location.href = href; main.focus(); return }
  } catch { /* the main window went somewhere else: fall through */ }
  window.open(href, '_blank')
}
