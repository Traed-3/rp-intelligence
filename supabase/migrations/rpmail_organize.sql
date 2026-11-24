-- RPMail stage 3 (part one): labels, block sender.
-- Server only, like every rpmail_* table: RLS on with no policies, no client grants.

-- Senders a mailbox has blocked. New mail from them goes straight to Gmail's Trash (kept 30 days).
create table if not exists public.rpmail_blocks (
  mailbox_id uuid not null references public.rpmail_mailboxes(id) on delete cascade,
  addr text not null check (addr = lower(addr) and length(addr) between 3 and 320),
  profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (mailbox_id, addr)
);
alter table public.rpmail_blocks enable row level security;
revoke all on public.rpmail_blocks from anon, authenticated;

-- "Move to a label" can be undone: the label that was added is kept with the move.
alter table public.rpmail_moves add column if not exists label_id text;

-- Add or remove one Gmail label on every indexed message of a conversation (the index copy; Gmail is changed by the app).
create or replace function public.rpmail_label_set(p_mailbox uuid, p_thread text, p_label text, p_on boolean)
returns void language sql security definer set search_path = '' as $$
  update public.rpmail_messages m
     set labels = case when p_on then (case when m.labels @> array[p_label] then m.labels else array_append(m.labels, p_label) end)
                       else array_remove(m.labels, p_label) end
   where m.mailbox_id = p_mailbox and m.thread_id = p_thread
$$;
revoke all on function public.rpmail_label_set(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.rpmail_label_set(uuid, text, text, boolean) to service_role;

-- A label was deleted in Gmail: take it off every indexed message of that mailbox.
create or replace function public.rpmail_label_drop(p_mailbox uuid, p_label text)
returns void language sql security definer set search_path = '' as $$
  update public.rpmail_messages m set labels = array_remove(m.labels, p_label)
   where m.mailbox_id = p_mailbox and m.labels @> array[p_label]
$$;
revoke all on function public.rpmail_label_drop(uuid, text) from public, anon, authenticated;
grant execute on function public.rpmail_label_drop(uuid, text) to service_role;

create index if not exists rpmail_messages_labels_idx on public.rpmail_messages using gin (labels);
