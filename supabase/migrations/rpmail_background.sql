-- RPMail stage 4: mail keeps syncing with nobody watching.
--   * failing_since / fail_alerted_at: when a mailbox's checks started failing, and when the owners were last told.
--   * notify_mark: new-mail notifications have been sent for mail up to this moment.
--   * rpmail_outbox_stale: attachments somebody uploaded for a message they never sent (server only).
--   * pg_cron job rpmail-sync, every 5 minutes, calls /api/rpmail/cron with the Vault token `rps_sync_token`
--     (the same token and check, public.sync_token_ok, as the billing and service sync jobs).
alter table public.rpmail_mailboxes
  add column if not exists failing_since timestamptz,
  add column if not exists fail_alerted_at timestamptz,
  add column if not exists notify_mark timestamptz;

create or replace function public.rpmail_outbox_stale(p_hours int default 48) returns setof text
language sql stable security definer set search_path = '' as $$
  select name from storage.objects where bucket_id = 'rpmail-outbox' and created_at < now() - make_interval(hours => greatest(p_hours, 1)) limit 500
$$;
revoke all on function public.rpmail_outbox_stale(int) from public, anon, authenticated;
grant execute on function public.rpmail_outbox_stale(int) to service_role;

create or replace function public.rpmail_cron_call() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_get(
    url := 'https://rpintelligence.app/api/rpmail/cron',
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'rps_sync_token')),
    timeout_milliseconds := 65000)
$$;
revoke all on function public.rpmail_cron_call() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'rpmail-sync';
select cron.schedule('rpmail-sync', '*/5 * * * *', $$select public.rpmail_cron_call()$$);
