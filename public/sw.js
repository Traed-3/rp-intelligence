// RP Intelligence — Service Worker
// Minimal service worker to enable PWA install prompt + push notifications.
// No caching — Next.js handles caching on its own.

const CACHE = 'rps-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Pass all fetches through — no offline caching for now
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})

// Show a browser notification when a push message arrives
self.addEventListener('push', (event) => {
  let data = { title: 'RP Intelligence', body: 'You have a new alert.', link: '/' }
  try { data = { ...data, ...event.data.json() } } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      data: { link: data.link },
      requireInteraction: false,
    })
  )
})

// Open the app to the right page when a notification is clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = event.notification.data?.link ?? '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          client.navigate(link)
          return
        }
      }
      return clients.openWindow(link)
    })
  )
})
