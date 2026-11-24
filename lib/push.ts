import webpush from 'web-push'

let vapidSet = false

function ensureVapid() {
  if (vapidSet) return
  const pub  = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const mail = process.env.VAPID_EMAIL ?? 'mailto:admin@rpsmaintenance.com'
  if (!pub || !priv) return
  webpush.setVapidDetails(mail.startsWith('mailto:') ? mail : `mailto:${mail}`, pub, priv)
  vapidSet = true
}

// A device's address comes from the browser, so only the real push services are ever contacted.
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/
export function isPushEndpoint(endpoint: unknown): boolean {
  try {
    const u = new URL(String(endpoint))
    return u.protocol === 'https:' && !u.username && !u.port && PUSH_HOSTS.test(u.hostname.toLowerCase())
  } catch { return false }
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: { title: string; message: string; link?: string }
): Promise<'sent' | 'gone' | 'failed' | 'off'> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 'off'
  if (!isPushEndpoint(subscription.endpoint)) return 'failed'
  ensureVapid()

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } },
      JSON.stringify({ title: payload.title, body: payload.message, link: payload.link ?? '/' }),
      // High urgency: a phone shows it straight away instead of holding it to save power. Dropped if undelivered after a day.
      { urgency: 'high', TTL: 86_400 },
    )
    return 'sent'
  } catch (err: unknown) {
    // 410 = subscription is gone; silently ignore
    const code = (err as { statusCode?: number })?.statusCode
    if (code === 410 || code === 404) return 'gone'
    console.error('[push] delivery failed:', (err as Error)?.message)
    return 'failed'
  }
}

/** Generate VAPID keys — run once and save to env vars */
export function generateVapidKeys() {
  return webpush.generateVAPIDKeys()
}
