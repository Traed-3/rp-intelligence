-- Billing inboxes + construction job-email feed on Supabase's own scheduler (pg_cron + pg_net), every 15 minutes.
--
-- Why: GitHub's "*/15" schedule for gmail-sync.yml fired only every 5-7 hours (construction audit 2026-11-05), so crew
-- updates, Peggy's invoice workbooks and receipts reached the app hours late or not at all. Same pattern as
-- svc_sync_pg_cron.sql: the token lives only in Vault (`rps_sync_token`, created there) and the route checks it
-- with public.sync_token_ok(). gmail-sync.yml keeps the billing job for manual runs only.
--
-- Applied to project zktmhxheouwbyupeizjq through the Supabase MCP on 2026-11-06, after the route change deployed.
-- Check it with:  select jobname, status, start_time from cron.job_run_details d join cron.job j using (jobid)
--                   where jobname like 'billing-sync-%' order by start_time desc limit 20;

create or replace function public.billing_sync_call(pass_query text) returns bigint
language sql security definer set search_path = '' as $$
  select net.http_get(
    url := 'https://rps-maintenance.vercel.app/api/billing/inbox-sync?' || pass_query,
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'rps_sync_token')),
    timeout_milliseconds := 65000)
$$;
revoke all on function public.billing_sync_call(text) from public, anon, authenticated;

-- Staggered between the svc passes (minutes 1, 4, 8, 11 of each quarter hour).
select cron.unschedule(jobname) from cron.job where jobname like 'billing-sync-%';
select cron.schedule('billing-sync-updates', '2,17,32,47 * * * *',  $$select public.billing_sync_call('pass=updates&since=3')$$);
select cron.schedule('billing-sync-inbox',   '6,21,36,51 * * * *',  $$select public.billing_sync_call('pass=sync&max=30')$$);
select cron.schedule('billing-sync-extract', '9,24,39,54 * * * *',  $$select public.billing_sync_call('pass=extract&limit=3')$$);
select cron.schedule('billing-sync-orders',  '13,28,43,58 * * * *', $$select public.billing_sync_call('pass=orders&since=3')$$);
