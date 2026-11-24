-- RPMail: Proton mailboxes, reached through a helper on the Mac Studio that talks to Proton Bridge.
-- The website cannot reach Proton Bridge (it only listens on that Mac), so the helper calls the website and asks for work:
-- each Gmail-style question the website would put to Google is written here as a job, the helper answers it from Bridge,
-- and the website reads the answer and deletes the job. Answers can hold message text, so they live only for seconds.
alter table public.rpmail_mailboxes add column if not exists provider text not null default 'gmail';
alter table public.rpmail_mailboxes drop constraint if exists rpmail_mailboxes_provider_check;
alter table public.rpmail_mailboxes add constraint rpmail_mailboxes_provider_check check (provider in ('gmail', 'proton'));
alter table public.rpmail_mailboxes add column if not exists relay_seen_at timestamptz;   -- when the Mac helper last asked for work

create table if not exists public.rpmail_relay_jobs (
  id bigint generated always as identity primary key,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  address text not null,
  method text not null,
  path text not null,
  params jsonb not null default '{}'::jsonb,
  body jsonb,
  status text not null default 'new' check (status in ('new', 'taken', 'done')),
  code int,
  parts int,
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  done_at timestamptz
);
create index if not exists rpmail_relay_jobs_new_idx on public.rpmail_relay_jobs (status, created_at);

create table if not exists public.rpmail_relay_parts (
  job_id bigint not null references public.rpmail_relay_jobs(id) on delete cascade,
  seq int not null,
  data text not null,
  primary key (job_id, seq)
);

alter table public.rpmail_relay_jobs enable row level security;
alter table public.rpmail_relay_parts enable row level security;
revoke all on public.rpmail_relay_jobs, public.rpmail_relay_parts from anon, authenticated;
