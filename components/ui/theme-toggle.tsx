'use client'

import { useSyncExternalStore } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

type Theme = 'light' | 'dark' | 'system'
export const THEME_KEY = 'rp-theme'

/**
 * Runs before the page paints (see app/layout.tsx) so a dark-mode user never
 * sees a white flash. Light is the default; "system" follows the phone/computer.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}')||'light';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

const options: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match device', icon: Monitor },
]

const CHANGE = 'rp-theme-change'
function subscribe(cb: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystem = () => { if (read() === 'system') apply('system') }
  window.addEventListener(CHANGE, cb)
  window.addEventListener('storage', cb)
  mq.addEventListener('change', onSystem)
  return () => { window.removeEventListener(CHANGE, cb); window.removeEventListener('storage', cb); mq.removeEventListener('change', onSystem) }
}
function read(): Theme {
  try { return (localStorage.getItem(THEME_KEY) as Theme) || 'light' } catch { return 'light' }
}

/** Light / Dark / Match device. Remembered on this device only. */
export function ThemeToggle({ className }: { className?: string }) {
  // null on the server and for the first paint, so the buttons never disagree with the saved choice.
  const theme = useSyncExternalStore<Theme | null>(subscribe, read, () => null)

  function choose(next: Theme) {
    try { localStorage.setItem(THEME_KEY, next) } catch {}
    apply(next)
    window.dispatchEvent(new Event(CHANGE))
  }

  return (
    <div role="radiogroup" aria-label="Appearance" className={cn('inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5', className)}>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
          className={cn(
            'inline-flex h-7 flex-1 items-center justify-center rounded-md px-2 text-gray-500 transition-colors hover:text-foreground',
            theme === value && 'bg-card text-foreground shadow-xs'
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  )
}
