-- Personal follow-up list ("My Plate", /my): what one person owes, ordered so the top row is the next thing to do.
-- Seeded from the /rps-project-intake open items (scripts/my-tasks-upsert.ts); edited from the page.
CREATE TABLE IF NOT EXISTS con_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  owner_id       uuid NOT NULL REFERENCES profiles ON DELETE CASCADE,
  title          text NOT NULL,
  detail         text,
  kind           text NOT NULL DEFAULT 'followup' CHECK (kind IN ('quote','price','order','bid','survey','followup','admin')),
  site_number    text,
  job_id         uuid REFERENCES con_jobs ON DELETE SET NULL,
  quote_id       uuid REFERENCES con_quotes ON DELETE SET NULL,
  priority       smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),   -- 1 hot, 2 normal, 3 low
  due_date       date,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','done','dropped')),
  waiting_on     text,                      -- who owes the next move when status = 'waiting'
  waiting_since  date,
  snoozed_until  date,
  source         text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','intake','signal')),
  source_key     text,                      -- dedupe key for imports (intake: site|item hash; signal: the signal key)
  done_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Plain unique index (not partial): PostgREST upsert targets it, and NULL source_keys never collide.
CREATE UNIQUE INDEX IF NOT EXISTS con_tasks_source_key_uidx ON con_tasks (company_id, owner_id, source_key);
CREATE INDEX IF NOT EXISTS con_tasks_owner_status_idx ON con_tasks (owner_id, status, due_date);
ALTER TABLE con_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS con_tasks_read ON con_tasks;
CREATE POLICY con_tasks_read ON con_tasks FOR SELECT USING (company_id = con_user_company_id() AND con_can_read());
DROP POLICY IF EXISTS con_tasks_write ON con_tasks;
CREATE POLICY con_tasks_write ON con_tasks FOR ALL USING (company_id = con_user_company_id() AND con_can_write());
