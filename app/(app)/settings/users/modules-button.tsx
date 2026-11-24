'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MODULES } from '@/lib/modules'
import { setUserModuleBlocks } from './actions'

export function ModulesButton({ userId, fullName, blockedKeys }: { userId: string; fullName: string; blockedKeys: string[] }) {
  const [open, setOpen] = useState(false)
  const [blocked, setBlocked] = useState<Set<string>>(new Set(blockedKeys))
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleOpen() {
    setBlocked(new Set(blockedKeys))
    setOpen(true)
  }

  function toggle(key: string) {
    setBlocked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleSave() {
    startTransition(async () => {
      await setUserModuleBlocks(userId, Array.from(blocked))
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
          blockedKeys.length
            ? 'text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100'
            : 'text-gray-500 border-gray-200 hover:bg-gray-50'
        }`}
      >
        {blockedKeys.length ? `Modules (${blockedKeys.length} blocked)` : 'Modules'}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-6">
              <h2 className="text-base font-bold text-gray-900">Module access</h2>
              <p className="text-xs text-gray-500 mt-1 mb-4">
                {fullName} can use everything their role normally allows, except whatever's unchecked below.
              </p>

              <div className="space-y-2.5">
                {MODULES.map(m => (
                  <label key={m.key} className="flex items-center gap-2.5 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={!blocked.has(m.key)}
                      onChange={() => toggle(m.key)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {m.label}
                  </label>
                ))}
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
