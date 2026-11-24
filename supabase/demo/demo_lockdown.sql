-- Demo project only: no browser uploads to storage, and a nightly wipe + reseed.
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'UPDATE', 'ALL') loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'demo-nightly-reset';
-- 08:00 UTC = 3 AM Eastern (4 AM during daylight time).
select cron.schedule('demo-nightly-reset', '0 8 * * *', 'select public.demo_reseed()');
