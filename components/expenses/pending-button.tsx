'use client'

import { useFormStatus } from 'react-dom'

/** Submit button that shows a busy label while its server action runs. */
export function PendingButton({ children, busy, className }: { children: React.ReactNode; busy: string; className?: string }) {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending} className={className}>{pending ? busy : children}</button>
}
