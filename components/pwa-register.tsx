'use client'

import { useEffect } from 'react'

// Some browsers (Chrome and Edge, on Android and on computers) hand the page an "install" offer that a button can
// use later. It arrives once, early, so it is kept here for Technical Help > Add to your Home Screen.
// iPhones never send one: Apple only allows Share > Add to Home Screen.
export type InstallOffer = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
declare global { interface Window { __rpInstallOffer?: InstallOffer | null } }
export const INSTALL_EVENT = 'rp-install-offer'

export function PWARegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(reg => console.log('SW registered', reg.scope))
        .catch(err => console.error('SW registration failed', err))
    }
    const offered = (e: Event) => { window.__rpInstallOffer = e as InstallOffer; window.dispatchEvent(new Event(INSTALL_EVENT)) }
    const installed = () => { window.__rpInstallOffer = null; window.dispatchEvent(new Event(INSTALL_EVENT)) }
    window.addEventListener('beforeinstallprompt', offered)
    window.addEventListener('appinstalled', installed)
    return () => { window.removeEventListener('beforeinstallprompt', offered); window.removeEventListener('appinstalled', installed) }
  }, [])

  return null
}
