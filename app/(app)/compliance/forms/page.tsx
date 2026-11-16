import Link from 'next/link'
import { requireCompliance } from '@/lib/compliance-guard'
import { DQF_FORMS, FORM_GROUPS } from '@/lib/compliance-forms'
import { FileText, Download, FileDown } from 'lucide-react'

export const metadata = { title: 'DOT forms' }

export default async function DqfFormsPage() {
  await requireCompliance()
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/compliance" className="text-sm text-gray-500 hover:text-gray-700">← DQF &amp; Certifications</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mt-2 mb-5">
        <div>
          <h1 className="inline-flex items-center gap-2.5 text-2xl font-bold text-gray-900 tracking-tight"><FileDown className="w-6 h-6 text-blue-600" />DOT forms</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Blank driver-file forms on Rappahannock Petroleum letterhead, in the order the requirements sheet lists them.
            Click a form to open it, or Download to save it. The same forms are on each item inside a driver&apos;s file.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from an API route, not a page */}
        <a href="/api/compliance/forms/complete-form-set?download=1" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          <Download className="w-4 h-4" />Download the whole set
        </a>
      </div>

      {FORM_GROUPS.map(g => {
        const forms = DQF_FORMS.filter(f => f.group === g.value)
        if (!forms.length) return null
        return (
          <section key={g.value} className="rp-card overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">{g.label}</h2>
              <span className="text-xs text-gray-400">{g.note}</span>
            </div>
            <ul className="divide-y divide-gray-100">
              {forms.map(f => (
                <li key={f.slug} className="px-4 py-3 flex items-start gap-3">
                  <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <a href={`/api/compliance/forms/${f.slug}`} target="_blank" className="text-sm font-medium text-gray-900 hover:text-blue-700 hover:underline">{f.title}</a>
                    <p className="text-xs text-gray-400">
                      {[f.regulation, f.who ? `filled out by: ${f.who.toLowerCase()}` : null, `${f.pages} page${f.pages === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">{f.note}</p>
                  </div>
                  <a href={`/api/compliance/forms/${f.slug}?download=1`} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-card text-xs font-semibold text-gray-700 hover:border-blue-300">
                    <Download className="w-3.5 h-3.5" />Download
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <p className="text-xs text-gray-400">
        The DOT medical card itself (MCSA-5876) comes from the medical examiner, so there is no blank for it here.
      </p>
    </div>
  )
}
