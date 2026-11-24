-- ============================================================
-- Add 'overspill_program' to the con_jobs.stage CHECK.
-- The Master Schedule color key includes an "Overspill Program"
-- stage; this lets jobs sit in it. Idempotent (drops whatever
-- CHECK currently governs stage, then recreates the full set).
-- ============================================================
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'con_jobs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%stage%';
  IF c IS NOT NULL THEN
    EXECUTE 'ALTER TABLE con_jobs DROP CONSTRAINT ' || quote_ident(c);
  END IF;
END $$;

ALTER TABLE con_jobs
  ADD CONSTRAINT con_jobs_stage_check CHECK (stage IN (
    'survey','quoting','permitting','material_ordering','needs_scheduled',
    'scheduled','in_progress','on_hold','return_needed','close_out',
    'invoicing','complete','overspill_program'
  ));
