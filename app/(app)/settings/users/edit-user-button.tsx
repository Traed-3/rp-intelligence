'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { editUser } from './actions'

type User = {
  id: string
  full_name: string
  email: string
  phone: string | null
  job_title?: string | null
}

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export function EditUserButton({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const [name, setName]   = useState(user.full_name)
  const [email, setEmail] = useState(user.email)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [title, setTitle] = useState(user.job_title ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleOpen() {
    // Reset to current values when opening
    setName(user.full_name)
    setEmail(user.email)
    setPhone(user.phone ?? '')
    setTitle(user.job_title ?? '')
    setError(null)
    setOpen(true)
  }

  function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return }
    if (!email.trim()) { setError('Email is required.'); return }
    setError(null)
    startTransition(async () => {
      const result = await editUser(user.id, { full_name: name, email, phone, job_title: title })
      if (result.error) {
        setError(result.error)
      } else {
        setOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg transition-colors"
      >
        Edit
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />

          {/* Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h2 className="text-base font-bold text-gray-900 mb-4">Edit User</h2>

              {error && (
                <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className={lbl}>Full Name</label>
                  <input
                    className={inp}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className={lbl}>Email</label>
                  <input
                    className={inp}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Email address"
                  />
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠️ Changing email also updates their login address.
                  </p>
                </div>
                <div>
                  <label className={lbl}>Job title (prints under their name when they sign a quote or invoice)</label>
                  <input className={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Construction Manager" />
                </div>
                <div>
                  <label className={lbl}>Phone (optional)</label>
                  <input
                    className={inp}
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="Phone number"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button
                  onClick={handleSave}
                  disabled={isPending}
                  className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isPending ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
