-- RPMail stage 5 (company admin): what each person may do in a shared mailbox, an activity log, and the company's
-- own blocked-content rules. Server only, like every rpmail_* table: RLS on with no policies, no client grants.

-- Reading comes with the access row. Sending and deleting can each be switched off for one person on one mailbox.
-- (A person's own mailbox, and an owner on any mailbox, always have both: the app decides that, not these columns.)
alter table public.rpmail_access add column if not exists can_send boolean not null default true;
alter table public.rpmail_access add column if not exists can_delete boolean not null default true;

-- Who did what: mailbox sign-ins, sends, deletes, access changes, rule changes. No message text is kept, only the
-- subject line and who it went to. An entry outlives the mailbox and the person it is about, so there are no
-- foreign keys to them.
create table if not exists public.rpmail_activity (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  profile_id uuid,
  kind text not null,
  mailbox_id uuid,
  mailbox_address text,
  target_id uuid,
  detail text,
  at timestamptz not null default now()
);
create index if not exists rpmail_activity_company_idx on public.rpmail_activity (company_id, id desc);
alter table public.rpmail_activity enable row level security;
revoke all on public.rpmail_activity from anon, authenticated;

-- Settings that belong to the whole company (today: the blocked-content rules an owner writes).
create table if not exists public.rpmail_company (
  company_id uuid primary key,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.rpmail_company enable row level security;
revoke all on public.rpmail_company from anon, authenticated;
