-- Maintenance email sync: reliable 15-minute schedule + one-run-at-a-time lock.
--
-- Why: GitHub Actions' "*/15" schedule is best-effort and ran the shop-mail sync
-- only every ~1–5 hours, and Vercel Hobby only allows daily crons. Supabase
-- pg_cron + pg_net call /api/gmail/sync every 15 minutes instead. The route
-- accepts this call with an `x-cron-key` header whose value lives in Supabase
-- Vault and is checked by verify_cron_key() — no Vercel env change needed.
-- APPLIED 2026-11-06 via the Supabase MCP connector.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ── One sync at a time ────────────────────────────────────────────────────────
create table if not exists public.sync_locks (
  name         text primary key,
  locked_until timestamptz not null default 'epoch'
);
alter table public.sync_locks enable row level security;   -- no policies: service role only

create or replace function public.try_sync_lock(p_name text, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into sync_locks(name) values (p_name) on conflict (name) do nothing;
  update sync_locks set locked_until = now() + make_interval(secs => p_seconds)
   where name = p_name and locked_until < now();
  return found;
end $$;

create or replace function public.release_sync_lock(p_name text)
returns void language sql security definer set search_path = public as $$
  update sync_locks set locked_until = 'epoch' where name = p_name;
$$;

-- ── Scheduler key (Vault) ─────────────────────────────────────────────────────
create or replace function public.verify_cron_key(p_name text, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from vault.decrypted_secrets where name = p_name and decrypted_secret = p_key
  ), false);
$$;

revoke all on function public.try_sync_lock(text, int)    from public, anon, authenticated;
revoke all on function public.release_sync_lock(text)     from public, anon, authenticated;
revoke all on function public.verify_cron_key(text, text) from public, anon, authenticated;
grant execute on function public.try_sync_lock(text, int)    to service_role;
grant execute on function public.release_sync_lock(text)     to service_role;
grant execute on function public.verify_cron_key(text, text) to service_role;

select vault.create_secret(
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  'maint_sync_cron_key',
  'Key Supabase pg_cron sends to /api/gmail/sync (x-cron-key header)'
) where not exists (select 1 from vault.secrets where name = 'maint_sync_cron_key');

-- ── Every 15 minutes ──────────────────────────────────────────────────────────
select cron.unschedule('maint-gmail-sync') where exists (select 1 from cron.job where jobname = 'maint-gmail-sync');
select cron.schedule('maint-gmail-sync', '*/15 * * * *', $job$
  select net.http_get(
    url     := 'https://rps-maintenance.vercel.app/api/gmail/sync',
    headers := jsonb_build_object('x-cron-key',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'maint_sync_cron_key')),
    timeout_milliseconds := 60000
  );
$job$);
