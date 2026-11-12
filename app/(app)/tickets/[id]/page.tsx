import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { TicketStatusBadge, PriorityBadge, STATUS_ACTIONS } from '@/components/tickets/ticket-badges'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { changeTicketStatus, addComment } from '../actions'
import { CommentForm } from './comment-form'
import { StatusButtons } from './status-buttons'
import { DeleteTicketButton } from './delete-button'
import { LaborTimer } from './labor-timer'
import { TicketPhotoUpload } from '@/components/tickets/ticket-photo-upload'
import { revalidatePath } from 'next/cache'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient()

  const { data: profile } = await admin.from('profiles').select('id, company_id, role').eq('id', user!.id).single()

  const [{ data: ticket }, { data: comments }, { data: laborHistory }, { data: empStatus }, { data: allAssignees }, { data: attachments }] = await Promise.all([
    admin.from('repair_tickets')
      .select(`
        *,
        assets(id, unit_number, make, model, year),
        creator:profiles!repair_tickets_created_by_fkey(full_name),
        assignee:profiles!repair_tickets_assigned_to_fkey(full_name)
      `)
      .eq('id', id)
      .eq('company_id', profile!.company_id)
      .single(),
    admin.from('repair_ticket_comments')
      .select('id, comment, is_internal, created_at, profiles(full_name)')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
    admin.from('labor_entries')
      .select('id, started_at, ended_at, total_minutes, entry_type, profiles(full_name)')
      .eq('ticket_id', id)
      .eq('entry_type', 'ticket')
      .order('started_at', { ascending: false })
      .limit(20),
    admin.from('employee_statuses')
      .select('clock_status, current_ticket_id, active_labor_entry_id')
      .eq('profile_id', user!.id)
      .maybeSingle(),
    admin.from('repair_ticket_assignments')
      .select('profile_id, profiles(full_name, role)')
      .eq('ticket_id', id)
      .eq('is_active', true),
    admin.from('repair_ticket_attachments')
      .select('id, file_url, file_name, file_type')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
  ])

  const MAX_PHOTOS = 4
  const photos = attachments ?? []

  // Is the current user actively working on THIS ticket?
  const isActiveOnThisTicket =
    empStatus?.current_ticket_id === id && !!empStatus?.active_labor_entry_id
  const isClockedIn = empStatus?.clock_status === 'clocked_in'

  // Get started_at for the active entry if running
  let activeLaborStartedAt: string | null = null
  if (isActiveOnThisTicket && empStatus?.active_labor_entry_id) {
    const { data: activeEntry } = await admin
      .from('labor_entries')
      .select('started_at')
      .eq('id', empStatus.active_labor_entry_id)
      .single()
    activeLaborStartedAt = activeEntry?.started_at ?? null
  }

  if (!ticket) notFound()

  const canManage = ['owner', 'manager', 'shop_manager'].includes(profile?.role ?? '')
  const canDelete = ['owner', 'manager'].includes(profile?.role ?? '')
  const actions = STATUS_ACTIONS[ticket.status] ?? []

  async function handleStatusChange(nextStatus: string) {
    'use server'
    await changeTicketStatus(id, nextStatus)
  }

  async function saveTicketPhoto(fileUrl: string, fileName: string) {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const admin = createAdminClient()
    await admin.from('repair_ticket_attachments').insert({
      ticket_id: id, uploaded_by: user.id, file_url: fileUrl, file_name: fileName, file_type: 'image/jpeg',
    })
    revalidatePath(`/tickets/${id}`)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Back */}
      <Link href="/tickets" className="text-sm text-gray-500 hover:text-gray-700">← Back to Tickets</Link>

      {/* Header */}
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="font-mono text-xs text-gray-400">{ticket.ticket_number}</span>
            <TicketStatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.waiting_on_parts && (
              <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full border border-orange-200">⏳ Waiting on Parts</span>
            )}
            {ticket.parts_needed && !ticket.waiting_on_parts && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full border border-amber-200">🔧 Parts Needed</span>
            )}
          </div>
          <h1 className="rp-title leading-tight">{ticket.title}</h1>
          {(ticket as any).assets && (
            <Link href={`/assets/${(ticket as any).assets.id}`} className="text-sm text-blue-600 hover:underline mt-0.5 inline-block">
              {(ticket as any).assets.unit_number}
              {[(ticket as any).assets.year, (ticket as any).assets.make, (ticket as any).assets.model].filter(Boolean).length > 0 &&
                ` — ${[(ticket as any).assets.year, (ticket as any).assets.make, (ticket as any).assets.model].filter(Boolean).join(' ')}`}
            </Link>
          )}
        </div>
        {canManage && (
          <Link href={`/tickets/${id}/edit`} className="shrink-0">
            <Button variant="outline" className="gap-2"><Pencil className="w-4 h-4" />Edit</Button>
          </Link>
        )}
      </div>

      {/* Status action buttons */}
      {actions.length > 0 && (
        <StatusButtons actions={actions} ticketId={id} />
      )}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column — main info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Description */}
          {ticket.description && (
            <div className="rp-card p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Description</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
            </div>
          )}

          {/* Parts info */}
          {(ticket.parts_needed || ticket.parts_notes) && (
            <div className="bg-card rounded-xl border border-amber-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Parts</h2>
              <div className="flex flex-wrap gap-2 mb-2">
                {ticket.parts_needed    && <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded border border-amber-200">Parts Needed</span>}
                {ticket.parts_ordered   && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded border border-blue-200">Parts Ordered</span>}
                {ticket.waiting_on_parts && <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-800 rounded border border-orange-200">Waiting on Parts</span>}
              </div>
              {ticket.parts_notes && <p className="text-sm text-gray-700">{ticket.parts_notes}</p>}
            </div>
          )}

          {/* Completion notes */}
          {ticket.completion_notes && (
            <div className="bg-card rounded-xl border border-green-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-2">Completion Notes</h2>
              <p className="text-sm text-gray-700">{ticket.completion_notes}</p>
            </div>
          )}

          {/* Photos & attachments (email attachments + up to 4 completion photos) */}
          {(() => {
            const canUpload = ticket.status === 'in_progress' || ticket.status === 'completed' || ticket.status === 'closed'
            if (photos.length === 0 && !canUpload) return null
            const isImage = (p: any) => !p.file_type || /^image\//i.test(p.file_type)
            return (
              <div className="rp-card p-5">
                <h2 className="font-semibold text-gray-900 mb-1">Photos &amp; Attachments</h2>
                <p className="text-xs text-gray-500 mb-3">Email photos/files attach here automatically. You can also add up to {MAX_PHOTOS} completion photos.</p>

                {photos.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                    {photos.map((p) => (
                      <a key={p.id} href={p.file_url} target="_blank" rel="noopener noreferrer"
                         className="block aspect-square rounded-lg overflow-hidden border border-gray-200 hover:opacity-90 bg-gray-50">
                        {isImage(p) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.file_url} alt={p.file_name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center">
                            <span className="text-2xl">📄</span>
                            <span className="text-[10px] text-gray-500 truncate w-full mt-1">{p.file_name}</span>
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                )}

                {canUpload && (
                  photos.length < MAX_PHOTOS
                    ? <TicketPhotoUpload ticketId={id} onSave={saveTicketPhoto} />
                    : <p className="text-xs text-green-600 font-medium">Maximum of {MAX_PHOTOS} completion photos attached.</p>
                )}
              </div>
            )
          })()}

          {/* Labor time tracking */}
          <LaborTimer
            ticketId={id}
            isActive={isActiveOnThisTicket}
            startedAt={activeLaborStartedAt}
            totalLaborHours={ticket.total_labor_hours ?? 0}
            laborHistory={(laborHistory ?? []).map(e => ({
              ...e,
              profiles: Array.isArray(e.profiles) ? e.profiles[0] ?? null : (e.profiles as any) ?? null,
            }))}
            isClockedIn={isClockedIn}
          />

          {/* Comments */}
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-4">
              Comments {comments?.length ? `(${comments.length})` : ''}
            </h2>

            {comments?.length === 0 && (
              <p className="text-sm text-gray-400 mb-4">No comments yet.</p>
            )}

            <div className="space-y-4 mb-5">
              {comments?.map((c) => (
                <div key={c.id} className={`rounded-lg p-3 text-sm ${c.is_internal ? 'bg-yellow-50 border border-yellow-100' : 'bg-gray-50'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-gray-900">{(c as any).profiles?.full_name ?? 'Unknown'}</span>
                    <div className="flex items-center gap-2">
                      {c.is_internal && <span className="text-xs text-yellow-700 bg-yellow-100 px-1.5 rounded">Internal</span>}
                      <span className="text-xs text-gray-400">
                        {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <p className="text-gray-700 whitespace-pre-wrap">{c.comment}</p>
                </div>
              ))}
            </div>

            <CommentForm ticketId={id} action={addComment} canMarkInternal={canManage} />
          </div>
        </div>

        {/* Right column — meta */}
        <div className="space-y-5">
          <div className="rp-card p-5">
            <h2 className="font-semibold text-gray-900 mb-3">Details</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Status</span>
                <TicketStatusBadge status={ticket.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Priority</span>
                <PriorityBadge priority={ticket.priority} />
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Source</span>
                <span className="text-gray-700 capitalize">{ticket.source}</span>
              </div>
              {ticket.safety_status && ticket.safety_status !== 'none' && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Safety</span>
                  <span className="text-red-700 font-medium capitalize">{ticket.safety_status.replace(/_/g, ' ')}</span>
                </div>
              )}
              {(ticket as any).due_date && (
                <div className="flex justify-between pt-1 border-t border-gray-100">
                  <span className="text-gray-500">Due Date</span>
                  <span className={`font-semibold ${
                    new Date((ticket as any).due_date) < new Date() ? 'text-red-600' :
                    new Date((ticket as any).due_date) <= new Date(Date.now() + 7*86400000) ? 'text-orange-600' :
                    'text-gray-700'
                  }`}>
                    {new Date((ticket as any).due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-gray-100">
                <span className="text-gray-500">Created by</span>
                <span className="text-gray-700">{(ticket as any).creator?.full_name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Assigned to</span>
                <span className="text-gray-700">
                  {(allAssignees && allAssignees.length > 0)
                    ? allAssignees.map((a: any) => a.profiles?.full_name).filter(Boolean).join(', ')
                    : <span className="text-gray-400">Unassigned</span>}
                </span>
              </div>
              {ticket.vendor && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Vendor</span>
                  <span className="text-gray-700">{ticket.vendor}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-gray-100">
                <span className="text-gray-500">Opened</span>
                <span className="text-gray-700">
                  {new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              {ticket.date_completed && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Completed</span>
                  <span className="text-gray-700">
                    {new Date(ticket.date_completed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
              )}
              {ticket.total_labor_hours > 0 && (
                <div className="flex justify-between pt-1 border-t border-gray-100">
                  <span className="text-gray-500">Labor Hours</span>
                  <span className="text-gray-700 font-medium">{Number(ticket.total_labor_hours).toFixed(2)} hrs</span>
                </div>
              )}
            </div>
          </div>

          {canDelete && (
            <div className="bg-card rounded-xl border border-red-200 p-5">
              <h2 className="font-semibold text-gray-900 mb-1">Danger Zone</h2>
              <p className="text-xs text-gray-500 mb-3">Permanently delete this ticket. Owners and managers only.</p>
              <DeleteTicketButton id={id} ticketNumber={ticket.ticket_number} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
