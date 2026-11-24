-- ============================================================
-- RPS Construction — Permits Feature Migration
-- Adds the permit-tracking tables to the Construction module.
-- All tables are prefixed con_permit_* (con_jurisdictions /
-- con_contractor_licenses are shared construction reference data).
-- Additive only — touches NO existing table.
-- RLS is enabled with NO policies: these tables are reached only
-- through the service-role admin client behind requireConstruction().
-- Safe to re-run (IF NOT EXISTS / guarded).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Jurisdictions — the reusable issuing-office cheat sheet.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_jurisdictions (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                          uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  name                                text NOT NULL,
  state                               text,
  is_independent_city                 boolean NOT NULL DEFAULT false,
  department                          text,
  address                             text,
  contact_name                        text,
  phone                               text,
  email                               text,
  portal_url                          text,
  submittal_method                    text,
  typical_turnaround_days             text,
  fee_notes                           text,
  requires_building_with_electrical   text NOT NULL DEFAULT 'unknown'
                                        CHECK (requires_building_with_electrical IN ('unknown','yes','no')),
  requires_mechanical_with_electrical text NOT NULL DEFAULT 'unknown'
                                        CHECK (requires_mechanical_with_electrical IN ('unknown','yes','no')),
  contractor_requirements             text,
  cheat_sheet                         text,
  created_at                          timestamptz DEFAULT now(),
  updated_at                          timestamptz DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS con_jurisdictions_company_idx ON con_jurisdictions (company_id);
DROP TRIGGER IF EXISTS con_jurisdictions_updated_at ON con_jurisdictions;
CREATE TRIGGER con_jurisdictions_updated_at BEFORE UPDATE ON con_jurisdictions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_jurisdictions ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. Permit sites — one record per physical store.
--    Separate from con_sites so the permit workflow owns its own
--    jurisdiction/brand/parcel fields without disturbing the
--    existing job-pipeline sites table.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_permit_sites (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  site_number     text NOT NULL,
  brand           text,
  name            text,
  address         text,
  city            text,
  state           text,
  zip             text,
  jurisdiction_id uuid REFERENCES con_jurisdictions ON DELETE SET NULL,
  owner_name      text,
  store_phone     text,
  parcel_number   text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (company_id, site_number)
);
CREATE INDEX IF NOT EXISTS con_permit_sites_company_idx      ON con_permit_sites (company_id);
CREATE INDEX IF NOT EXISTS con_permit_sites_jurisdiction_idx ON con_permit_sites (jurisdiction_id);
DROP TRIGGER IF EXISTS con_permit_sites_updated_at ON con_permit_sites;
CREATE TRIGGER con_permit_sites_updated_at BEFORE UPDATE ON con_permit_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_permit_sites ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3. Permit projects — a unit of work at a site.
--    permit_due_date is ALWAYS scheduled_work_date - 28 days
--    (generated column, never typed). ready_to_work is set only
--    by the gated markReadyToWork action; the displayed indicator
--    is recomputed live from child permit statuses.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_permit_projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  site_id             uuid NOT NULL REFERENCES con_permit_sites ON DELETE CASCADE,
  project_type        text NOT NULL DEFAULT 'Dispenser Replacement'
                        CHECK (project_type IN ('Dispenser Replacement','STP Circuit Repair','Tank Replacement','MUL Conversion')),
  request_type        text CHECK (request_type IN ('Non-PE Stamped','PE Stamped')),
  scope               text,
  dispenser_count     integer,
  grades              text,
  unit_config         text,
  scheduled_work_date date,
  permit_due_date     date GENERATED ALWAYS AS (scheduled_work_date - 28) STORED,
  ready_to_work       boolean NOT NULL DEFAULT false,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_permit_projects_company_idx ON con_permit_projects (company_id);
CREATE INDEX IF NOT EXISTS con_permit_projects_site_idx    ON con_permit_projects (site_id);
DROP TRIGGER IF EXISTS con_permit_projects_updated_at ON con_permit_projects;
CREATE TRIGGER con_permit_projects_updated_at BEFORE UPDATE ON con_permit_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_permit_projects ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 4. Permits — one row per permit. The heart of the module.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_permits (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                    uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  project_id                    uuid NOT NULL REFERENCES con_permit_projects ON DELETE CASCADE,
  permit_key                    text,   -- human ID e.g. 33955-ELEC
  permit_type                   text NOT NULL DEFAULT 'Electrical'
                                  CHECK (permit_type IN ('Electrical','Building','Mechanical','Plumbing','Fire','Zoning','Other')),
  pulled_by                     text NOT NULL DEFAULT 'RPS'
                                  CHECK (pulled_by IN ('Hash Construction','RPS','Engineering Firm')),
  requirement_status            text NOT NULL DEFAULT 'Required'
                                  CHECK (requirement_status IN ('Unknown','Required','Not Required')),
  status                        text NOT NULL DEFAULT 'Not Started'
                                  CHECK (status IN ('Not Started','Submitted to Hash','Hash Submitted Confirmed',
                                                    'In Progress','Permit In-Hand','Inspection Scheduled',
                                                    'Complete','On Hold','Rejected')),
  date_submitted_to_hash        date,
  date_hash_confirmed           date,
  date_submitted_to_jurisdiction date,
  permit_number                 text,
  fee                           numeric,
  date_issued                   date,
  inspection_date               date,
  date_completed                date,
  other_permits_required        text,
  notes                         text,
  created_at                    timestamptz DEFAULT now(),
  updated_at                    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_permits_company_idx ON con_permits (company_id);
CREATE INDEX IF NOT EXISTS con_permits_project_idx ON con_permits (project_id);
DROP TRIGGER IF EXISTS con_permits_updated_at ON con_permits;
CREATE TRIGGER con_permits_updated_at BEFORE UPDATE ON con_permits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_permits ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 5. Permit events — append-only audit trail of status changes.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_permit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  permit_id       uuid NOT NULL REFERENCES con_permits ON DELETE CASCADE,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  changed_by      uuid REFERENCES profiles ON DELETE SET NULL,
  changed_by_name text,
  from_status     text,
  to_status       text,
  note            text
);
CREATE INDEX IF NOT EXISTS con_permit_events_permit_idx ON con_permit_events (permit_id);
CREATE INDEX IF NOT EXISTS con_permit_events_company_idx ON con_permit_events (company_id);
ALTER TABLE con_permit_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 6. Deliverables — every drawing / application / narrative.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_permit_deliverables (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  site_id        uuid REFERENCES con_permit_sites ON DELETE CASCADE,
  permit_id      uuid REFERENCES con_permits ON DELETE SET NULL,
  created_date   date DEFAULT now(),
  type           text,
  filename       text,
  storage_path   text,
  where_it_lives text,
  open_items     text,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_permit_deliverables_site_idx    ON con_permit_deliverables (site_id);
CREATE INDEX IF NOT EXISTS con_permit_deliverables_company_idx ON con_permit_deliverables (company_id);
DROP TRIGGER IF EXISTS con_permit_deliverables_updated_at ON con_permit_deliverables;
CREATE TRIGGER con_permit_deliverables_updated_at BEFORE UPDATE ON con_permit_deliverables
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_permit_deliverables ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 7. Contractor licenses — powers alerts 4 (state mismatch)
--    and 5 (expiring). contractor_name matches permits.pulled_by.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS con_contractor_licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies ON DELETE CASCADE,
  contractor_name text NOT NULL,
  license_number  text,
  license_class   text,
  state           text,
  expiration_date date,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS con_contractor_licenses_company_idx ON con_contractor_licenses (company_id);
DROP TRIGGER IF EXISTS con_contractor_licenses_updated_at ON con_contractor_licenses;
CREATE TRIGGER con_contractor_licenses_updated_at BEFORE UPDATE ON con_contractor_licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE con_contractor_licenses ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DONE.
-- ============================================================
