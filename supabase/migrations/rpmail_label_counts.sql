-- RPMail: how many messages (and how many unread) each label / folder holds in one mailbox, for the folder tree on the
-- left of the mail window (Trae, 2026-11-25). Counts come from RPMail's own index (the inbox and the last 90 days),
-- so a folder's total is what RPMail has loaded, not everything in Gmail. Server only: the website checks that the
-- person has the mailbox before it asks.
create or replace function public.rpmail_label_counts(p_mailbox uuid) returns table(label text, total bigint, unread bigint)
language sql stable security definer set search_path = '' as $$
  select l, count(*), count(*) filter (where m.unread)
  from public.rpmail_messages m, unnest(m.labels) as l
  where m.mailbox_id = p_mailbox
  group by l
$$;
revoke all on function public.rpmail_label_counts(uuid) from public, anon, authenticated;
grant execute on function public.rpmail_label_counts(uuid) to service_role;
