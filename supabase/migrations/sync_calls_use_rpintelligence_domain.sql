-- The app moved to https://rpintelligence.app (rps-maintenance.vercel.app still serves, with separate login cookies).
-- Point the pg_cron sync callers (svc_sync_call, billing_sync_call, maint_sync_call) at the new domain.
-- APPLIED 2026-11-06 via the Supabase MCP connector.
do $$
declare f text;
begin
  foreach f in array array['public.svc_sync_call','public.billing_sync_call','public.maint_sync_call'] loop
    execute replace(pg_get_functiondef(f::regproc), 'https://rps-maintenance.vercel.app/', 'https://rpintelligence.app/');
  end loop;
end $$;
