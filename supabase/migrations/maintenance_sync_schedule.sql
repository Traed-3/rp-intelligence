-- Shop-mail (maintenance.rps / eshoptasks) sync on Supabase's own scheduler (pg_cron + pg_net), every 15 minutes,
-- plus a one-run-at-a-time lock.
--
-- Why: GitHub's "*/15" schedule ran the shop-mail sync only every ~1–5 hours (maintenance audit 2026-11-05), and
-- Vercel Hobby only allows daily crons. Same pattern as svc_sync_pg_cron.sql / billing_sync_pg_cron.sql: the token
-- lives only in Vault (`rps_sync_token`) and /api/gmail/sync checks it with public.sync_token_ok().
-- gmail-sync.yml keeps the shop-mail job for manual runs only.
--
-- Applied to project zktmhxheouwbyupeizjq through the Supabase MCP on 2026-11-06, after the route change deployed.
-- Check it with:  select jobname, status, start_time from cron.job_run_details d join cron.job j using (jobid)
--                   where jobname = 'maint-gmail-sync' order by start_time desc limit 20;

-- ── One sync at a time (pg_cron, a manual GitHub run, the daily summary and the Settings button can overlap) ──
create table if not exists public.sync_locks (
  name         text primary key,
  locked_until timestamptz not null default 'epoch'
);
alter table public.sync_locks enable row level security;   -- no policies: service role only

create or replace function public.try_sync_lock(p_name text, p_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.sync_locks(name) values (p_name) on conflict (name) do nothing;
  update public.sync_locks set locked_until = now() + make_interval(secs => p_seconds)
   where name = p_name and locked_until < now();
  return found;
end $$;

create or replace function public.release_sync_lock(p_name text)
returns void language sql security definer set search_path = '' as $$
  update public.sync_locks set locked_until = 'epoch' where name = p_name;
$$;

revoke all on function public.try_sync_lock(text, int) from public, anon, authenticated;
revoke all on function public.release_sync_lock(text)  from public, anon, authenticated;
grant execute on function public.try_sync_lock(text, int) to service_role;
grant execute on function public.release_sync_lock(text)  to service_role;

-- ── Every 15 minutes, on minutes no other sync uses (svc 1/4/8/11, billing 2/6/9/13) ──
create or replace function public.maint_sync_call(pass_query text) returns bigint
language sql security definer set search_path = '' as $$
  select net.http_get(
    url := 'https://rps-maintenance.vercel.app/api/gmail/sync?' || pass_query,
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'rps_sync_token')),
    timeout_milliseconds := 65000)
$$;
revoke all on function public.maint_sync_call(text) from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'maint-gmail-sync';
select cron.schedule('maint-gmail-sync', '5,20,35,50 * * * *', $$select public.maint_sync_call('recentDays=3')$$);
