'use client'

import { useEffect, useState } from 'react'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

type Status = 'loading' | 'unsupported' | 'no-vapid' | 'denied' | 'subscribed' | 'unsubscribed'

export function PushToggle() {
  const [status, setStatus] = useState<Status>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!VAPID_PUBLIC_KEY) { setStatus('no-vapid'); return }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setStatus('unsupported'); return }
    if (Notification.permission === 'denied') { setStatus('denied'); return }

    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription()
    ).then(sub => {
      setStatus(sub ? 'subscribed' : 'unsubscribed')
    }).catch(() => setStatus('unsupported'))
  }, [])

  async function enable() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setStatus('denied'); return }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })

      await fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      setStatus('subscribed')
    } catch (e) {
      console.error('[push] subscribe error', e)
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setStatus('unsubscribed')
    } catch (e) {
      console.error('[push] unsubscribe error', e)
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return null

  if (status === 'no-vapid') {
    return (
      <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <span className="text-lg">⚙️</span>
        <div>
          <p className="font-medium">Push notifications need setup</p>
          <p className="text-amber-700 mt-0.5">A <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code> environment variable is required. See the setup guide below.</p>
        </div>
      </div>
    )
  }

  if (status === 'unsupported') {
    return (
      <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
        <span className="text-lg">🔕</span>
        <p>Browser push notifications are not supported in this browser.</p>
      </div>
    )
  }

  if (status === 'denied') {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        <span className="text-lg">🚫</span>
        <div>
          <p className="font-medium">Notifications are blocked</p>
          <p className="text-red-600 mt-0.5">Open your browser settings and allow notifications for this site, then reload the page.</p>
        </div>
      </div>
    )
  }

  if (status === 'subscribed') {
    return (
      <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex items-center gap-3">
          <span className="text-lg">🔔</span>
          <div>
            <p className="text-sm font-semibold text-green-800">Push notifications are active</p>
            <p className="text-xs text-green-700 mt-0.5">This browser will receive alerts even when the app tab is closed.</p>
          </div>
        </div>
        <button
          onClick={disable}
          disabled={busy}
          className="text-xs text-red-600 hover:text-red-800 font-medium px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          {busy ? 'Disabling…' : 'Disable'}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={enable}
      disabled={busy}
      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
    >
      <span>🔔</span>
      {busy ? 'Enabling…' : 'Enable Push Notifications for This Browser'}
    </button>
  )
}
