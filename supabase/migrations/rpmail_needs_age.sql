-- RPMail: "Needs you" covers the last 30 days. Older unanswered mail stays in the inbox but no longer asks for a reply,
-- so a mailbox connected for the first time does not show a year of old questions. A conversation that came back from a
-- snooze or a reminder counts whatever its age: the person asked to see it again.
create or replace function public.rpmail_needs(p_profile uuid, p_mailbox uuid default null, p_limit int default 80)
returns setof public.rpmail_messages language sql stable security definer set search_path = '' as $$
  select m.* from public.rpmail_messages m
  join public.rpmail_mailboxes b on b.id = m.mailbox_id
  where (p_mailbox is null or m.mailbox_id = p_mailbox)
    and public.rpmail_allowed(p_profile, m.mailbox_id)
    and m.in_inbox and not m.sent and not m.bulk and lower(coalesce(m.from_addr, '')) <> b.address
    and (m.date > now() - interval '30 days'
         or exists (select 1 from public.rpmail_snoozes w where w.profile_id = p_profile and w.mailbox_id = m.mailbox_id and w.thread_id = m.thread_id and w.woke_at is not null))
    and not exists (select 1 from public.rpmail_messages s where s.mailbox_id = m.mailbox_id and s.thread_id = m.thread_id
                    and s.date > m.date and (s.sent or lower(coalesce(s.from_addr, '')) = b.address))
    and not exists (select 1 from public.rpmail_done d where d.profile_id = p_profile and d.mailbox_id = m.mailbox_id and d.gmail_id = m.gmail_id)
    and not exists (select 1 from public.rpmail_snoozes z where z.profile_id = p_profile and z.mailbox_id = m.mailbox_id and z.thread_id = m.thread_id
                    and z.kind = 'snooze' and z.woke_at is null)
  order by m.date desc limit greatest(1, least(p_limit, 500))
$$;
revoke all on function public.rpmail_needs(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.rpmail_needs(uuid, uuid, int) to service_role;
