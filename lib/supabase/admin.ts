import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './keys'
import { IS_DEMO, DEMO_BLOCKED_MESSAGE, DEMO_UPLOAD_MESSAGE } from '@/lib/demo'

// Server-only admin client — bypasses Row Level Security.
// Never import this in client components or expose to the browser.
export function createAdminClient() {
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  return IS_DEMO ? demoGuard(client) : client
}

/**
 * Public demo only: the shared demo login must not be able to create, delete or re-password
 * accounts (that would lock other visitors out), and nobody may upload files to the demo's storage.
 * Everything else (reading, editing sample records) works as normal and is wiped nightly.
 */
/** Pass-through read that keeps methods bound to the real object (so private fields keep working). */
function passThrough(target: object, prop: string | symbol) {
  const value = Reflect.get(target, prop, target)
  return typeof value === 'function' ? value.bind(target) : value
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function demoGuard<T extends { auth: any; storage: any }>(client: T): T {
  const blocked = async () => ({ data: { user: null }, error: { message: DEMO_BLOCKED_MESSAGE, name: 'DemoBlocked', status: 403 } })
  const adminApi = client.auth.admin
  const guardedAdmin = new Proxy(adminApi, {
    get(target, prop) {
      if (prop === 'createUser' || prop === 'deleteUser' || prop === 'updateUserById' || prop === 'inviteUserByEmail' || prop === 'generateLink') return blocked
      return passThrough(target, prop)
    },
  })
  const guardedAuth = new Proxy(client.auth, {
    get(target, prop) {
      if (prop === 'admin') return guardedAdmin
      return passThrough(target, prop)
    },
  })
  const uploadBlocked = async () => ({ data: null, error: { message: DEMO_UPLOAD_MESSAGE, name: 'DemoBlocked', statusCode: '403' } })
  const guardedStorage = new Proxy(client.storage, {
    get(target, prop) {
      if (prop === 'from') {
        return (bucket: string) => {
          const api = target.from(bucket) as object
          return new Proxy(api, {
            get(t, p) {
              if (p === 'upload' || p === 'update' || p === 'uploadToSignedUrl' || p === 'createSignedUploadUrl') return uploadBlocked
              return passThrough(t, p)
            },
          })
        }
      }
      return passThrough(target, prop)
    },
  })
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'auth') return guardedAuth
      if (prop === 'storage') return guardedStorage
      return passThrough(target, prop)
    },
  })
}
