-- ============================================================
-- Ticket log — a record of every ticket sent in, with what is written on the
-- front, what is written on the back (parts / materials), and a parts list
-- that can be searched. Builds on svc_work_order_documents (one row per
-- rpinvoicing email): the single `transcript` block stays as the editable
-- full text; these columns hold the same read split into its pieces.
--
-- extract_version: 1 = the original one-block read, 2 = front/back/parts read.
-- con_job_id: construction crew tickets belong to a job, not a service call.
-- ============================================================

ALTER TABLE svc_work_order_documents
  ADD COLUMN IF NOT EXISTS front_text       text,
  ADD COLUMN IF NOT EXISTS back_text        text,
  ADD COLUMN IF NOT EXISTS other_text       text,
  ADD COLUMN IF NOT EXISTS parts            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pages            jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ticket_wo_number text,
  ADD COLUMN IF NOT EXISTS ticket_site      text,
  ADD COLUMN IF NOT EXISTS work_date        date,
  ADD COLUMN IF NOT EXISTS technician       text,
  ADD COLUMN IF NOT EXISTS helper           text,
  ADD COLUMN IF NOT EXISTS truck            text,
  ADD COLUMN IF NOT EXISTS onsite_hours     numeric,
  ADD COLUMN IF NOT EXISTS crew_size        integer,
  ADD COLUMN IF NOT EXISTS completion       text,
  ADD COLUMN IF NOT EXISTS rtn_needed       text,
  ADD COLUMN IF NOT EXISTS con_job_id       uuid REFERENCES con_jobs ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extract_version  integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE svc_work_order_documents
    ADD CONSTRAINT svc_work_order_documents_completion_check CHECK (completion IN ('complete','rtn','unclear'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS svc_work_order_documents_received_idx ON svc_work_order_documents (company_id, received_at DESC);
CREATE INDEX IF NOT EXISTS svc_work_order_documents_con_job_idx  ON svc_work_order_documents (con_job_id);
CREATE INDEX IF NOT EXISTS svc_work_order_documents_pending_idx  ON svc_work_order_documents (received_at DESC) WHERE extract_status = 'pending';

-- Carry over what the first read already found, so the log has a date and a
-- tech name on every typed ticket before the front/back re-read reaches it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, extracted->>'work_date' AS d FROM svc_work_order_documents
            WHERE work_date IS NULL AND extracted->>'work_date' ~ '^20\d\d-\d\d-\d\d$' LOOP
    BEGIN
      UPDATE svc_work_order_documents SET work_date = r.d::date WHERE id = r.id;
    EXCEPTION WHEN others THEN NULL;   -- a date the reader got wrong (e.g. 2026-02-30) stays blank
    END;
  END LOOP;
END $$;

UPDATE svc_work_order_documents
   SET technician = NULLIF(btrim(extracted->>'technician_name'), '')
 WHERE technician IS NULL AND extracted ? 'technician_name';

-- ------------------------------------------------------------
-- Copies. The office forwards a tech's ticket email on ("Fwd: 40013 .75x2"),
-- so the same ticket lands twice. The later one points at the first and is
-- left out of the log by default; it is not read a second time.
-- ------------------------------------------------------------
ALTER TABLE svc_work_order_documents
  ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES svc_work_order_documents ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS svc_work_order_documents_dup_idx ON svc_work_order_documents (duplicate_of);

CREATE OR REPLACE FUNCTION svc_ticket_find_original(p_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH me AS (
    SELECT d.id, d.company_id, d.subject, d.received_at,
           (SELECT string_agg(s::text, ',' ORDER BY s) FROM (SELECT (a->>'size')::bigint s FROM jsonb_array_elements(d.attachments) a) q) AS sizes,
           (SELECT max((a->>'size')::bigint) FROM jsonb_array_elements(d.attachments) a) AS biggest
      FROM svc_work_order_documents d WHERE d.id = p_id)
  SELECT o.id
    FROM me, svc_work_order_documents o
   WHERE o.company_id = me.company_id AND o.id <> me.id AND o.duplicate_of IS NULL
     AND o.received_at < me.received_at AND o.received_at > me.received_at - interval '10 days'
     AND (
           -- the very same files
           (me.biggest > 20000 AND me.sizes = (SELECT string_agg(s::text, ',' ORDER BY s) FROM (SELECT (a->>'size')::bigint s FROM jsonb_array_elements(o.attachments) a) q))
           -- or "Fwd: <the original subject>" where the original is not itself a forward
        OR (me.subject ~* '^\s*(fwd?|fw):\s*' AND o.subject !~* '^\s*(fwd?|fw|re):'
            AND lower(btrim(regexp_replace(me.subject, '^\s*((fwd?|fw):\s*)+', '', 'i'))) = lower(btrim(o.subject)))
         )
   ORDER BY o.received_at
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION svc_ticket_find_original(uuid) FROM PUBLIC, anon, authenticated;

UPDATE svc_work_order_documents d SET duplicate_of = svc_ticket_find_original(d.id)
 WHERE d.duplicate_of IS NULL AND svc_ticket_find_original(d.id) IS NOT NULL;
-- never chain: a copy always points at a ticket that is not itself a copy
UPDATE svc_work_order_documents d SET duplicate_of = o.duplicate_of
  FROM svc_work_order_documents o WHERE d.duplicate_of = o.id AND o.duplicate_of IS NOT NULL;

-- ------------------------------------------------------------
-- Ticket tracker entries — what the crew typed into the Smartsheet
-- "Ticket Tracking" form (Construction Department > Ticket and Expense
-- Tracking, sheet 3752544083175300) for the same visit. The ticket reader is
-- shown the entry for the same site and day so it can settle handwriting it
-- is unsure of, and the log shows it beside the scan.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_tracker_entries (
  smartsheet_row_id bigint PRIMARY KEY,
  company_id        uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  work_date         date,
  site              text,
  site_key          text,          -- digits only, for matching ("SU-2333" -> 2333)
  customer          text,
  wo_number         text,
  technicians       text,
  task_type         text,
  onsite_hours      numeric,
  description       text,
  parts             text,
  status            text,
  notes             text,
  submitted_at      timestamptz,
  imported_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_tracker_entries_match_idx ON ticket_tracker_entries (company_id, site_key, work_date);
ALTER TABLE ticket_tracker_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_tracker_entries_read ON ticket_tracker_entries;
CREATE POLICY ticket_tracker_entries_read ON ticket_tracker_entries FOR SELECT TO authenticated
  USING (company_id = con_user_company_id());

ALTER TABLE svc_work_order_documents
  ADD COLUMN IF NOT EXISTS tracker_row_id bigint REFERENCES ticket_tracker_entries ON DELETE SET NULL;
