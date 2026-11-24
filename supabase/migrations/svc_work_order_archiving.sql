-- Lets a supervisor archive one or many Service Dispatch work orders off the
-- dashboard (individually or in bulk) with a required reason, and clears the
-- source dispatch email out of rpdispatcher's inbox at the same time so the
-- two stay in sync.
ALTER TABLE svc_work_orders
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id);

CREATE INDEX IF NOT EXISTS svc_work_orders_archived_idx ON svc_work_orders (company_id, archived);
