-- Replies in a packing-slip thread ("SU-8605 material", "Stock") are where the team says which job a shipment
-- belongs to. The inbox sync stores them on the slip so the construction dashboard and the receive queue can read them.
ALTER TABLE billing_inbox_documents
  ADD COLUMN IF NOT EXISTS thread_replies jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz;
