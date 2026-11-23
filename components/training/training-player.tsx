'use client'

import { useRef } from 'react'
import { clock } from '@/lib/training'

// The video with its list of parts underneath. Tapping a part jumps the video there and plays it.
export function TrainingPlayer({ src, poster, chapters }: { src: string; poster?: string; chapters: { at: number; label: string }[] }) {
  const video = useRef<HTMLVideoElement>(null)
  const jump = (at: number) => {
    const v = video.current
    if (!v) return
    v.currentTime = at
    void v.play().catch(() => {})
    v.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  return (
    <>
      <div className="rp-card p-3 sm:p-4 mb-4">
        <video ref={video} controls playsInline preload="metadata" poster={poster} src={src}
          className="w-full rounded-lg bg-black" style={{ aspectRatio: '16 / 9' }} />
        <p className="text-xs text-gray-500 text-center mt-2">Turn the sound on. On a phone, turn it sideways or tap full screen.</p>
      </div>
      {chapters.length > 0 && (
        <div className="rp-card p-4 mb-4">
          <h2 className="rp-card-title mb-2">Jump to a part</h2>
          <ul className="sm:columns-2 gap-x-8">
            {chapters.map(c => (
              <li key={c.at} className="break-inside-avoid">
                <button type="button" onClick={() => jump(c.at)}
                  className="w-full flex items-center justify-between gap-3 py-2 text-left text-sm text-gray-700 hover:text-blue-600 border-b border-gray-100">
                  <span>{c.label}</span>
                  <span className="text-xs tabular-nums text-gray-500">{clock(c.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
