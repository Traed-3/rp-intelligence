import Link from 'next/link'
import { BookA } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LingoManager, type LingoRow } from '@/components/svc/lingo-form'
import { canEditLingo } from '@/lib/ticket-log'

export default async function CompanyLingoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('company_id, role').eq('id', user!.id).single()
  const { data } = await admin.from('company_lingo').select('id, term, meaning, misreads, note, category')
    .eq('company_id', profile!.company_id).eq('is_active', true).order('term')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-5">
        <Link href="/service/tickets/log" className="text-sm text-gray-500 hover:text-gray-700">← All Tickets</Link>
        <h1 className="flex items-center gap-2.5 text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mt-1">
          <BookA className="w-6 h-6 text-blue-600" />Words &amp; Lingo
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Our own words and abbreviations. The ticket reader is given this list every time it reads a ticket, so handwriting that could be one of these is read as one of these. Add a word whenever you see one typed wrong.
        </p>
      </div>
      <LingoManager rows={(data ?? []) as LingoRow[]} canEdit={canEditLingo(profile?.role)} />
    </div>
  )
}
