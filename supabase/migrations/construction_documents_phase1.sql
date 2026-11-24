-- ============================================================
-- RPS Construction — Phase 1: Document Center
-- Extends con_documents with fixed categories, import metadata,
-- de-dup hash, and a review-queue status. Additive & idempotent.
-- Run this entire file in the Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New columns on con_documents (all additive / nullable)
--    category        -> one of the 10 fixed filing categories
--    original_filename -> the true source filename (file_name may be sanitized)
--    source_path     -> where the importer copied it FROM (Dropbox path)
--    file_hash       -> sha256 of contents, for duplicate detection
--    imported_at     -> set only for importer-created rows (NULL = manual upload)
--    imported_by     -> free-text tag for the import run/user
--    review_status   -> 'filed' (confident) or 'needs_review' (importer unsure)
-- ------------------------------------------------------------
ALTER TABLE con_documents ADD COLUMN IF NOT EXISTS category          text;
ALTER TABLE con_documents ADD COLUMN IF NOT EXISTS original_filename text;
ALTER TABLE con_documents ADD COLUMN IF NOT EXISTS source_path       text;
ALTER TABLE con_documents ADD COLUMN IF NOT EXISTS file_hash         text;
ALTER TABLE con_documents ADD COLUMN IF NOT EXISTS imported_at       timestamptz;
ALTER TABLE con_documents ADD COLUMN IF NOT EXISTS imported_by       text;
ALTER TABLE con_documents ADD COLUMN IF NOT EXISTS review_status     text NOT NULL DEFAULT 'filed';

-- ------------------------------------------------------------
-- 2. Constrain the two enumerated columns. We drop-then-add so
--    the file is safe to re-run as the value sets evolve.
-- ------------------------------------------------------------
ALTER TABLE con_documents DROP CONSTRAINT IF EXISTS con_documents_category_check;
ALTER TABLE con_documents ADD  CONSTRAINT con_documents_category_check CHECK (
  category IS NULL OR category IN (
    'permits','quotes','change_orders','invoices','receipts',
    'photos','daily_updates','closeout','health_safety','other'
  )
);

ALTER TABLE con_documents DROP CONSTRAINT IF EXISTS con_documents_review_status_check;
ALTER TABLE con_documents ADD  CONSTRAINT con_documents_review_status_check CHECK (
  review_status IN ('filed','needs_review')
);

-- ------------------------------------------------------------
-- 3. Indexes for the document center + importer
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS con_documents_category_idx      ON con_documents (company_id, category);
CREATE INDEX IF NOT EXISTS con_documents_review_status_idx ON con_documents (company_id, review_status);
CREATE INDEX IF NOT EXISTS con_documents_file_hash_idx     ON con_documents (company_id, file_hash);

-- ------------------------------------------------------------
-- 4. Backfill: give existing rows a sensible category from the
--    old free-text doc_type so nothing shows up "uncategorized".
-- ------------------------------------------------------------
UPDATE con_documents SET category = CASE
    WHEN category IS NOT NULL              THEN category
    WHEN doc_type = 'permit'               THEN 'permits'
    WHEN doc_type = 'signed_quote'         THEN 'quotes'
    WHEN doc_type = 'photo'                THEN 'photos'
    WHEN doc_type = 'closeout'             THEN 'closeout'
    ELSE 'other'
  END
WHERE category IS NULL;

-- ============================================================
-- DONE.
-- ============================================================
