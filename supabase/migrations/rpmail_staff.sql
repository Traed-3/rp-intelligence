-- RPMail for staff (Trae, 11/20/26): a per-user mail page inside RP Intelligence.
--
-- Rules this schema is built around:
--   * Opt-in, per user, never per role: a row in rpmail_users turns it on for that one person.
--   * A person sees a mailbox only with a row in rpmail_access. Their own mailbox gets that row when they connect it;
--     shared mailboxes are ticked per person by an owner in Settings -> RPMail.
--   * Only a small index is kept here (who, subject, date, Gmail's one-line preview, read/unread). The message itself
--     and its attachments are read live from Gmail when someone opens it, and are never stored.
--   * Google sign-in tokens live in Supabase Vault (encrypted), never in a table and never in a log.
--   * Every table: RLS on with no policies, so only the server (service role) can read or write. The server checks
--     rpmail_access on every request (lib/rpmail/access.ts).
--
-- rpmail_links (Trae's own local RPMail) is separate and untouched.

create table if not exists public.rpmail_users (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default true,
  enabled_by uuid references public.profiles(id) on delete set null,
  enabled_at timestamptz not null default now(),
  -- A Gmail address other than the person's login email, set by an owner (for a login that is not a Gmail address).
  mail_address text
);

create table if not exists public.rpmail_mailboxes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  address text not null,
  name text not null,
  kind text not null check (kind in ('personal', 'shared')),
  owner_id uuid references public.profiles(id) on delete cascade,      -- personal mailboxes only
  -- The crew reads this mailbox (its Sent mail included): customer pricing may never be sent to or from it,
  -- and it is the only kind of shared mailbox a tech, mechanic or shop login may be given.
  crew_reads boolean not null default false,
  token_secret_id uuid,                                               -- vault.secrets id of the Google refresh token
  scope text,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz,
  history_id text,
  sync jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check (address = lower(address)),
  check ((kind = 'personal') = (owner_id is not null))
);
create unique index if not exists rpmail_mailboxes_address_uidx on public.rpmail_mailboxes (address);

create table if not exists public.rpmail_access (
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (mailbox_id, profile_id)
);
create index if not exists rpmail_access_profile_idx on public.rpmail_access (profile_id);

-- The index. No message bodies, no attachments.
create table if not exists public.rpmail_messages (
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  gmail_id text not null,
  thread_id text not null,
  date timestamptz not null,
  from_name text,
  from_addr text,
  to_addrs text,
  cc_addrs text,
  reply_to text,
  subject text,
  snippet text,
  msgid text,
  refs text,
  unread boolean not null default false,
  in_inbox boolean not null default false,
  sent boolean not null default false,
  starred boolean not null default false,
  has_att boolean not null default false,
  bulk boolean not null default false,
  asks boolean not null default false,          -- the top of the message asks for something ("?", "please advise", ...)
  deadline text,                                -- a few words around a deadline phrase, when there is one
  site text,
  po text,
  labels text[] not null default '{}',
  primary key (mailbox_id, gmail_id)
);
create index if not exists rpmail_messages_date_idx on public.rpmail_messages (mailbox_id, date desc);
create index if not exists rpmail_messages_thread_idx on public.rpmail_messages (mailbox_id, thread_id);
create index if not exists rpmail_messages_inbox_idx on public.rpmail_messages (mailbox_id, date desc) where in_inbox;
create index if not exists rpmail_messages_site_idx on public.rpmail_messages (mailbox_id, site) where site is not null;

-- "Done" is each person's own tick on their lists. Nothing changes in Gmail.
create table if not exists public.rpmail_done (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  gmail_id text not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, mailbox_id, gmail_id)
);

-- Archive / Spam / Trash / back to Inbox, who did it, and whether it was undone.
create table if not exists public.rpmail_moves (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  gmail_id text not null,
  thread_id text not null,
  subject text,
  from_place text not null,
  to_place text not null,
  undone boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists rpmail_moves_profile_idx on public.rpmail_moves (profile_id, id desc);

-- Who sent what from which mailbox (shared mailboxes have several senders). No message text.
create table if not exists public.rpmail_sent (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  kind text not null check (kind in ('send', 'draft')),
  to_addrs text,
  subject text,
  gmail_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.rpmail_signatures (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  body text not null default '',
  primary key (profile_id, mailbox_id)
);

create table if not exists public.rpmail_summaries (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, day)
);

-- One-time tickets for the "Sign in with Google" round trip (15 minutes).
create table if not exists public.rpmail_oauth_states (
  state text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rpmail_users enable row level security;
alter table public.rpmail_mailboxes enable row level security;
alter table public.rpmail_access enable row level security;
alter table public.rpmail_messages enable row level security;
alter table public.rpmail_done enable row level security;
alter table public.rpmail_moves enable row level security;
alter table public.rpmail_sent enable row level security;
alter table public.rpmail_signatures enable row level security;
alter table public.rpmail_summaries enable row level security;
alter table public.rpmail_oauth_states enable row level security;

-- ── Google sign-in tokens: Vault only ─────────────────────────────────────────────────────────────────────────
create or replace function public.rpmail_token_set(p_mailbox uuid, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'no token'; end if;
  select token_secret_id into sid from public.rpmail_mailboxes where id = p_mailbox for update;
  if not found then raise exception 'no such mailbox'; end if;
  if sid is not null and exists (select 1 from vault.secrets where id = sid) then
    perform vault.update_secret(sid, p_token);
  else
    sid := vault.create_secret(p_token, 'rpmail:' || p_mailbox::text, 'RPMail Google sign-in for one mailbox');
    update public.rpmail_mailboxes set token_secret_id = sid where id = p_mailbox;
  end if;
end $$;

create or replace function public.rpmail_token_get(p_mailbox uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret from vault.decrypted_secrets s
  join public.rpmail_mailboxes m on m.token_secret_id = s.id where m.id = p_mailbox
$$;

create or replace function public.rpmail_token_clear(p_mailbox uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select token_secret_id into sid from public.rpmail_mailboxes where id = p_mailbox for update;
  if sid is not null then delete from vault.secrets where id = sid; end if;
  update public.rpmail_mailboxes set token_secret_id = null, scope = null, connected_at = null, connected_by = null,
    history_id = null, sync = '{}'::jsonb, last_error = null where id = p_mailbox;
  delete from public.rpmail_messages where mailbox_id = p_mailbox;
end $$;

-- A mailbox row that goes away (a person removed, a shared mailbox deleted) takes its token with it.
create or replace function public.rpmail_mailbox_drop_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.token_secret_id is not null then delete from vault.secrets where id = old.token_secret_id; end if;
  return old;
end $$;
drop trigger if exists rpmail_mailbox_drop_token on public.rpmail_mailboxes;
create trigger rpmail_mailbox_drop_token before delete on public.rpmail_mailboxes
  for each row execute function public.rpmail_mailbox_drop_token();

revoke all on function public.rpmail_token_set(uuid, text) from public, anon, authenticated;
revoke all on function public.rpmail_token_get(uuid) from public, anon, authenticated;
revoke all on function public.rpmail_token_clear(uuid) from public, anon, authenticated;
revoke all on function public.rpmail_mailbox_drop_token() from public, anon, authenticated;
grant execute on function public.rpmail_token_set(uuid, text) to service_role;
grant execute on function public.rpmail_token_get(uuid) to service_role;
grant execute on function public.rpmail_token_clear(uuid) to service_role;

-- "Needs you" for one person: mail in the inbox of a mailbox they may see, from someone else, not automated,
-- with no later message from that mailbox in the same conversation, and not ticked Done by them.
create or replace function public.rpmail_needs(p_profile uuid, p_mailbox uuid default null, p_limit int default 80)
returns setof public.rpmail_messages
language sql stable security definer set search_path = '' as $$
  select m.* from public.rpmail_messages m
  join public.rpmail_access a on a.mailbox_id = m.mailbox_id and a.profile_id = p_profile
  join public.rpmail_mailboxes b on b.id = m.mailbox_id
  where (p_mailbox is null or m.mailbox_id = p_mailbox)
    and m.in_inbox and not m.sent and not m.bulk and lower(coalesce(m.from_addr, '')) <> b.address
    and not exists (select 1 from public.rpmail_messages s where s.mailbox_id = m.mailbox_id and s.thread_id = m.thread_id
                    and s.date > m.date and (s.sent or lower(coalesce(s.from_addr, '')) = b.address))
    and not exists (select 1 from public.rpmail_done d where d.profile_id = p_profile and d.mailbox_id = m.mailbox_id and d.gmail_id = m.gmail_id)
  order by m.date desc limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.rpmail_needs(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.rpmail_needs(uuid, uuid, int) to service_role;

-- Inbox and unread counts for the mailboxes one person may see.
create or replace function public.rpmail_counts(p_profile uuid)
returns table (mailbox_id uuid, inbox bigint, unread bigint, newest timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.mailbox_id, count(*), count(*) filter (where m.unread), max(m.date)
  from public.rpmail_messages m
  join public.rpmail_access a on a.mailbox_id = m.mailbox_id and a.profile_id = p_profile
  where m.in_inbox group by m.mailbox_id
$$;
revoke all on function public.rpmail_counts(uuid) from public, anon, authenticated;
grant execute on function public.rpmail_counts(uuid) to service_role;
