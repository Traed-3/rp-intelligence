-- ============================================================
-- Track con_schedule_entries.entry_type in migrations.
-- This column already exists in the live database (added ad-hoc
-- when the schedule form shipped) but was never captured in a
-- migration. This makes the schema reproducible. Idempotent.
-- ============================================================
ALTER TABLE con_schedule_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'job';

-- Constrain to the three kinds the schedule form uses.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'con_schedule_entries'::regclass
      AND conname = 'con_schedule_entries_entry_type_check'
  ) THEN
    ALTER TABLE con_schedule_entries
      ADD CONSTRAINT con_schedule_entries_entry_type_check
      CHECK (entry_type IN ('job', 'time_off', 'note'));
  END IF;
END $$;
