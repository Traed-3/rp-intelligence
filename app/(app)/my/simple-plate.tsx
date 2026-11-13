import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildPlate, dueDelta, type TaskRow } from '@/lib/my-plate'
import { canAssignPlate } from '@/lib/role-access'
import { addTask, completeTask, reopenTask, saveNote } from './actions'

const fmt = (iso: string | null) => iso ? new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : ''
const inp = 'w-full rounded-md border border-gray-300 bg-card px-2.5 py-2 text-sm text-foreground'

/** Clock In / Clock Out button for the top of My Plate (it is the first screen now, so the clock has to be on it). */
export async function ClockButton({ profileId }: { profileId: string }) {
  const { data } = await createAdminClient().from('employee_statuses').select('clock_status').eq('profile_id', profileId).maybeSingle()
  const clockedIn = data?.clock_status === 'clocked_in'
  return (
    <Link href="/shop/clock" className={`mb-5 flex items-center justify-between w-full rounded-xl px-5 py-3.5 text-white font-bold shadow-sm ${clockedIn ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'}`}>
      <span>{clockedIn ? '🔴 Clock Out' : '🟢 Clock In'}</span>
      <span className="text-sm font-medium opacity-90">{clockedIn ? 'You are clocked in' : 'You are clocked out'} →</span>
    </Link>
  )
}

export type PlatePerson = { id: string; name: string }

/** Active people a manager can assign to, for the "For:" dropdown (used by the full plate too). */
export async function platePeople(companyId: string): Promise<PlatePerson[]> {
  const { data } = await createAdminClient().from('profiles').select('id, full_name').eq('company_id', companyId).eq('is_active', true).order('full_name')
  return (data ?? []).map(p => ({ id: p.id as string, name: (p.full_name as string | null) ?? 'No name' }))
}

/**
 * My Plate for everyone outside the Construction roles (techs, mechanics, shop, office): their own to-do list.
 * What a manager assigned them, what they added themselves, a Done button and a note. No quotes, prices or orders.
 */
export async function SimplePlate({ profile }: { profile: { id: string; company_id: string; role: string } }) {
  const admin = createAdminClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const { data: rows } = await admin.from('con_tasks').select('*').eq('owner_id', profile.id).neq('status', 'dropped').or(`status.neq.done,done_at.gte.${today}T00:00:00`).order('created_at')
  const plate = buildPlate((rows ?? []) as TaskRow[], today)
  const open = [...plate.now, ...plate.next, ...plate.snoozed]
  const people = canAssignPlate(profile.role) ? await platePeople(profile.company_id) : []

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="rp-title">My Plate</h1>
          <p className="rp-subtitle">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' })} · what is on you</p>
        </div>
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          <span className="px-2 py-1 rounded border border-border bg-card"><b className="tabular-nums">{open.length}</b> to do</span>
          {plate.waiting.length > 0 && <span className="px-2 py-1 rounded border border-border bg-card"><b className="tabular-nums">{plate.waiting.length}</b> waiting</span>}
          <span className="px-2 py-1 rounded border border-border bg-card"><b className="tabular-nums">{plate.doneToday.length}</b> done today</span>
        </div>
      </header>

      <ClockButton profileId={profile.id} />

      <section className="space-y-2.5 mb-6">
        {open.length === 0 && plate.waiting.length === 0 && <div className="rp-empty"><p>Nothing on your plate right now.</p></div>}
        {[...open, ...plate.waiting].map(t => <Card key={t.id} t={t} today={today} />)}
      </section>

      <section className="mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{people.length ? 'Add a task' : 'Add to my plate'}</h2>
        <form action={addTask} className="rounded-lg border border-border border-l-[6px] border-l-blue-700 bg-card p-3 space-y-2">
          <input name="title" required placeholder="What needs doing" className={inp} />
          <div className="grid grid-cols-2 gap-2">
            <input name="site_number" placeholder="Site or truck #" className={inp} />
            <input name="due_date" type="date" className={inp} />
          </div>
          {people.length > 0 && (
            <label className="block text-xs text-muted-foreground">For
              <select name="for" defaultValue={profile.id} className={`${inp} mt-1`}>
                <option value={profile.id}>Me</option>
                {people.filter(p => p.id !== profile.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <textarea name="detail" rows={2} placeholder="Details" className={inp} />
          <button className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-semibold hover:bg-primary/90">Add</button>
        </form>
      </section>

      {plate.doneToday.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Done today</h2>
          {plate.doneToday.map(t => (
            <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <span className="flex-1 min-w-0 truncate text-muted-foreground line-through">{t.title}</span>
              <form action={reopenTask.bind(null, t.id)}><button className="text-xs font-medium text-blue-700 hover:underline">Undo</button></form>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function Card({ t, today }: { t: TaskRow; today: string }) {
  const late = (dueDelta(t, today) ?? 0) > 0
  const by = (t.action as { assigned_by_name?: string } | null)?.assigned_by_name
  return (
    <article className={`rounded-lg border border-border border-l-[6px] bg-card p-3 ${late ? 'border-l-red-600' : t.priority === 1 ? 'border-l-amber-500' : 'border-l-blue-700'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground">{t.title}</h3>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {t.site_number && <span>{t.site_number}</span>}
            {t.due_date && <span className={late ? 'font-semibold text-red-700' : ''}>{late ? 'Overdue, was due' : 'Due'} {fmt(t.due_date)}</span>}
            {by && <span>From {by}</span>}
            {t.status === 'waiting' && <span>Waiting{t.waiting_on ? ` on ${t.waiting_on}` : ''}</span>}
          </p>
          {t.detail && <p className="mt-1.5 text-sm text-foreground whitespace-pre-wrap break-words">{t.detail}</p>}
        </div>
        <form action={completeTask.bind(null, t.id)} className="shrink-0">
          <button className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700">Done</button>
        </form>
      </div>
      <form action={saveNote.bind(null, t.id)} className="mt-2 flex gap-2">
        <input name="note" defaultValue={t.my_note ?? ''} placeholder="Add a note (where you are with it)" className="min-w-0 flex-1 rounded-md border border-gray-300 bg-card px-2.5 py-1.5 text-sm" />
        <button className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-gray-50">Save</button>
      </form>
    </article>
  )
}
