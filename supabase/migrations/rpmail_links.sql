-- RPMail: a per-user link to that person's own mail manager (Trae, 11/20/26). Applied to production 11/20/26.
-- No row = no menu entry and no page. Read only by the server (service role); RLS on with no policies.
create table if not exists public.rpmail_links (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  url text not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.rpmail_links enable row level security;
