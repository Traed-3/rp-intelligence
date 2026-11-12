import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstruction } from '@/lib/construction-guard'
import { safeSearchTerm } from '@/lib/construction'
import { ClickableRow } from '@/components/clickable-row'
import { Users } from 'lucide-react'

const KINDS = [
  { value: '',         label: 'All' },
  { value: 'employee', label: 'Employees' },
  { value: 'customer', label: 'Customer contacts' },
  { value: 'vendor',   label: 'Vendors' },
  { value: 'service',  label: 'Service numbers' },
]

const KIND_STYLE: Record<string, string> = {
  employee: 'bg-blue-100 text-blue-800 border-blue-200',
  customer: 'bg-green-100 text-green-800 border-green-200',
  vendor:   'bg-amber-100 text-amber-800 border-amber-200',
  service:  'bg-gray-100 text-gray-600 border-gray-200',
  other:    'bg-gray-100 text-gray-600 border-gray-200',
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string }>
}) {
  const sp = await searchParams
  const { company_id } = await requireConstruction()
  const admin = createAdminClient()

  let query = admin
    .from('con_contacts')
    .select('id, name, kind, title, email, phone, mobile, employer, is_active, con_customers(name)')
    .eq('company_id', company_id)
    .order('kind')
    .order('name')
  if (sp.kind) query = query.eq('kind', sp.kind)
  const q = safeSearchTerm(sp.q)
  if (q) query = query.or(`name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
  const { data: contacts } = await query

  const counts: Record<string, number> = {}
  for (const c of contacts ?? []) counts[c.kind] = (counts[c.kind] ?? 0) + 1

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/construction" className="text-sm text-gray-500 hover:text-gray-700">← Construction</Link>
          <h1 className="inline-flex items-center gap-2.5 text-2xl font-bold text-gray-900 tracking-tight mt-2">
            <Users className="w-6 h-6 text-blue-600" />
            Contacts
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {contacts?.length ?? 0} on file · crew, customer contacts and the numbers you call
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {KINDS.map(k => (
          <Link
            key={k.value}
            href={k.value ? `/construction/contacts?kind=${k.value}` : '/construction/contacts'}
            className={`px-3 py-1.5 rounded-full border text-xs font-semibold ${
              (sp.kind ?? '') === k.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-gray-600 border-gray-200 hover:border-blue-300'
            }`}
          >
            {k.label}
            {k.value && counts[k.value] != null && (
              <span className="ml-1.5 opacity-70">{counts[k.value]}</span>
            )}
          </Link>
        ))}
        <form className="ml-auto">
          {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Search name, email, phone…"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </form>
      </div>

      <div className="rp-card overflow-hidden">
        {!contacts?.length ? (
          <p className="px-4 py-8 text-sm text-gray-400">No contacts match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="rp-table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Email</th>
                  <th className="text-left px-4 py-3">Phone</th>
                  <th className="text-left px-4 py-3 hidden lg:table-cell">Works for</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contacts.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${KIND_STYLE[c.kind] ?? KIND_STYLE.other}`}>
                        {c.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {c.email
                        ? <a href={`mailto:${c.email}`} className="text-blue-600 hover:underline">{c.email}</a>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.phone
                        ? <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} className="text-blue-600 hover:underline whitespace-nowrap">{c.phone}</a>
                        : <span className="text-gray-300">—</span>}
                      {c.mobile && (
                        <a href={`tel:${c.mobile.replace(/[^\d+]/g, '')}`} className="block text-xs text-gray-500 hover:underline whitespace-nowrap">
                          {c.mobile}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">
                      {(c as any).con_customers?.name ?? c.employer ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
