'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageUpload } from '@/components/ui/image-upload'

export function TicketPhotoUpload({
  ticketId,
  onSave,
}: {
  ticketId: string
  onSave: (fileUrl: string, fileName: string) => Promise<void>
}) {
  const router = useRouter()
  const [url, setUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  async function handleSave() {
    if (!url) return
    setSaving(true)
    const fileName = url.split('/').pop() ?? 'photo.jpg'
    await onSave(url, fileName)
    // Reset so another photo can be added; refresh to show the new thumbnail
    setUrl(null)
    setResetKey((k) => k + 1)
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <ImageUpload
        key={resetKey}
        bucket="ticket-attachments"
        value={url}
        onChange={setUrl}
        label="Add Completion Photo"
      />
      {url && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-600/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Attach to Ticket'}
        </button>
      )}
    </div>
  )
}
