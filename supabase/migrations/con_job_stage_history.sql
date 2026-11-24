-- ============================================================
-- Job stage-history log. con_jobs.stage has always been a bare column
-- overwrite with zero history — this adds an append-only audit trail,
-- written by a trigger so it captures every path that changes the stage
-- (not just the changeJobStage() server action). Additive only.
-- ============================================================
CREATE TABLE IF NOT EXISTS con_job_stage_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES con_jobs ON DELETE CASCADE,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  changed_by      uuid REFERENCES profiles ON DELETE SET NULL,
  changed_by_name text,
  from_stage      text,
  to_stage        text
);
CREATE INDEX IF NOT EXISTS con_job_stage_history_job_idx ON con_job_stage_history (job_id, changed_at DESC);
ALTER TABLE con_job_stage_history ENABLE ROW LEVEL SECURITY;

-- Fires on INSERT (one starting entry) and on UPDATE where stage actually
-- changed. The trigger itself never knows WHO made the change (Supabase's
-- pooled connections make a session-variable "current actor" trick
-- unreliable) — changed_by/changed_by_name start NULL and changeJobStage()
-- immediately patches the row it just caused with the actor's identity.
-- This still guarantees a row for any OTHER code path that ever updates
-- con_jobs.stage directly, just without an attributed actor.
CREATE OR REPLACE FUNCTION con_log_job_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO con_job_stage_history (company_id, job_id, from_stage, to_stage)
    VALUES (NEW.company_id, NEW.id, NULL, NEW.stage);
  ELSIF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO con_job_stage_history (company_id, job_id, from_stage, to_stage)
    VALUES (NEW.company_id, NEW.id, OLD.stage, NEW.stage);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS con_jobs_stage_history ON con_jobs;
CREATE TRIGGER con_jobs_stage_history AFTER INSERT OR UPDATE ON con_jobs
  FOR EACH ROW EXECUTE FUNCTION con_log_job_stage_change();

-- Seed one row per existing job so every job starts with at least one
-- history entry, dated to when the job itself was created.
INSERT INTO con_job_stage_history (company_id, job_id, changed_at, from_stage, to_stage)
SELECT company_id, id, created_at, NULL, stage FROM con_jobs
WHERE NOT EXISTS (SELECT 1 FROM con_job_stage_history WHERE job_id = con_jobs.id);
