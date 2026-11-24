-- Service Dispatch sync on Supabase's own scheduler (pg_cron + pg_net), every 15 minutes.
--
-- Why: GitHub's "*/15" schedule for gmail-sync.yml actually fired about every 5-7 hours, and half of those
-- runs failed (audit 2026-11-05), so calls, tickets and invoice approvals sat unread for most of the day.
-- The four svc passes now run from here; gmail-sync.yml keeps them for manual runs only.
--
-- Security: the token is generated INSIDE the database and kept in Vault (`rps_sync_token`). It never appears
-- in git, in Vercel or in a chat. The cron jobs read it from Vault; the app checks it with sync_token_ok(),
-- which only the service role can call.
--
-- Applied to project zktmhxheouwbyupeizjq through the Supabase MCP on 2026-11-06.
-- Check it with:  select * from cron.job_run_details order by start_time desc limit 20;
--                 select status_code, created, left(content, 200) from net._http_response order by created desc limit 20;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'rps_sync_token') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'rps_sync_token',
      'Bearer token the pg_cron sync jobs send to the app (checked by public.sync_token_ok)');
  end if;
end $$;

create or replace function public.sync_token_ok(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(t is not null and length(t) >= 32 and exists (
    select 1 from vault.decrypted_secrets where name = 'rps_sync_token' and decrypted_secret = t), false)
$$;
revoke all on function public.sync_token_ok(text) from public, anon, authenticated;
grant execute on function public.sync_token_ok(text) to service_role;

-- One place for the app URL + token; returns the pg_net request id.
create or replace function public.svc_sync_call(pass_query text) returns bigint
language sql security definer set search_path = '' as $$
  select net.http_get(
    url := 'https://rps-maintenance.vercel.app/api/svc/gmail-sync?' || pass_query,
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'rps_sync_token')),
    timeout_milliseconds := 65000)
$$;
revoke all on function public.svc_sync_call(text) from public, anon, authenticated;

-- Staggered so the two Gmail mailboxes and the database passes never pile onto the same minute.
select cron.unschedule(jobname) from cron.job where jobname like 'svc-sync-%';
select cron.schedule('svc-sync-dispatcher',   '1,16,31,46 * * * *',  $$select public.svc_sync_call('pass=dispatcher')$$);
select cron.schedule('svc-sync-invoicing',    '4,19,34,49 * * * *',  $$select public.svc_sync_call('pass=invoicing')$$);
select cron.schedule('svc-sync-reconcile',    '8,23,38,53 * * * *',  $$select public.svc_sync_call('pass=reconcile&apply=1')$$);
select cron.schedule('svc-sync-extract-docs', '11,26,41,56 * * * *', $$select public.svc_sync_call('pass=extract-docs&limit=5')$$);
-- Keep the scheduler's own log small.
select cron.schedule('svc-sync-log-cleanup',  '17 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
