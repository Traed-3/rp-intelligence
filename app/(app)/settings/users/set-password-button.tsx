'use client'

import { useState, useTransition } from 'react'
import { setUserPassword } from './actions'
import { MIN_PASSWORD_LENGTH, validateNewPassword, generatePassword } from '@/lib/password-rules'

const inp = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

export function SetPasswordButton({ userId, fullName, email }: { userId: string; fullName: string; email: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [temporary, setTemporary] = useState(true)
  const [isPending, startTransition] = useTransition()

  function handleOpen() {
    setPassword(''); setShow(false); setError(null); setSaved(false); setCopied(false); setTemporary(true)
    setOpen(true)
  }

  function handleClose() {
    setOpen(false)
    setPassword('')   // never keep a typed password around after the dialog is gone
  }

  function handleGenerate() {
    setPassword(generatePassword())
    setShow(true)
    setError(null)
    setCopied(false)
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setShow(true)   // clipboard refused: leave it visible so it can be read out or selected by hand
    }
  }

  function handleSave() {
    const problem = validateNewPassword(password)
    if (problem) { setError(problem); return }
    setError(null)
    startTransition(async () => {
      const result = await setUserPassword(userId, password, temporary)
      if (result.error) setError(result.error)
      else setSaved(true)
    })
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 border border-gray-300 px-2.5 py-1 rounded-lg transition-colors"
      >
        Password
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={handleClose} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h2 className="text-base font-bold text-gray-900 mb-1">Set password</h2>
              <p className="text-xs text-gray-500 mb-4">{fullName} · {email}</p>

              {saved ? (
                <>
                  <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
                    Password saved. Give it to {fullName} now. It can&apos;t be viewed again, only replaced.{temporary ? ' They will be made to choose their own the first time they sign in.' : ''}
                  </div>
                  <div className="flex justify-end">
                    <button onClick={handleClose} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">Done</button>
                  </div>
                </>
              ) : (
                <>
                  {error && (
                    <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className={lbl}>New password</label>
                      <input
                        className={inp}
                        type={show ? 'text' : 'password'}
                        value={password}
                        onChange={e => { setPassword(e.target.value); setCopied(false) }}
                        autoComplete="new-password"
                        spellCheck={false}
                        autoCapitalize="none"
                        placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                      />
                      <div className="mt-1.5 flex items-center gap-3 text-xs">
                        <button type="button" onClick={handleGenerate} className="font-medium text-blue-600 hover:text-blue-800">Generate one</button>
                        <button type="button" onClick={() => setShow(s => !s)} className="text-gray-500 hover:text-gray-700">{show ? 'Hide' : 'Show'}</button>
                        {password && <button type="button" onClick={handleCopy} className="text-gray-500 hover:text-gray-700">{copied ? 'Copied' : 'Copy'}</button>}
                      </div>
                    </div>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input type="checkbox" className="mt-0.5" checked={temporary} onChange={e => setTemporary(e.target.checked)} />
                      <span>Temporary password. Make them choose their own the first time they sign in.</span>
                    </label>
                    <p className="text-xs text-gray-500">
                      They sign in on the login page with this email and password. Give it to them in person or by phone. It replaces any password they have now.
                    </p>
                  </div>
                  <div className="mt-5 flex justify-end gap-2">
                    <button onClick={handleClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                    <button
                      onClick={handleSave}
                      disabled={isPending || !password}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isPending ? 'Saving…' : 'Save password'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
