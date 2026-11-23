'use client'

import { useState, useSyncExternalStore } from 'react'
import { ArrowDown, CheckCircle2, Copy, MonitorSmartphone, Share, SquarePlus } from 'lucide-react'
import { PushToggle } from '@/app/(app)/settings/alerts/push-toggle'
import { INSTALL_EVENT } from '@/components/pwa-register'

// Technical Help > Add to your Home Screen.
// Where the browser allows it (Chrome and Edge, on Android and on computers) one button does the whole job.
// On an iPhone or iPad no website can add its own icon: Apple only allows Share > Add to Home Screen, so the page
// walks the person through those taps instead of pretending it can do them.

type Device = 'unknown' | 'installed' | 'iphone-safari' | 'iphone-other' | 'android' | 'computer'

function whatDevice(): Device {
  const ua = navigator.userAgent
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (standalone) return 'installed'
  const apple = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)   // an iPad can say it is a Mac
  if (apple) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'iphone-other' : 'iphone-safari'
  return /Android/.test(ua) ? 'android' : 'computer'
}
const nothing = () => () => {}
const onOffer = (cb: () => void) => { window.addEventListener(INSTALL_EVENT, cb); return () => window.removeEventListener(INSTALL_EVENT, cb) }

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
      <div className="text-sm text-gray-700">{children}</div>
    </li>
  )
}
const inlineIcon = 'inline-block size-4 align-text-bottom text-primary'

export function InstallApp() {
  const device = useSyncExternalStore(nothing, whatDevice, () => 'unknown' as Device)
  const canInstall = useSyncExternalStore(onOffer, () => !!window.__rpInstallOffer, () => false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const install = async () => {
    const offer = window.__rpInstallOffer
    if (!offer) return
    try {
      await offer.prompt()
      const { outcome } = await offer.userChoice
      window.__rpInstallOffer = null
      window.dispatchEvent(new Event(INSTALL_EVENT))
      setMsg(outcome === 'accepted' ? 'Added. Look for the RP Intel icon on your Home Screen or in your apps.' : 'Not added. Reload this page if you change your mind.')
    } catch { setMsg('The browser would not open its Add box. Use the steps below instead.') }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.origin + '/help/home-screen'); setCopied(true) } catch { setCopied(false) }
  }

  if (device === 'unknown') return <div className="rp-card p-4 text-sm text-gray-500">Checking this device…</div>

  if (device === 'installed') {
    return (
      <div className="space-y-4">
        <div className="rp-card p-4 flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" />
          <div>
            <p className="font-semibold text-gray-900">You are already using the Home Screen app.</p>
            <p className="text-sm text-gray-500 mt-0.5">This is the right one: it opens full screen, with no browser address bar. Nothing more to add.</p>
          </div>
        </div>
        <div className="rp-card p-4 space-y-2">
          <h2 className="rp-card-title">Notifications on this device</h2>
          <p className="text-sm text-gray-500">Switch them on here to get alerts on this phone. The phone will ask you to allow them: choose Allow. After that, RP Intel shows up in the phone&apos;s own Settings, under Notifications.</p>
          <PushToggle />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {canInstall && (
        <div className="rp-card p-4 space-y-3">
          <p className="text-sm text-gray-700">This browser can add it for you.</p>
          <button type="button" onClick={install} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">
            <MonitorSmartphone className="size-5" /> Add RP Intelligence to this device
          </button>
          {msg && <p className="text-sm text-gray-700" role="status">{msg}</p>}
        </div>
      )}

      {device === 'iphone-other' && (
        <div className="rp-card p-4 space-y-3">
          <p className="font-semibold text-gray-900">Open this page in Safari first.</p>
          <p className="text-sm text-gray-500">On an iPhone the Home Screen icon has to be made from Safari (the blue compass) for notifications to work. Copy the link, open Safari, paste it in the address bar, and sign in.</p>
          <button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">
            <Copy className="size-4" /> {copied ? 'Copied' : 'Copy the link'}
          </button>
        </div>
      )}

      {(device === 'iphone-safari' || device === 'iphone-other') && (
        <div className="rp-card p-4 space-y-3">
          <h2 className="rp-card-title">On an iPhone or iPad: three taps</h2>
          <p className="text-sm text-gray-500">Apple does not let any website add its own icon, so this part cannot be one button. It takes about ten seconds.</p>
          <ol className="space-y-3">
            <Step n={1}>Tap the <strong>Share</strong> button <Share className={inlineIcon} aria-hidden /> in Safari&apos;s bar at the bottom of the screen. On newer iPhones, tap <strong>•••</strong> first, then Share.</Step>
            <Step n={2}>Scroll down the list and tap <strong>Add to Home Screen</strong> <SquarePlus className={inlineIcon} aria-hidden />. If there is a switch called <strong>Open as Web App</strong>, leave it on.</Step>
            <Step n={3}>Leave the name as RP Intel and tap <strong>Add</strong>.</Step>
          </ol>
          <p className="text-sm text-gray-700">Then close Safari, open <strong>RP Intel</strong> from the new icon and sign in once more (the icon keeps its own sign-in). Come back to Technical Help and open this page again to switch on notifications.</p>
          {device === 'iphone-safari' && (
            <p className="flex items-center justify-center gap-2 pt-1 text-sm font-semibold text-primary">
              <ArrowDown className="size-5 animate-bounce" aria-hidden /> The Share button is down here <ArrowDown className="size-5 animate-bounce" aria-hidden />
            </p>
          )}
        </div>
      )}

      {device === 'android' && (
        <div className="rp-card p-4 space-y-3">
          <h2 className="rp-card-title">{canInstall ? 'Or do it by hand' : 'On an Android phone'}</h2>
          <ol className="space-y-3">
            <Step n={1}>In Chrome, tap the <strong>⋮</strong> menu at the top right.</Step>
            <Step n={2}>Tap <strong>Add to Home screen</strong> (it may say <strong>Install app</strong>).</Step>
            <Step n={3}>Tap <strong>Install</strong> or <strong>Add</strong>. Open RP Intel from the new icon.</Step>
          </ol>
          {!canInstall && <p className="text-xs text-gray-500">No one-tap button showed because this browser did not offer one. That usually means it is already added, or this is not Chrome.</p>}
        </div>
      )}

      {device === 'computer' && (
        <div className="rp-card p-4 space-y-3">
          <h2 className="rp-card-title">{canInstall ? 'Or do it by hand' : 'On a computer'}</h2>
          <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-700">
            <li><strong>Chrome or Edge:</strong> click the install icon at the right end of the address bar, or the <strong>⋮</strong> menu, then <strong>Cast, save, and share</strong>, then <strong>Install page as app</strong>.</li>
            <li><strong>Safari on a Mac:</strong> File menu, then <strong>Add to Dock</strong>.</li>
          </ul>
          <p className="text-sm text-gray-500">Doing this on your phone instead? Open Technical Help on the phone and tap this same guide.</p>
          {!canInstall && <p className="text-xs text-gray-500">No one-click button showed because this browser did not offer one. That usually means it is already installed, or the browser is Safari or Firefox.</p>}
        </div>
      )}
    </div>
  )
}
