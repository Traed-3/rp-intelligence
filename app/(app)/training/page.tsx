import Link from 'next/link'
import { PlayCircle, GraduationCap } from 'lucide-react'
import { TRAINING_VIDEOS } from '@/lib/training'
import { TitleIcon } from '@/components/ui/title-icon'

// Training: company training videos. Open to everyone who signs in (lib/role-access.ts lists /training for the
// locked roles). New videos are added in lib/training.ts.
export default function TrainingPage() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="rp-title"><TitleIcon icon={GraduationCap} tone="navy" />Training</h1>
        <p className="text-sm text-gray-500 mt-0.5">Company training videos. Tap one to watch it.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TRAINING_VIDEOS.map(v => (
          <Link key={v.slug} href={`/training/${v.slug}`} className="rp-card rp-card-link p-5 block">
            <div className="flex items-center gap-3 mb-2">
              <span className="rounded-lg p-2 rp-icon-navy"><PlayCircle className="w-5 h-5" /></span>
              <h2 className="font-semibold text-gray-900">{v.title}</h2>
            </div>
            <p className="text-sm text-gray-500">{v.summary}</p>
            <p className="mt-3 text-xs text-gray-500">{v.audience} · Video {v.video.length}</p>
            <p className="mt-2 text-xs font-medium text-blue-600">Watch →</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
