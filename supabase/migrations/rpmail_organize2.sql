-- RPMail stage 3 (part two): snooze / remind me, and rules.
-- Server only, like every rpmail_* table: RLS on with no policies, no client grants.

-- A person's own snoozes and reminders. Nothing changes in Gmail and nobody else's lists change.
--   snooze: the conversation is off this person's Inbox and Needs you lists until `until`, then it comes back.
--   remind: nothing is hidden; at `until` the person is reminded, unless somebody has replied in the meantime.
create table if not exists public.rpmail_snoozes (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  gmail_id text not null,
  thread_id text not null,
  subject text,
  kind text not null check (kind in ('snooze', 'remind')),
  until timestamptz not null,
  woke_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, mailbox_id, thread_id)
);
create index if not exists rpmail_snoozes_due_idx on public.rpmail_snoozes (until) where woke_at is null;
alter table public.rpmail_snoozes enable row level security;
revoke all on public.rpmail_snoozes from anon, authenticated;

-- What to do with mail as it arrives in a mailbox. `match` and `action` are small JSON objects checked by the app.
create table if not exists public.rpmail_rules (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  name text not null,
  position int not null default 0,
  enabled boolean not null default true,
  match jsonb not null default '{}'::jsonb,
  action jsonb not null default '{}'::jsonb,
  profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rpmail_rules_box_idx on public.rpmail_rules (mailbox_id, position);
alter table public.rpmail_rules enable row level security;
revoke all on public.rpmail_rules from anon, authenticated;

-- A rule can say "never send a notification for this".
alter table public.rpmail_messages add column if not exists quiet boolean not null default false;

-- Needs you leaves out what this person has snoozed, everywhere it is used (lists, dashboard, counts, summaries).
create or replace function public.rpmail_needs(p_profile uuid, p_mailbox uuid default null, p_limit int default 80)
returns setof public.rpmail_messages language sql stable security definer set search_path = '' as $$
  select m.* from public.rpmail_messages m
  join public.rpmail_mailboxes b on b.id = m.mailbox_id
  where (p_mailbox is null or m.mailbox_id = p_mailbox)
    and public.rpmail_allowed(p_profile, m.mailbox_id)
    and m.in_inbox and not m.sent and not m.bulk and lower(coalesce(m.from_addr, '')) <> b.address
    and not exists (select 1 from public.rpmail_messages s where s.mailbox_id = m.mailbox_id and s.thread_id = m.thread_id
                    and s.date > m.date and (s.sent or lower(coalesce(s.from_addr, '')) = b.address))
    and not exists (select 1 from public.rpmail_done d where d.profile_id = p_profile and d.mailbox_id = m.mailbox_id and d.gmail_id = m.gmail_id)
    and not exists (select 1 from public.rpmail_snoozes z where z.profile_id = p_profile and z.mailbox_id = m.mailbox_id and z.thread_id = m.thread_id
                    and z.kind = 'snooze' and z.woke_at is null)
  order by m.date desc limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.rpmail_needs(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.rpmail_needs(uuid, uuid, int) to service_role;
