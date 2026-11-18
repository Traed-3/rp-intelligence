import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, FileText } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { HELP_BUCKET, helpGuideBySlug } from '@/lib/help'

export const dynamic = 'force-dynamic'

// Links are good for two hours: long enough to watch and rewind, short enough that a copied link goes dead.
const LINK_SECONDS = 60 * 60 * 2

export default async function HelpGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = helpGuideBySlug(slug)
  if (!guide) notFound()

  const storage = createAdminClient().storage.from(HELP_BUCKET)
  const sign = async (path?: string, download?: string) => {
    if (!path) return null
    const { data } = await storage.createSignedUrl(path, LINK_SECONDS, download ? { download } : undefined)
    return data?.signedUrl ?? null
  }
  const [videoUrl, posterUrl, pdfUrl, pdfDownloadUrl] = await Promise.all([
    sign(guide.video?.path), sign(guide.video?.poster), sign(guide.pdf?.path), sign(guide.pdf?.path, guide.pdf?.filename),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">{guide.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{guide.summary}</p>
        </div>
        <Link href="/help" className="text-sm text-gray-500 hover:text-gray-700">← Technical Help</Link>
      </div>

      {guide.video && (
        <div className="rp-card p-3 sm:p-4 mb-4">
          {videoUrl ? (
            <video controls playsInline preload="metadata" poster={posterUrl ?? undefined} src={videoUrl}
              className="mx-auto w-full max-w-sm rounded-lg bg-black" style={{ aspectRatio: '9 / 16' }} />
          ) : (
            <p className="text-sm text-gray-500 p-3">The video has not been loaded yet.</p>
          )}
          <p className="text-xs text-gray-500 text-center mt-2">Video · {guide.video.length} · turn the sound on</p>
        </div>
      )}

      {guide.pdf && (
        <div className="rp-card p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg p-2 bg-primary/10 text-primary"><FileText className="w-5 h-5" /></span>
            <div>
              <p className="font-semibold text-gray-900">Printable guide</p>
              <p className="text-xs text-gray-500">PDF · {guide.pdf.pages} {guide.pdf.pages === 1 ? 'page' : 'pages'}</p>
            </div>
          </div>
          {pdfUrl ? (
            <div className="flex items-center gap-2">
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Open guide</a>
              {pdfDownloadUrl && (
                <a href={pdfDownloadUrl} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 inline-flex items-center gap-1.5">
                  <Download className="w-4 h-4" /> Save
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">The guide has not been loaded yet.</p>
          )}
        </div>
      )}

      <div className="rp-card p-4">
        <h2 className="rp-card-title mb-2">The short version</h2>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-700">
          {guide.recap.map(line => <li key={line}>{line}</li>)}
        </ol>
      </div>
    </div>
  )
}
