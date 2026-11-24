-- ============================================================
-- BILLING + INVENTORY MODULE — Phase 5
-- Email-driven receiving and invoice email-out.
--   * billing_inbox_documents: one row per email that carried paperwork
--     (packing slip / vendor invoice / receipt / vendor quote). Attachments
--     land in the private `billing-inbox` bucket; Claude extracts the line
--     items; a human confirms them into the ledger from the Receive queue.
--   * billing_emails: every invoice/quote we email out (audit + resend).
-- Idempotent: safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_inbox_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  inbox             text NOT NULL,                       -- econstruction | constructionreceipts | rpinvoicing | maintenance
  gmail_message_id  text NOT NULL,
  gmail_thread_id   text,
  sender            text,
  sender_email      text,
  subject           text,
  received_at       timestamptz,
  body_preview      text,
  kind              text NOT NULL DEFAULT 'other'
                    CHECK (kind IN ('packing_slip','vendor_invoice','receipt','vendor_quote','customer_invoice','other')),
  vendor            text,
  reference         text,                                -- packing slip / invoice / order number
  document_date     date,
  attachments       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{name, mime, path, size}]
  primary_path      text,                                -- storage path of the attachment we extracted from
  extracted         jsonb,                               -- {vendor, reference, document_date, lines:[...], subtotal, tax, freight, total}
  extract_status    text NOT NULL DEFAULT 'pending' CHECK (extract_status IN ('pending','done','failed','skipped')),
  extract_error     text,
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new','received','cost_updated','dismissed','linked')),
  location_id       uuid REFERENCES stock_locations ON DELETE SET NULL,
  txn_group         uuid,                                -- inventory_transactions posted from this document share it
  processed_by      uuid REFERENCES profiles ON DELETE SET NULL,
  processed_at      timestamptz,
  note              text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (inbox, gmail_message_id)
);
CREATE INDEX IF NOT EXISTS billing_inbox_documents_queue_idx ON billing_inbox_documents (company_id, status, received_at DESC);
ALTER TABLE billing_inbox_documents ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS billing_emails (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  invoice_id   uuid REFERENCES con_invoices ON DELETE SET NULL,
  quote_id     uuid REFERENCES con_quotes ON DELETE SET NULL,
  to_emails    text[] NOT NULL,
  cc_emails    text[],
  subject      text NOT NULL,
  message      text,
  provider     text DEFAULT 'resend',
  provider_id  text,
  status       text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error        text,
  sent_by      uuid REFERENCES profiles ON DELETE SET NULL,
  sent_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_emails_invoice_idx ON billing_emails (invoice_id, sent_at DESC);
ALTER TABLE billing_emails ENABLE ROW LEVEL SECURITY;

-- Company-scoped policies (same shape as the rest of the module).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_inbox_documents','billing_emails'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s company read"  ON %1$s', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s company write" ON %1$s', t);
    EXECUTE format('CREATE POLICY "%1$s company read"  ON %1$s FOR SELECT TO authenticated USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()))', t);
    EXECUTE format('CREATE POLICY "%1$s company write" ON %1$s FOR ALL    TO authenticated USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())) WITH CHECK (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()))', t);
  END LOOP;
END $$;

-- Ledger rows posted from an inbox document point back at it.
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS inbox_document_id uuid REFERENCES billing_inbox_documents ON DELETE SET NULL;

-- Private bucket for the email attachments (served through signed URLs only).
INSERT INTO storage.buckets (id, name, public)
VALUES ('billing-inbox', 'billing-inbox', false)
ON CONFLICT (id) DO NOTHING;
