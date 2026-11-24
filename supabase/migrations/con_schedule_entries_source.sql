-- Rows imported from the Job List sheet of "1 - Master schedule.xlsm" (Dropbox, Construction Department) carry
-- source = 'master_schedule', the stage text as written, and their position under the weekday line, so a re-import
-- (scripts/import-master-schedule.py) replaces those rows for the dates it covers without touching hand-entered ones.
ALTER TABLE con_schedule_entries
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS sort_order integer,
  ADD COLUMN IF NOT EXISTS stage_text text;
CREATE INDEX IF NOT EXISTS con_schedule_entries_source_idx ON con_schedule_entries (company_id, source, schedule_date);
