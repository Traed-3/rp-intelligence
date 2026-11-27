-- Time clock: catch a forgotten clock-out, and let a manager fix the time.
--   * needs_review / review_reason: the entry must be fixed by a manager before it can be approved or paid.
--   * auto_clocked_out_at: the system closed the entry because nobody clocked out. Hours are held at 0 until fixed.
--   * reminded_at / remind_count: "still clocked in?" reminders already sent for this entry.
--   * fix_requested_*: the employee's own "this is what my time should be" request, waiting on a manager.
--   * original_clock_in / original_clock_out: what the entry said before the first manager fix (never overwritten).
--   * source: app (clock button), manager (added by hand), truck_log (imported from the const.log truck logs).
--   * site_log: every site on a truck-log day with minutes on site, e.g. [{"site":"SU-8001","minutes":372}].
--   * pg_cron job time-clock-guard, every 10 minutes, calls /api/time/clock-guard with the Vault token
--     `rps_sync_token` (the same token and check, public.sync_token_ok, as the other background jobs).
alter table public.time_clock_entries
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_reason text,
  add column if not exists auto_clocked_out_at timestamptz,
  add column if not exists reminded_at timestamptz,
  add column if not exists remind_count integer not null default 0,
  add column if not exists fix_requested_at timestamptz,
  add column if not exists fix_requested_in timestamptz,
  add column if not exists fix_requested_out timestamptz,
  add column if not exists fix_requested_break integer,
  add column if not exists fix_request_note text,
  add column if not exists original_clock_in timestamptz,
  add column if not exists original_clock_out timestamptz,
  add column if not exists source text not null default 'app',
  add column if not exists site_log jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'time_clock_entries_source_check') then
    alter table public.time_clock_entries
      add constraint time_clock_entries_source_check check (source in ('app', 'manager', 'truck_log'));
  end if;
end $$;

update public.time_clock_entries set source = 'truck_log'
 where source = 'app' and adjustment_note like 'Truck log import%';

create index if not exists time_clock_entries_open_idx on public.time_clock_entries (company_id, clock_in) where clock_out is null;
create index if not exists time_clock_entries_review_idx on public.time_clock_entries (company_id) where needs_review or fix_requested_at is not null;

create or replace function public.time_clock_guard_call() returns bigint
language sql security definer set search_path = '' as $$
  select net.http_get(
    url := 'https://rpintelligence.app/api/time/clock-guard',
    headers := jsonb_build_object('Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'rps_sync_token')),
    timeout_milliseconds := 30000)
$$;
revoke all on function public.time_clock_guard_call() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'time-clock-guard';
select cron.schedule('time-clock-guard', '*/10 * * * *', $$select public.time_clock_guard_call()$$);
