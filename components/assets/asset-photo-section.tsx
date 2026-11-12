'use client'

import { useState } from 'react'
import { ImageUpload } from '@/components/ui/image-upload'

type Photo = { id: string; photo_url: string; caption: string | null; is_primary: boolean }

export function AssetPhotoSection({
  assetId,
  initialPhotos,
  onSave,
}: {
  assetId: string
  initialPhotos: Photo[]
  onSave: (photoUrl: string, caption: string) => Promise<void>
}) {
  const [photos, setPhotos] = useState(initialPhotos)
  const [newUrl, setNewUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!newUrl) return
    setSaving(true)
    await onSave(newUrl, caption)
    setPhotos(prev => [...prev, { id: Date.now().toString(), photo_url: newUrl, caption, is_primary: false }])
    setNewUrl(null)
    setCaption('')
    setSaving(false)
  }

  return (
    <div className="rp-card p-5">
      <h2 className="font-semibold text-gray-900 mb-4">Photos</h2>

      {/* Existing photos */}
      {photos.length > 0 && (
        <div className="flex gap-3 flex-wrap mb-4">
          {photos.map(p => (
            <div key={p.id} className="relative">
              <img src={p.photo_url} alt={p.caption ?? 'Asset photo'} className="w-32 h-24 object-cover rounded-lg border border-gray-200" />
              {p.caption && <p className="text-xs text-gray-500 mt-1 text-center max-w-[128px] truncate">{p.caption}</p>}
              {p.is_primary && <span className="absolute top-1 left-1 text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded">Primary</span>}
            </div>
          ))}
        </div>
      )}

      {/* Upload new */}
      <div className="space-y-3">
        <ImageUpload
          bucket="asset-photos"
          value={newUrl}
          onChange={setNewUrl}
          label="Add Asset Photo"
        />
        {newUrl && (
          <>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Caption (optional)"
              value={caption}
              onChange={e => setCaption(e.target.value)}
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Photo'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
