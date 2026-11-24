-- RPMail: schedule send (Trae, 2026-11-24: "Yes, build it").
-- A scheduled message waits as an ordinary draft in the person's own mailbox (Gmail Drafts, or Proton Drafts through the
-- Mac helper), so the words and attachments stay in the mailbox and are never stored here. This table only says which
-- draft goes out when, from which mailbox, for whom; plus who it is to and the subject, for the person's own list.
-- A pg_cron job checks every minute and sends what is due, after checking again that the person still may send from
-- that mailbox and that the pricing and blocked-content rules still pass. A send is never tried twice by itself: a row
-- that started sending and never finished is marked failed ("look in Sent"), not sent again.
create table if not exists public.rpmail_scheduled (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  draft_id text not null,
  thread_id text,
  to_addrs text not null default '',
  subject text not null default '',
  send_at timestamptz not null,
  status text not null default 'waiting' check (status in ('waiting', 'sending', 'sent', 'failed', 'cancelled')),
  tries int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  gmail_id text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists rpmail_scheduled_due_idx on public.rpmail_scheduled (status, send_at);
create index if not exists rpmail_scheduled_person_idx on public.rpmail_scheduled (profile_id, status);
create index if not exists rpmail_scheduled_draft_idx on public.rpmail_scheduled (mailbox_id, draft_id);

alter table public.rpmail_scheduled enable row level security;
revoke all on public.rpmail_scheduled from anon, authenticated;

-- The every-minute call: only the "send what is due" part of the background job (fast; one query when nothing is due).
create or replace function public.rpmail_cron_call_scheduled() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_get(
    url := 'https://rpintelligence.app/api/rpmail/cron?part=scheduled',
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'rps_sync_token')),
    timeout_milliseconds := 65000)
$$;
revoke all on function public.rpmail_cron_call_scheduled() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'rpmail-scheduled';
select cron.schedule('rpmail-scheduled', '* * * * *', $$select public.rpmail_cron_call_scheduled()$$);
