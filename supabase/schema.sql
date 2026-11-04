-- ============================================================
-- RP Intelligence (formerly RPS Maintenance & Asset Tracker) — Full Database Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- Helper: auto-update updated_at on any table that has it
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TABLE: companies
-- ============================================================
CREATE TABLE companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  timezone   text DEFAULT 'America/New_York',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: profiles
-- ============================================================
CREATE TABLE profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  company_id uuid REFERENCES companies ON DELETE SET NULL,
  full_name  text NOT NULL,
  email      text NOT NULL,
  phone      text,
  role       text NOT NULL DEFAULT 'viewer'
             CHECK (role IN ('owner','manager','shop_manager','shop_employee','viewer')),
  is_active  boolean DEFAULT true,
  avatar_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: asset_types
-- ============================================================
CREATE TABLE asset_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE asset_types ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: assets
-- ============================================================
CREATE TABLE assets (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 uuid REFERENCES companies ON DELETE CASCADE,
  asset_type_id              uuid REFERENCES asset_types ON DELETE SET NULL,
  unit_number                text NOT NULL,
  name                       text,
  year                       integer,
  make                       text,
  model                      text,
  vin                        text,
  serial_number              text,
  license_plate              text,
  status                     text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','available','in_shop','down','unsafe','retired')),
  assigned_profile_id        uuid REFERENCES profiles ON DELETE SET NULL,
  current_mileage            integer,
  current_hours              numeric(10,2),
  oil_change_interval_miles  integer,
  oil_change_interval_months integer,
  last_oil_change_date       date,
  last_oil_change_mileage    integer,
  next_oil_change_mileage    integer,
  last_brake_service_date    date,
  last_brake_service_mileage integer,
  next_brake_inspection_date date,
  last_tire_service_date     date,
  last_tire_service_mileage  integer,
  next_tire_inspection_date  date,
  inspection_due_date        date,
  dot_inspection_due_date    date,
  registration_due_date      date,
  insurance_due_date         date,
  notes                      text,
  is_active                  boolean DEFAULT true,
  created_at                 timestamptz DEFAULT now(),
  updated_at                 timestamptz DEFAULT now()
);
CREATE INDEX assets_unit_number_idx ON assets (unit_number);
CREATE INDEX assets_status_idx ON assets (status);
CREATE INDEX assets_company_id_idx ON assets (company_id);
CREATE TRIGGER assets_updated_at BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: maintenance_types
-- ============================================================
CREATE TABLE maintenance_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES companies ON DELETE CASCADE,
  name            text NOT NULL,
  category        text,
  interval_miles  integer,
  interval_months integer,
  interval_hours  numeric(10,2),
  is_active       boolean DEFAULT true,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE maintenance_types ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: repair_tickets
-- ============================================================
CREATE TABLE repair_tickets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid REFERENCES companies ON DELETE CASCADE,
  ticket_number    text UNIQUE NOT NULL DEFAULT '',
  asset_id         uuid REFERENCES assets ON DELETE SET NULL,
  created_by       uuid REFERENCES profiles ON DELETE SET NULL,
  assigned_to      uuid REFERENCES profiles ON DELETE SET NULL,
  title            text NOT NULL,
  description      text,
  source           text DEFAULT 'manual'
                   CHECK (source IN ('manual','gmail','employee','manager','inspection','preventive')),
  priority         text DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','critical','safety')),
  severity         text,
  safety_status    text DEFAULT 'none'
                   CHECK (safety_status IN ('none','monitor','needs_inspection','schedule_soon','unsafe')),
  status           text DEFAULT 'new'
                   CHECK (status IN (
                     'new','open','needs_review','assigned','in_progress',
                     'paused','waiting_parts','waiting_approval','scheduled',
                     'completed','closed','deferred','unsafe_do_not_use'
                   )),
  parts_needed      boolean DEFAULT false,
  parts_ordered     boolean DEFAULT false,
  waiting_on_parts  boolean DEFAULT false,
  parts_notes       text,
  total_labor_hours numeric(6,2) DEFAULT 0,
  total_cost        numeric(10,2) DEFAULT 0,
  vendor            text,
  date_completed    date,
  completed_by      uuid REFERENCES profiles ON DELETE SET NULL,
  completion_notes  text,
  gmail_message_id  text,
  gmail_thread_id   text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX repair_tickets_asset_id_idx    ON repair_tickets (asset_id);
CREATE INDEX repair_tickets_status_idx      ON repair_tickets (status);
CREATE INDEX repair_tickets_priority_idx    ON repair_tickets (priority);
CREATE INDEX repair_tickets_assigned_to_idx ON repair_tickets (assigned_to);
CREATE INDEX repair_tickets_number_idx      ON repair_tickets (ticket_number);
CREATE TRIGGER repair_tickets_updated_at BEFORE UPDATE ON repair_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE repair_tickets ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: maintenance_events
-- ============================================================
CREATE TABLE maintenance_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES companies ON DELETE CASCADE,
  asset_id            uuid REFERENCES assets ON DELETE CASCADE,
  maintenance_type_id uuid REFERENCES maintenance_types ON DELETE SET NULL,
  repair_ticket_id    uuid REFERENCES repair_tickets ON DELETE SET NULL,
  performed_by        uuid REFERENCES profiles ON DELETE SET NULL,
  performed_date      date NOT NULL,
  mileage_at_service  integer,
  hours_at_service    numeric(10,2),
  next_due_date       date,
  next_due_mileage    integer,
  next_due_hours      numeric(10,2),
  vendor              text,
  cost                numeric(10,2),
  parts_used          text,
  labor_hours         numeric(6,2),
  notes               text,
  attachments         text[],
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX maintenance_events_asset_id_idx ON maintenance_events (asset_id);
CREATE INDEX maintenance_events_type_idx     ON maintenance_events (maintenance_type_id);
CREATE INDEX maintenance_events_date_idx     ON maintenance_events (performed_date);
ALTER TABLE maintenance_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: repair_ticket_assignments
-- ============================================================
CREATE TABLE repair_ticket_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid REFERENCES repair_tickets ON DELETE CASCADE,
  profile_id  uuid REFERENCES profiles ON DELETE CASCADE,
  assigned_by uuid REFERENCES profiles ON DELETE SET NULL,
  assigned_at timestamptz DEFAULT now(),
  is_active   boolean DEFAULT true
);
ALTER TABLE repair_ticket_assignments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: repair_ticket_comments
-- ============================================================
CREATE TABLE repair_ticket_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid REFERENCES repair_tickets ON DELETE CASCADE,
  author_id   uuid REFERENCES profiles ON DELETE SET NULL,
  comment     text NOT NULL,
  is_internal boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE repair_ticket_comments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: repair_ticket_attachments
-- ============================================================
CREATE TABLE repair_ticket_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid REFERENCES repair_tickets ON DELETE CASCADE,
  uploaded_by uuid REFERENCES profiles ON DELETE SET NULL,
  file_url    text NOT NULL,
  file_name   text,
  file_type   text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE repair_ticket_attachments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: time_clock_entries
-- ============================================================
CREATE TABLE time_clock_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid REFERENCES companies ON DELETE CASCADE,
  profile_id        uuid REFERENCES profiles ON DELETE CASCADE,
  clock_in          timestamptz NOT NULL,
  clock_out         timestamptz,
  total_minutes     integer,
  break_minutes     integer DEFAULT 0,
  notes             text,
  is_approved       boolean DEFAULT false,
  approved_by       uuid REFERENCES profiles ON DELETE SET NULL,
  approved_at       timestamptz,
  manually_adjusted boolean DEFAULT false,
  adjusted_by       uuid REFERENCES profiles ON DELETE SET NULL,
  adjustment_note   text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX time_clock_profile_id_idx  ON time_clock_entries (profile_id);
CREATE INDEX time_clock_clock_in_idx    ON time_clock_entries (clock_in);
CREATE INDEX time_clock_is_approved_idx ON time_clock_entries (is_approved);
CREATE TRIGGER time_clock_entries_updated_at BEFORE UPDATE ON time_clock_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE time_clock_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: labor_entries
-- ============================================================
CREATE TABLE labor_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES companies ON DELETE CASCADE,
  profile_id          uuid REFERENCES profiles ON DELETE CASCADE,
  ticket_id           uuid REFERENCES repair_tickets ON DELETE SET NULL,
  time_clock_entry_id uuid REFERENCES time_clock_entries ON DELETE SET NULL,
  entry_type          text NOT NULL
                      CHECK (entry_type IN ('ticket','general_shop','break','lunch','other')),
  status_at_time      text,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  total_minutes       integer,
  description         text,
  notes               text,
  is_active           boolean DEFAULT false,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX labor_entries_profile_id_idx ON labor_entries (profile_id);
CREATE INDEX labor_entries_ticket_id_idx  ON labor_entries (ticket_id);
CREATE INDEX labor_entries_started_at_idx ON labor_entries (started_at);
CREATE INDEX labor_entries_is_active_idx  ON labor_entries (is_active);
CREATE TRIGGER labor_entries_updated_at BEFORE UPDATE ON labor_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
ALTER TABLE labor_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: employee_statuses
-- ============================================================
CREATE TABLE employee_statuses (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            uuid REFERENCES profiles ON DELETE CASCADE UNIQUE,
  company_id            uuid REFERENCES companies ON DELETE CASCADE,
  clock_status          text DEFAULT 'clocked_out'
                        CHECK (clock_status IN ('clocked_in','clocked_out')),
  current_status        text DEFAULT 'clocked_out'
                        CHECK (current_status IN (
                          'clocked_out','at_shop','working_on_ticket',
                          'waiting_parts','parts_run','cleaning_shop',
                          'helping_employee','general_maintenance',
                          'break','lunch','meeting','off_site','other'
                        )),
  current_ticket_id     uuid REFERENCES repair_tickets ON DELETE SET NULL,
  current_asset_id      uuid REFERENCES assets ON DELETE SET NULL,
  current_task_note     text,
  active_labor_entry_id uuid REFERENCES labor_entries ON DELETE SET NULL,
  status_updated_at     timestamptz DEFAULT now()
);
ALTER TABLE employee_statuses ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: oil_change_records
-- ============================================================
CREATE TABLE oil_change_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             uuid REFERENCES assets ON DELETE CASCADE,
  maintenance_event_id uuid REFERENCES maintenance_events ON DELETE SET NULL,
  service_date         date NOT NULL,
  mileage              integer,
  oil_type             text,
  filter_used          text,
  completed_by         uuid REFERENCES profiles ON DELETE SET NULL,
  cost                 numeric(10,2),
  labor_minutes        integer,
  vendor               text,
  notes                text,
  created_at           timestamptz DEFAULT now()
);
ALTER TABLE oil_change_records ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: brake_service_records
-- ============================================================
CREATE TABLE brake_service_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             uuid REFERENCES assets ON DELETE CASCADE,
  maintenance_event_id uuid REFERENCES maintenance_events ON DELETE SET NULL,
  service_date         date NOT NULL,
  mileage              integer,
  front_pads           boolean DEFAULT false,
  rear_pads            boolean DEFAULT false,
  front_rotors         boolean DEFAULT false,
  rear_rotors          boolean DEFAULT false,
  calipers             boolean DEFAULT false,
  brake_lines          boolean DEFAULT false,
  brake_fluid          boolean DEFAULT false,
  parking_brake        boolean DEFAULT false,
  abs_issue            boolean DEFAULT false,
  severity             text DEFAULT 'monitor'
                       CHECK (severity IN ('monitor','needs_inspection','schedule_soon','unsafe')),
  parts_used           text,
  completed_by         uuid REFERENCES profiles ON DELETE SET NULL,
  vendor               text,
  cost                 numeric(10,2),
  labor_minutes        integer,
  next_inspection_date date,
  notes                text,
  photos               text[],
  created_at           timestamptz DEFAULT now()
);
ALTER TABLE brake_service_records ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: tire_service_records
-- ============================================================
CREATE TABLE tire_service_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id             uuid REFERENCES assets ON DELETE CASCADE,
  maintenance_event_id uuid REFERENCES maintenance_events ON DELETE SET NULL,
  service_date         date NOT NULL,
  mileage              integer,
  tire_position        text,
  brand                text,
  model                text,
  tread_depth          numeric(4,2),
  replaced             boolean DEFAULT false,
  inspected_only       boolean DEFAULT false,
  completed_by         uuid REFERENCES profiles ON DELETE SET NULL,
  vendor               text,
  cost                 numeric(10,2),
  next_inspection_date date,
  next_replacement_est date,
  notes                text,
  photos               text[],
  created_at           timestamptz DEFAULT now()
);
ALTER TABLE tire_service_records ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: mileage_entries
-- ============================================================
CREATE TABLE mileage_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES companies ON DELETE CASCADE,
  asset_id     uuid REFERENCES assets ON DELETE CASCADE,
  submitted_by uuid REFERENCES profiles ON DELETE SET NULL,
  entry_date   date NOT NULL,
  mileage      integer NOT NULL,
  source       text DEFAULT 'manual'
               CHECK (source IN ('manual','fuel_receipt','driver_report','gps')),
  receipt_url  text,
  notes        text,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX mileage_entries_asset_id_idx   ON mileage_entries (asset_id);
CREATE INDEX mileage_entries_entry_date_idx ON mileage_entries (entry_date);
ALTER TABLE mileage_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: notifications
-- ============================================================
CREATE TABLE notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid REFERENCES companies ON DELETE CASCADE,
  recipient_id      uuid REFERENCES profiles ON DELETE CASCADE,
  type              text NOT NULL,
  title             text NOT NULL,
  message           text,
  link              text,
  is_read           boolean DEFAULT false,
  related_asset_id  uuid REFERENCES assets ON DELETE SET NULL,
  related_ticket_id uuid REFERENCES repair_tickets ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: activity_log
-- ============================================================
CREATE TABLE activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES companies ON DELETE CASCADE,
  actor_id    uuid REFERENCES profiles ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text,
  entity_id   uuid,
  details     jsonb,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: gmail_imports (schema only — not used until Phase 2)
-- ============================================================
CREATE TABLE gmail_imports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid REFERENCES companies ON DELETE CASCADE,
  gmail_message_id    text UNIQUE NOT NULL,
  gmail_thread_id     text,
  subject             text,
  sender              text,
  received_at         timestamptz,
  body_preview        text,
  has_attachments     boolean DEFAULT false,
  status              text DEFAULT 'pending'
                      CHECK (status IN ('pending','reviewed','converted','rejected','duplicate')),
  converted_ticket_id uuid REFERENCES repair_tickets ON DELETE SET NULL,
  detected_asset      text,
  detected_priority   text,
  raw_payload         jsonb,
  created_at          timestamptz DEFAULT now()
);
ALTER TABLE gmail_imports ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- companies
CREATE POLICY "Users can view their company" ON companies FOR SELECT TO authenticated
  USING (id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

-- profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Managers can view all profiles in company" ON profiles FOR SELECT TO authenticated
  USING (company_id IN (
    SELECT company_id FROM profiles WHERE id = auth.uid() AND role IN ('owner','manager','shop_manager')
  ));

CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Owners can manage profiles" ON profiles FOR ALL TO authenticated
  USING (company_id IN (
    SELECT company_id FROM profiles WHERE id = auth.uid() AND role = 'owner'
  ));

-- All remaining tables: full access to authenticated users in the same company
CREATE POLICY "Company access" ON asset_types FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON assets FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON maintenance_types FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON repair_tickets FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON maintenance_events FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON repair_ticket_assignments FOR ALL TO authenticated
  USING (ticket_id IN (
    SELECT id FROM repair_tickets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Company access" ON repair_ticket_comments FOR ALL TO authenticated
  USING (ticket_id IN (
    SELECT id FROM repair_tickets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Company access" ON repair_ticket_attachments FOR ALL TO authenticated
  USING (ticket_id IN (
    SELECT id FROM repair_tickets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Company access" ON time_clock_entries FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON labor_entries FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON employee_statuses FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON oil_change_records FOR ALL TO authenticated
  USING (asset_id IN (
    SELECT id FROM assets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Company access" ON brake_service_records FOR ALL TO authenticated
  USING (asset_id IN (
    SELECT id FROM assets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Company access" ON tire_service_records FOR ALL TO authenticated
  USING (asset_id IN (
    SELECT id FROM assets WHERE company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "Company access" ON mileage_entries FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Own notifications" ON notifications FOR ALL TO authenticated
  USING (recipient_id = auth.uid());

CREATE POLICY "Company access" ON activity_log FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Company access" ON gmail_imports FOR ALL TO authenticated
  USING (company_id IN (SELECT company_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- AUTO-CREATE PROFILE ON FIRST LOGIN
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'viewer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- AUTO-GENERATE TICKET NUMBERS (TKT-1000, TKT-1001, ...)
-- ============================================================
CREATE SEQUENCE ticket_number_seq START 1000;

CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := 'TKT-' || LPAD(nextval('ticket_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER repair_tickets_ticket_number
  BEFORE INSERT ON repair_tickets
  FOR EACH ROW EXECUTE FUNCTION generate_ticket_number();

-- ============================================================
-- SEED DATA
-- ============================================================

-- Company row (fixed UUID so we can reference it everywhere)
INSERT INTO companies (id, name, slug, timezone) VALUES
  ('00000000-0000-0000-0000-000000000001', 'RPS', 'rps', 'America/New_York');

-- Asset types
INSERT INTO asset_types (company_id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Service Truck'),
  ('00000000-0000-0000-0000-000000000001', 'Construction Truck'),
  ('00000000-0000-0000-0000-000000000001', 'Pickup Truck'),
  ('00000000-0000-0000-0000-000000000001', 'Trailer'),
  ('00000000-0000-0000-0000-000000000001', 'Equipment'),
  ('00000000-0000-0000-0000-000000000001', 'Machine'),
  ('00000000-0000-0000-0000-000000000001', 'Other');

-- Maintenance types
INSERT INTO maintenance_types (company_id, name, category) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Oil Change',              'Engine'),
  ('00000000-0000-0000-0000-000000000001', 'Tires',                   'Wheels'),
  ('00000000-0000-0000-0000-000000000001', 'Brakes',                  'Safety'),
  ('00000000-0000-0000-0000-000000000001', 'Inspection',              'Compliance'),
  ('00000000-0000-0000-0000-000000000001', 'Registration',            'Compliance'),
  ('00000000-0000-0000-0000-000000000001', 'DOT',                     'Compliance'),
  ('00000000-0000-0000-0000-000000000001', 'Fluids',                  'Engine'),
  ('00000000-0000-0000-0000-000000000001', 'Filters',                 'Engine'),
  ('00000000-0000-0000-0000-000000000001', 'Batteries',               'Electrical'),
  ('00000000-0000-0000-0000-000000000001', 'Lights',                  'Electrical'),
  ('00000000-0000-0000-0000-000000000001', 'Hydraulic',               'Hydraulic'),
  ('00000000-0000-0000-0000-000000000001', 'Trailer Maintenance',     'Trailer'),
  ('00000000-0000-0000-0000-000000000001', 'Equipment Maintenance',   'Equipment'),
  ('00000000-0000-0000-0000-000000000001', 'Custom',                  'Other');
