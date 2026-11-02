'use client'

import { useState } from 'react'

export function ShareAppButton() {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    const url = window.location.origin + '/mobile'
    const shareData = {
      title: 'RP Intelligence',
      text: 'Add the RP Intelligence shortcut to your phone',
      url,
    }

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share(shareData)
        return
      } catch {
        // user cancelled — fall through to clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy the link below to share:', url)
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700 active:text-blue-800"
    >
      <span>📤</span>
      <span>{copied ? 'Link copied!' : 'Share Shortcut'}</span>
    </button>
  )
}
