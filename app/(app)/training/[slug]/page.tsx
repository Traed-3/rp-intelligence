import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardCheck, GraduationCap } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roleMayVisit } from '@/lib/role-access'
import { canUseFieldSurveys } from '@/lib/field-surveys'
import { TRAINING_BUCKET, trainingVideoBySlug } from '@/lib/training'
import { TrainingPlayer } from '@/components/training/training-player'
import { TitleIcon } from '@/components/ui/title-icon'

export const dynamic = 'force-dynamic'

// Links are good for two hours: long enough to watch and rewind, short enough that a copied link goes dead.
const LINK_SECONDS = 60 * 60 * 2

export default async function TrainingVideoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const item = trainingVideoBySlug(slug)
  if (!item) notFound()

  const admin = createAdminClient()
  const storage = admin.storage.from(TRAINING_BUCKET)
  const sign = async (path?: string) => {
    if (!path) return null
    const { data } = await storage.createSignedUrl(path, LINK_SECONDS)
    return data?.signedUrl ?? null
  }
  const [videoUrl, posterUrl] = await Promise.all([sign(item.video.path), sign(item.video.poster)])

  // The form link only shows for someone who may open that form (mechanics and shop employees may not).
  let showForm = false
  if (item.form) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { data: profile } = user ? await admin.from('profiles').select('role').eq('id', user.id).single() : { data: null }
    showForm = !!user && canUseFieldSurveys({ id: user.id, role: profile?.role }) && roleMayVisit(profile?.role, item.form.href)
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title"><TitleIcon icon={GraduationCap} tone="info" />{item.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{item.summary}</p>
          <p className="text-xs text-gray-500 mt-1">{item.audience} · Video {item.video.length}</p>
        </div>
        <Link href="/training" className="text-sm text-gray-500 hover:text-gray-700">← Training</Link>
      </div>

      {videoUrl ? (
        <TrainingPlayer src={videoUrl} poster={posterUrl ?? undefined} chapters={item.chapters} />
      ) : (
        <div className="rp-card p-4 mb-4"><p className="text-sm text-gray-500">The video has not been loaded yet.</p></div>
      )}

      {item.form && showForm && (
        <div className="rp-card p-4 mb-16 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg p-2 bg-primary/10 text-primary"><ClipboardCheck className="w-5 h-5" /></span>
            <p className="font-semibold text-gray-900">Ready to do yours?</p>
          </div>
          <Link href={item.form.href} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{item.form.label}</Link>
        </div>
      )}
    </div>
  )
}
