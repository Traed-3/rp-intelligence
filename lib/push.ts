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

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth_key: string },
  payload: { title: string; message: string; link?: string }
): Promise<'sent' | 'gone' | 'failed' | 'off'> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 'off'
  ensureVapid()

  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth_key } },
      JSON.stringify({ title: payload.title, body: payload.message, link: payload.link ?? '/' }),
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
