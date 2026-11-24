-- ============================================================
-- Service work order documents — the completed-ticket photos/scans a tech
-- forwards to rpinvoicing@gmail.com along with their one-line COMPLETE note.
-- Today that attachment is downloaded nowhere; this gives it a home, plus
-- the review step Trae asked for: confirm a manager's signature is actually
-- on it, read it, and type up what it says — before it's fit to become (or
-- attach to) a real service ticket on its way to invoicing.
--
-- One row per rpinvoicing email (not per attachment, same shape as
-- billing_inbox_documents). `extracted` is Claude's first-pass read, kept
-- verbatim for audit; `transcript` is the editable copy a human confirms —
-- nothing here is ever taken as fact without a human setting
-- manager_signature_verified themselves; the AI can only draft.
-- ============================================================

CREATE TABLE IF NOT EXISTS svc_work_order_documents (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  work_order_id              uuid REFERENCES svc_work_orders ON DELETE SET NULL,
  gmail_message_id           text NOT NULL,
  gmail_thread_id            text,
  sender                     text,
  sender_email               text,
  subject                    text,
  received_at                timestamptz,
  attachments                jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_path               text,
  extracted                  jsonb,
  extract_status             text NOT NULL DEFAULT 'pending' CHECK (extract_status IN ('pending','done','failed','skipped')),
  extract_error               text,
  transcript                 text,
  manager_signature_verified boolean NOT NULL DEFAULT false,
  verified_by                uuid REFERENCES profiles ON DELETE SET NULL,
  verified_at                timestamptz,
  status                     text NOT NULL DEFAULT 'new' CHECK (status IN ('new','needs_review','ready','linked','dismissed')),
  service_ticket_id          uuid REFERENCES service_tickets ON DELETE SET NULL,
  reviewed_by                uuid REFERENCES profiles ON DELETE SET NULL,
  reviewed_at                timestamptz,
  created_at                 timestamptz DEFAULT now(),
  UNIQUE (gmail_message_id)
);
CREATE INDEX IF NOT EXISTS svc_work_order_documents_company_idx ON svc_work_order_documents (company_id);
CREATE INDEX IF NOT EXISTS svc_work_order_documents_wo_idx ON svc_work_order_documents (work_order_id);

ALTER TABLE svc_work_order_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS svc_work_order_documents_read  ON svc_work_order_documents;
DROP POLICY IF EXISTS svc_work_order_documents_write ON svc_work_order_documents;
CREATE POLICY svc_work_order_documents_read ON svc_work_order_documents FOR SELECT TO authenticated
  USING (company_id = con_user_company_id());
CREATE POLICY svc_work_order_documents_write ON svc_work_order_documents FOR ALL TO authenticated
  USING (company_id = con_user_company_id())
  WITH CHECK (company_id = con_user_company_id());

-- Private bucket — served only via signed URLs, same as billing-inbox.
INSERT INTO storage.buckets (id, name, public) VALUES ('svc-work-order-docs', 'svc-work-order-docs', false)
  ON CONFLICT (id) DO NOTHING;
