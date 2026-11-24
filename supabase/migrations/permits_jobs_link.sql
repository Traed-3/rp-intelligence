-- ============================================================
-- Link the Permits module to Construction jobs.
-- "If we have a permit, it's a project" — a permit project should always
-- resolve to a con_jobs row. job_id lives on con_permit_projects (not
-- con_permit_sites, which can have several projects/jobs over time; not
-- con_permits, whose permits should share one job link per project).
-- Additive only. Safe to re-run.
-- ============================================================
ALTER TABLE con_permit_projects ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES con_jobs ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS con_permit_projects_job_idx ON con_permit_projects (job_id);
