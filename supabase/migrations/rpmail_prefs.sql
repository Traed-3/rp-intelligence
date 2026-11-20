-- RPMail: each person's own screen choices (which dashboard boxes are closed, and their order).
-- Server only, like every rpmail_* table: RLS on with no policies, no client grants.
create table if not exists public.rpmail_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.rpmail_prefs enable row level security;
revoke all on public.rpmail_prefs from anon, authenticated;
