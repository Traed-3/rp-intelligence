-- My Plate: one click moves a row to the other person's plate ("That's Starsky's").
-- handed_from = whose plate it was on before the click; the mail/master routines read these rows to learn whose work is whose.
-- APPLIED 2026-11-12 via the Supabase MCP connector.
ALTER TABLE con_tasks
  ADD COLUMN IF NOT EXISTS handed_from uuid REFERENCES profiles ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handed_at timestamptz;
