-- RPMail stage 2 (writing mail).
--   * rpmail_templates: each person's own canned replies.
--   * Storage bucket rpmail-outbox (private): files a person attaches to a message they are writing wait here, under
--     their own profile id, until they press Send or Save draft; then they are deleted. Nothing received is stored.
create table if not exists public.rpmail_templates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rpmail_templates_profile_idx on public.rpmail_templates (profile_id, name);
alter table public.rpmail_templates enable row level security;
revoke all on public.rpmail_templates from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('rpmail-outbox', 'rpmail-outbox', false, 26214400)
on conflict (id) do nothing;
