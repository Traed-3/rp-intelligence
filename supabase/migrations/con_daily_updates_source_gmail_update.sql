-- Typed tech updates filed straight from econstruction mail (lib/job-email-feed.ts) carry source = 'gmail_update'.
ALTER TABLE con_daily_updates DROP CONSTRAINT IF EXISTS con_daily_updates_source_check;
ALTER TABLE con_daily_updates ADD CONSTRAINT con_daily_updates_source_check CHECK (source = ANY (ARRAY['manual'::text, 'gmail_backfill'::text, 'gmail_update'::text]));
