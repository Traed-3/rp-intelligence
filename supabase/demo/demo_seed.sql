-- ============================================================================
-- RP Intelligence PUBLIC DEMO — reset + seed.
-- Apply ONLY to the demo Supabase project (rp-intelligence-demo,
-- ref mkgxfxnvubravxrqvhdi). NEVER run against production: demo_reseed()
-- truncates every table in the public schema.
--
-- Everything below is fictional: company, people, stores, addresses, phones.
-- Dates are relative to "today" so the demo always looks current.
-- Login accounts (auth.users) are created once by scripts/demo/setup-auth.mjs
-- and survive resets; the seed looks them up by email.
-- ============================================================================

create or replace function public.demo_reseed()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c   uuid := 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7';  -- same id the sync code expects
  d0  date := (now() at time zone 'America/New_York')::date;
  t   text;
  r   record;
  i   int;
  k   int;
  v_id uuid;
  v_ids uuid[];
  demo uuid; jordan uuid; casey uuid; morgan uuid; taylor uuid; sam uuid; riley uuid;
  reese uuid; jamie uuid; cody uuid; pat uuid; avery uuid; logan uuid; quinn uuid; blake uuid; devon uuid;
  at_svc uuid := gen_random_uuid(); at_con uuid := gen_random_uuid(); at_pick uuid := gen_random_uuid();
  at_trl uuid := gen_random_uuid(); at_eq uuid := gen_random_uuid(); at_mach uuid := gen_random_uuid();
  at_other uuid := gen_random_uuid(); at_emp uuid := '289b1400-4a45-46f2-829b-9748b70c66b6';
  at_bldg uuid := gen_random_uuid(); at_ret uuid := gen_random_uuid();
  mt_oil uuid := gen_random_uuid(); mt_tire uuid := gen_random_uuid(); mt_brake uuid := gen_random_uuid();
  mt_insp uuid := gen_random_uuid(); mt_reg uuid := gen_random_uuid();
  cu_qs uuid := gen_random_uuid(); cu_hill uuid := gen_random_uuid(); cu_val uuid := gen_random_uuid(); cu_tcs uuid := gen_random_uuid();
  rc uuid := gen_random_uuid();
  techs uuid[]; tech_names text[]; svc_ids uuid[];
  site_ids uuid[]; site_nums text[]; site_cust uuid[]; site_addr text[]; site_city text[]; site_brand text[];
  asset_ids uuid[]; asset_units text[];
  job_ids uuid[]; job_sites int[]; job_stages text[];
  part_ids uuid[]; loc_main uuid; loc_ids uuid[];
  stages text[] := array['survey','quoting','permitting','material_ordering','needs_scheduled','scheduled','in_progress','on_hold','return_needed','close_out','invoicing','complete','overspill_program'];
begin
  -- Hard stop if this is ever pointed at anything but the demo database.
  if not exists (select 1 from auth.users where email = 'demo@demo.rpintelligence.app') then
    raise exception 'demo_reseed: demo login not found, refusing to run (is this the demo project?)';
  end if;

  perform setseed(0.4242);

  -- 1. wipe every public table
  select string_agg(format('public.%I', tablename), ', ') into t from pg_tables where schemaname = 'public';
  execute 'truncate ' || t || ' restart identity cascade';

  -- 2. company + people -------------------------------------------------------
  insert into companies (id, name, slug, timezone) values (c, 'Summit Petroleum Services (Demo)', 'demo', 'America/New_York');

  create temp table _staff (key text, name text, role text, title text, dept text, phone text) on commit drop;
  insert into _staff values
    ('demo',            'Alex Morgan',     'owner',                'Operations Manager',      'management',   '(555) 010-1000'),
    ('jordan.reyes',    'Jordan Reyes',    'manager',              'Service Manager',         'service',      '(555) 010-1001'),
    ('casey.whitfield', 'Casey Whitfield', 'construction_manager', 'Construction Manager',    'construction', '(555) 010-1002'),
    ('morgan.ellis',    'Morgan Ellis',    'estimator',            'Estimator',               'office',       '(555) 010-1003'),
    ('taylor.brooks',   'Taylor Brooks',   'office_staff',         'Office Manager',          'office',       '(555) 010-1004'),
    ('sam.patel',       'Sam Patel',       'parts_manager',        'Parts Manager',           'parts',        '(555) 010-1005'),
    ('riley.chen',      'Riley Chen',      'shop_manager',         'Shop Manager',            'mechanics',    '(555) 010-1006'),
    ('reese.callahan',  'Reese Callahan',  'mechanic',             'Mechanic',                'mechanics',    '(555) 010-1007'),
    ('jamie.ortiz',     'Jamie Ortiz',     'mechanic',             'Mechanic',                'mechanics',    '(555) 010-1008'),
    ('cody.novak',      'Cody Novak',      'service_tech',         'Service Technician',      'service',      '(555) 010-1009'),
    ('pat.delgado',     'Pat Delgado',     'service_tech',         'Service Technician',      'service',      '(555) 010-1010'),
    ('avery.kim',       'Avery Kim',       'service_tech',         'Service Technician',      'service',      '(555) 010-1011'),
    ('logan.hayes',     'Logan Hayes',     'service_tech',         'Service Technician',      'service',      '(555) 010-1012'),
    ('quinn.foster',    'Quinn Foster',    'construction_tech',    'Construction Technician', 'construction', '(555) 010-1013'),
    ('blake.harper',    'Blake Harper',    'construction_tech',    'Construction Foreman',    'construction', '(555) 010-1014'),
    ('devon.price',     'Devon Price',     'construction_tech',    'Construction Technician', 'construction', '(555) 010-1015');

  insert into profiles (id, company_id, full_name, email, phone, role, is_active, job_title, must_change_password, default_landing_page)
  select u.id, c, s.name, u.email, s.phone, s.role, true, s.title, false, case when s.key = 'demo' then '/dashboard' else null end
    from _staff s join auth.users u on u.email = s.key || '@demo.rpintelligence.app';

  select id into demo   from profiles where email like 'demo@%';
  select id into jordan from profiles where email like 'jordan.%';
  select id into casey  from profiles where email like 'casey.%';
  select id into morgan from profiles where email like 'morgan.%';
  select id into taylor from profiles where email like 'taylor.%';
  select id into sam    from profiles where email like 'sam.%';
  select id into riley  from profiles where email like 'riley.%';
  select id into reese  from profiles where email like 'reese.%';
  select id into jamie  from profiles where email like 'jamie.%';
  select id into cody   from profiles where email like 'cody.%';
  select id into pat    from profiles where email like 'pat.%';
  select id into avery  from profiles where email like 'avery.%';
  select id into logan  from profiles where email like 'logan.%';
  select id into quinn  from profiles where email like 'quinn.%';
  select id into blake  from profiles where email like 'blake.%';
  select id into devon  from profiles where email like 'devon.%';

  -- 3. fleet ------------------------------------------------------------------
  insert into asset_types (id, company_id, name) values
    (at_svc, c, 'Service Truck'), (at_con, c, 'Construction Truck'), (at_pick, c, 'Pickup Truck'), (at_trl, c, 'Trailer'),
    (at_eq, c, 'Equipment'), (at_mach, c, 'Machine'), (at_other, c, 'Other'), (at_emp, c, 'Employee Vehicle'),
    (at_bldg, c, 'Building / Facility'), (at_ret, c, 'Retired');

  insert into maintenance_types (id, company_id, name, interval_miles, interval_months, is_active) values
    (mt_oil, c, 'Oil Change', 5000, 6, true), (mt_tire, c, 'Tires', null, 12, true), (mt_brake, c, 'Brakes', null, 12, true),
    (mt_insp, c, 'Inspection', null, 12, true), (mt_reg, c, 'Registration', null, 12, true),
    (gen_random_uuid(), c, 'Fluids', null, null, true), (gen_random_uuid(), c, 'Filters', null, null, true),
    (gen_random_uuid(), c, 'Batteries', null, null, true), (gen_random_uuid(), c, 'Lights', null, null, true),
    (gen_random_uuid(), c, 'Hydraulic', null, null, true), (gen_random_uuid(), c, 'Trailer Maintenance', null, null, true),
    (gen_random_uuid(), c, 'Equipment Maintenance', null, null, true), (gen_random_uuid(), c, 'Custom', null, null, true);

  create temp table _assets (unit text, tname text, at uuid, yr int, make text, model text, status text, miles int, who uuid, hrs boolean) on commit drop;
  insert into _assets values
    ('S-101','Service Truck 101',at_svc,2022,'Ford','F-550 Service Body','active',68412,cody,false),
    ('S-102','Service Truck 102',at_svc,2021,'Ford','F-550 Service Body','active',91233,pat,false),
    ('S-103','Service Truck 103',at_svc,2023,'Ram','5500 Service Body','active',38120,avery,false),
    ('S-104','Service Truck 104',at_svc,2020,'Ford','F-450 Service Body','in_shop',118904,logan,false),
    ('S-105','Service Truck 105',at_svc,2019,'Chevrolet','Silverado 3500 Service','down',142577,null,false),
    ('S-106','Service Truck 106',at_svc,2024,'Ford','F-550 Service Body','active',12840,jordan,false),
    ('C-201','Construction Truck 201',at_con,2021,'Freightliner','M2 106 Dump',  'active',77310,blake,false),
    ('C-202','Construction Truck 202',at_con,2020,'Ford','F-750 Crane Body','active',84402,quinn,false),
    ('C-203','Construction Truck 203',at_con,2022,'International','HV507 Dump','available',41290,null,false),
    ('C-204','Construction Truck 204',at_con,2018,'Ford','F-650 Flatbed','unsafe',156210,null,false),
    ('P-301','Pickup 301',at_pick,2023,'Ford','F-150 XL',      'active',22904,demo,false),
    ('P-302','Pickup 302',at_pick,2022,'Toyota','Tundra SR',   'active',35670,casey,false),
    ('P-303','Pickup 303',at_pick,2021,'Chevrolet','Silverado 1500','active',51388,morgan,false),
    ('P-304','Pickup 304',at_pick,2020,'Ram','1500 Tradesman', 'available',66012,null,false),
    ('T-401','Equipment Trailer 401',at_trl,2019,'Big Tex','14ET Equipment','active',null,null,false),
    ('T-402','Dump Trailer 402',at_trl,2021,'PJ Trailers','DL 14ft Dump','active',null,null,false),
    ('T-403','Enclosed Trailer 403',at_trl,2018,'Haulmark','Transport 7x16','available',null,null,false),
    ('E-501','Mini Excavator 501',at_eq,2021,'Kubota','KX040-4','active',null,null,true),
    ('E-502','Skid Steer 502',at_eq,2020,'Bobcat','S650','in_shop',null,null,true),
    ('E-503','Towable Generator 503',at_eq,2019,'Generac','MLG25','available',null,null,true),
    ('M-601','Concrete Saw 601',at_mach,2022,'Husqvarna','FS 400 LV','active',null,null,true),
    ('M-602','Vac Trailer 602',at_mach,2020,'Vactor','HXX ProVac','active',null,null,true);

  for r in select * from _assets loop
    v_id := gen_random_uuid();
    asset_ids := asset_ids || v_id; asset_units := asset_units || r.unit;
    insert into assets (id, company_id, asset_type_id, unit_number, name, year, make, model, vin, license_plate, status,
      assigned_profile_id, current_mileage, current_hours, uses_hours, oil_change_interval_miles, oil_change_interval_months,
      last_oil_change_date, last_oil_change_mileage, next_oil_change_mileage, last_brake_service_date, next_brake_inspection_date,
      last_tire_service_date, next_tire_inspection_date, inspection_due_date, registration_due_date, insurance_due_date, is_active, notes)
    values (v_id, c, r.at, r.unit, r.tname, r.yr, r.make, r.model,
      case when r.miles is not null then 'DEMO' || upper(substr(md5(r.unit),1,13)) end,
      case when r.miles is not null or r.at = at_trl then 'DMO-' || (1000 + (random()*8999)::int) end,
      r.status, r.who, r.miles,
      case when r.hrs then round((300 + random()*2400)::numeric, 1) end, r.hrs,
      case when r.miles is not null then 5000 end, case when r.miles is not null then 6 end,
      case when r.miles is not null then d0 - (20 + (random()*160)::int) end,
      case when r.miles is not null then greatest(r.miles - (500 + (random()*5200)::int), 0) end,
      case when r.miles is not null then greatest(r.miles - (500 + (random()*5200)::int), 0) + 5000 end,
      d0 - (60 + (random()*300)::int), d0 + (-20 + (random()*200)::int),
      d0 - (60 + (random()*300)::int), d0 + (-15 + (random()*220)::int),
      d0 + (-25 + (random()*330)::int), d0 + (-10 + (random()*340)::int), d0 + (30 + (random()*300)::int), true,
      case r.status when 'down' then 'Transmission slipping — waiting on rebuild quote.' when 'unsafe' then 'Do not drive: steering box play found on service inspection.' end);
  end loop;

  -- mileage history (weekly, last 10 weeks)
  for r in select a.id, a.current_mileage, a.assigned_profile_id from assets a where a.current_mileage is not null loop
    for i in 0..9 loop
      insert into mileage_entries (company_id, asset_id, submitted_by, entry_date, mileage, source)
      values (c, r.id, coalesce(r.assigned_profile_id, riley), d0 - i*7, r.current_mileage - i*(250 + (random()*400)::int),
              (array['manual','fuel_receipt','driver_report'])[1 + (i % 3)]);
    end loop;
  end loop;

  -- oil change + maintenance history
  for r in select a.id, a.unit_number, a.last_oil_change_date, a.last_oil_change_mileage from assets a where a.last_oil_change_date is not null loop
    v_id := gen_random_uuid();
    insert into maintenance_events (id, company_id, asset_id, maintenance_type_id, performed_by, performed_date, mileage_at_service, next_due_mileage, next_due_date, vendor, cost, labor_hours, notes)
    values (v_id, c, r.id, mt_oil, (array[reese,jamie])[1 + (random()::int)], r.last_oil_change_date, r.last_oil_change_mileage, r.last_oil_change_mileage + 5000,
            r.last_oil_change_date + 180, 'In-house shop', round((90 + random()*80)::numeric, 2), 1.0, 'Oil, filter, chassis lube, service inspection.');
    insert into oil_change_records (asset_id, maintenance_event_id, service_date, mileage, oil_type, filter_used, completed_by, cost, labor_minutes, vendor)
    values (r.id, v_id, r.last_oil_change_date, r.last_oil_change_mileage, '15W-40 synthetic blend', 'FL-2051S', reese, round((90 + random()*80)::numeric, 2), 60, 'In-house shop');
  end loop;

  -- repair tickets
  create temp table _tk (unit text, title text, descr text, pri text, sev text, safety text, status text, who uuid, age int, parts boolean) on commit drop;
  insert into _tk values
    ('S-105','Transmission slipping in 3rd gear','Driver reports RPM flare between 2-3 shift under load. Pulled from service.','high','major','schedule_soon','waiting_parts',reese,9,true),
    ('C-204','Steering box play — DO NOT DRIVE','Found 2" of play at wheel during service inspection. Tagged out.','safety','critical','unsafe','unsafe_do_not_use',riley,4,true),
    ('S-104','Replace front brake pads and rotors','Grinding noise from front left. Pads at 2mm.','high','moderate','schedule_soon','in_progress',jamie,2,true),
    ('E-502','Hydraulic leak at boom cylinder','Steady drip at rod seal, left boom cylinder.','normal','moderate','monitor','in_progress',reese,3,true),
    ('S-101','Service body compartment latch broken','Rear passenger-side compartment won''t latch.','low','minor','none','open',null,1,false),
    ('S-102','Check engine light — P0420','Code P0420 catalyst efficiency. Running fine.','normal','minor','monitor','assigned',jamie,5,false),
    ('P-303','Tire rotation + alignment','Pulling right at highway speed.','normal','minor','monitor','scheduled',reese,6,false),
    ('T-402','Dump trailer hoist slow to raise','Hoist takes 45 sec to raise empty. Check pump & fluid.','normal','moderate','none','new',null,0,false),
    ('C-201','DEF warning on dash','DEF level fine — suspect sensor.','normal','minor','none','needs_review',null,1,false),
    ('S-103','Install new inverter in service body','Upgrade to 3000W inverter for power tools.','low','minor','none','waiting_approval',riley,7,true),
    ('E-501','500-hour service','Engine oil, hydraulic filter, grease all points.','normal','minor','none','paused',jamie,8,false),
    ('M-602','Vac hose cracked at coupler','Replace 8" suction hose section.','normal','moderate','none','waiting_parts',reese,11,true),
    ('S-106','Mount new ladder rack','Ladder rack delivered — install on new truck.','low','minor','none','completed',jamie,15,false),
    ('P-301','Windshield chip repair','Chip passenger side, mobile glass came out.','low','minor','none','completed',riley,21,false),
    ('C-202','Crane hydraulic hose replaced','Pinhole leak at boom hose, replaced and tested.','high','major','none','completed',reese,26,true),
    ('S-101','Replace rear tires (2)','Rear tires at 4/32. Replaced both outers.','normal','moderate','none','closed',jamie,33,true),
    ('T-401','Trailer brake controller wiring','Intermittent trailer brakes — corroded plug fixed.','high','moderate','none','closed',reese,40,false),
    ('E-503','Generator won''t start','Fuel stabilizer + new battery, starts fine.','normal','minor','none','completed',jamie,18,false),
    ('P-304','Annual state inspection','State inspection due end of month.','normal','minor','needs_inspection','scheduled',riley,2,false),
    ('C-203','Replace cab air filter + wipers','Routine service add-on.','low','minor','none','deferred',null,12,false);

  for r in select * from _tk loop
    v_id := gen_random_uuid();
    insert into repair_tickets (id, company_id, ticket_number, asset_id, created_by, assigned_to, title, description, source, priority, severity, safety_status, status,
      parts_needed, parts_ordered, waiting_on_parts, total_labor_hours, total_cost, date_completed, completed_by, completion_notes, created_at, updated_at, due_date)
    values (v_id, c,
      to_char(d0 - r.age, 'FMMM') || to_char(d0 - r.age, 'FMDD') || to_char(d0 - r.age, 'YY') || r.unit,
      (select id from assets where unit_number = r.unit), (array[riley, demo, cody, blake])[1 + (abs(hashtext(r.title)) % 4)], r.who,
      r.title, r.descr, (array['employee','manager','inspection','manual'])[1 + (abs(hashtext(r.unit)) % 4)], r.pri, r.sev, r.safety, r.status,
      r.parts, r.parts and r.status <> 'new', r.status = 'waiting_parts',
      case when r.status in ('completed','closed') then round((1 + random()*6)::numeric, 1) when r.status in ('in_progress','paused') then round((0.5 + random()*3)::numeric, 1) else 0 end,
      case when r.status in ('completed','closed') then round((150 + random()*1400)::numeric, 2) end,
      case when r.status in ('completed','closed') then d0 - r.age + 2 end,
      case when r.status in ('completed','closed') then r.who end,
      case when r.status in ('completed','closed') then 'Repaired and road tested. Returned to service.' end,
      now() - (r.age || ' days')::interval, now() - ((r.age / 2) || ' days')::interval, d0 - r.age + 7);
    insert into repair_ticket_comments (ticket_id, author_id, comment, created_at) values
      (v_id, coalesce(r.who, riley), 'Looked it over — ' || lower(r.descr), now() - (r.age || ' days')::interval + interval '3 hours');
    if r.parts then
      insert into repair_ticket_comments (ticket_id, author_id, comment, created_at) values
        (v_id, sam, 'Parts ordered from Valley Truck Parts, ETA 2 business days.', now() - (r.age || ' days')::interval + interval '1 day');
    end if;
  end loop;

  -- shop time clock (last 10 workdays) + live statuses
  for r in select unnest(array[riley, reese, jamie]) as pid loop
    for i in 1..14 loop
      if extract(isodow from d0 - i) < 6 then
        insert into time_clock_entries (company_id, profile_id, clock_in, clock_out, total_minutes, break_minutes, is_approved, approved_by, approved_at)
        values (c, r.pid,
          ((d0 - i) + time '07:00' + ((random()*20)::int || ' minutes')::interval) at time zone 'America/New_York',
          ((d0 - i) + time '15:30' + ((random()*60)::int || ' minutes')::interval) at time zone 'America/New_York',
          480 + (random()*60)::int, 30, i > 3, case when i > 3 then demo end, case when i > 3 then now() - ((i - 3) || ' days')::interval end);
      end if;
    end loop;
  end loop;
  insert into time_clock_entries (company_id, profile_id, clock_in) values
    (c, reese, (d0 + time '06:58') at time zone 'America/New_York'),
    (c, jamie, (d0 + time '07:05') at time zone 'America/New_York');
  insert into employee_statuses (profile_id, company_id, clock_status, current_status, current_ticket_id, current_asset_id, status_updated_at) values
    (reese, c, 'clocked_in', 'working_on_ticket', (select id from repair_tickets where title like 'Hydraulic leak%'), (select id from assets where unit_number = 'E-502'), now() - interval '40 minutes'),
    (jamie, c, 'clocked_in', 'working_on_ticket', (select id from repair_tickets where title like 'Replace front brake%'), (select id from assets where unit_number = 'S-104'), now() - interval '1 hour'),
    (riley, c, 'clocked_out', 'clocked_out', null, null, now() - interval '14 hours');

  -- 4. customers, sites, rate card ---------------------------------------------
  insert into billing_rate_cards (id, company_id, name, labor_rate, overtime_rate, trip_rate, trip_mode, material_markup, sub_markup, sales_tax_pct, terms_days, active, trip_fee_flat, trip_fee_flat_afterhours)
  values (rc, c, 'Standard 2026', 115, 172.50, 95, 'flat', 25, 15, 5.3, 30, true, 95, 145);

  insert into con_customers (id, company_id, name, billing_contact, email, phone, billing_address, brand, rate_card_id) values
    (cu_qs,   c, 'QuickStop Markets',          'Facilities AP',     'ap@quickstop.example',     '(555) 020-2000', '100 Commerce Way, Maple Hill, VA 22000', 'QuickStop', rc),
    (cu_hill, c, 'Hilltop Fuel Co.',           'Dana Whitaker',     'dana@hilltopfuel.example', '(555) 020-2100', '42 Ridge Rd, Pine Ridge, VA 22010', 'Hilltop', rc),
    (cu_val,  c, 'Valley Travel Plazas',       'Maintenance Desk',  'maint@valleytp.example',   '(555) 020-2200', '9 Interstate Dr, Riverton, VA 22020', 'Valley', rc),
    (cu_tcs,  c, 'Tri-County Schools Fleet',   'Transportation Dept','fleet@tcs.example',       '(555) 020-2300', '500 Education Ln, Fairview, VA 22030', 'Municipal', rc);

  create temp table _sites (num text, cust uuid, brand text, addr text, city text, zip text, disp int, tanks int) on commit drop;
  insert into _sites values
    ('1042', cu_qs, 'QuickStop', '1201 Commerce Blvd',  'Maple Hill', '22001', 6, 3),
    ('1057', cu_qs, 'QuickStop', '88 Station Rd',       'Maple Hill', '22002', 4, 2),
    ('1103', cu_qs, 'QuickStop', '2450 Lakeview Pkwy',  'Lakeside',   '22041', 8, 3),
    ('1118', cu_qs, 'QuickStop', '17 Old Mill Rd',      'Brookside',  '22052', 4, 2),
    ('1126', cu_qs, 'QuickStop', '930 Harbor Ave',      'Riverton',   '22021', 6, 3),
    ('1204', cu_qs, 'QuickStop', '601 Founders Dr',     'Oak Grove',  '22063', 6, 3),
    ('1219', cu_qs, 'QuickStop', '3302 Sunset Hwy',     'Fairview',   '22031', 10, 4),
    ('1233', cu_qs, 'QuickStop', '75 Chestnut St',      'Pine Ridge', '22011', 4, 2),
    ('H-210', cu_hill, 'Hilltop', '12 Summit Ln',       'Pine Ridge', '22012', 4, 2),
    ('H-224', cu_hill, 'Hilltop', '480 Valley View Rd', 'Brookside',  '22053', 6, 3),
    ('H-238', cu_hill, 'Hilltop', '2100 County Rt 9',   'Oak Grove',  '22064', 4, 2),
    ('VTP-5', cu_val, 'Valley',   'Exit 5, 1 Plaza Dr', 'Riverton',   '22022', 16, 5),
    ('VTP-9', cu_val, 'Valley',   'Exit 9, 9 Plaza Dr', 'Lakeside',   '22042', 12, 4),
    ('TCS-BUS', cu_tcs, 'Municipal', '500 Education Ln', 'Fairview', '22030', 2, 2),
    ('TCS-MNT', cu_tcs, 'Municipal', '14 Depot St',      'Fairview', '22032', 2, 1);

  for r in select * from _sites loop
    v_id := gen_random_uuid();
    site_ids := site_ids || v_id; site_nums := site_nums || r.num; site_cust := site_cust || r.cust;
    site_addr := site_addr || r.addr; site_city := site_city || r.city; site_brand := site_brand || r.brand;
    insert into con_sites (id, company_id, customer_id, site_number, store_brand, address, city, state, zip, dispenser_count, dispenser_type, tank_count, tank_type,
      stp_count, stp_type, fill_spill_bucket_count, fill_spill_bucket_type, vapor_bucket_count, vapor_bucket_type)
    values (v_id, c, r.cust, r.num, r.brand, r.addr, r.city, 'VA', r.zip, r.disp, 'Wayne Anthem', r.tanks, 'Double-wall fiberglass',
      r.tanks, 'Red Jacket 1.5HP', r.tanks, 'OPW 1-2100', 1, 'OPW 1DK');
  end loop;

  -- 5. service work orders -----------------------------------------------------
  insert into svc_technicians (id, company_id, profile_id, full_name, role, is_active)
  select gen_random_uuid(), c, p.id, p.full_name, case when p.id = jordan then 'service_manager' else 'service_tech' end, true
    from profiles p where p.id in (jordan, cody, pat, avery, logan);
  select array_agg(id order by full_name), array_agg(full_name order by full_name) into techs, tech_names from svc_technicians where role = 'service_tech';

  create temp table _wo (subj text, descr text) on commit drop;
  insert into _wo values
    ('Dispenser 3/4 not dispensing regular','Customer reports no flow on regular, both sides. Other grades OK.'),
    ('Card reader down on pump 7','Card reader not reading chip cards. Pay inside only.'),
    ('STP alarm — premium tank','Console showing STP fault on premium. Possible relay.'),
    ('Leak detector alarm on diesel line','Mechanical leak detector tripped, slow flow on diesel.'),
    ('Nozzle hose damaged — drive-off','Breakaway separated, hose and nozzle damaged on pump 2.'),
    ('Annual line and leak detector test','Annual compliance testing of lines and LDs.'),
    ('Water in tank — regular','ATG shows 1.8" water in regular tank.'),
    ('Price sign not updating','Street sign showing old prices, POS updated.'),
    ('Slow flow all dispensers','All dispensers pumping 4-5 GPM. Check filters.'),
    ('Spill bucket full of water','Spill buckets need pumped out and inspected.'),
    ('Sump sensor alarm — UDC 5','Liquid sensor alarm in dispenser sump 5.'),
    ('Monthly walkthrough inspection','Monthly operator walkthrough + photos.');

  for i in 1..44 loop
    k := 1 + ((i * 7) % 15);  -- site index
    insert into svc_work_orders (company_id, source_portal, client_name, portal_wo_number, incident_number, site_number, site_name, site_address, site_city, site_state,
      priority_raw, priority_rank, subject_raw, description, status, assigned_technician_id, dispatched_at, accepted_at, last_update_at, sla_due_at, completed_at,
      return_trip_needed, return_trip_reason, completion_note_raw, invoiced, invoice_number, invoice_submitted_at, archived, created_at, updated_at)
    select c, case site_cust[k] when cu_qs then '7help' when cu_hill then 'it_service_desk' when cu_val then 'wtsc' else 'unknown' end,
      (select name from con_customers where id = site_cust[k]), 'WO-' || (880000 + i * 37), 'INC' || (4400000 + i * 113),
      site_nums[k], site_brand[k] || ' #' || site_nums[k], site_addr[k], site_city[k], 'VA',
      (array['P1 - Critical','P2 - Emergency','P3 - Rush','P4 - Routine'])[1 + (i % 4)], 1 + (i % 4),
      w.subj, w.descr,
      case when i <= 8 then 'dispatched' when i <= 12 then 'in_progress' when i <= 16 then 'rtn_needed' else 'completed' end,
      techs[1 + (i % array_length(techs, 1))],
      now() - ((i * 9) || ' hours')::interval,
      case when i > 4 then now() - ((i * 9 - 1) || ' hours')::interval end,
      now() - ((i * 4) || ' hours')::interval,
      now() - ((i * 9) || ' hours')::interval + (array[interval '4 hours', interval '24 hours', interval '48 hours', interval '5 days'])[1 + (i % 4)],
      case when i > 16 then now() - ((i * 9 - 6) || ' hours')::interval end,
      i between 13 and 16, case when i between 13 and 16 then 'Part on order — ' || (array['new STP relay','replacement nozzle','card reader','leak detector'])[i - 12] end,
      case when i > 16 then 'Repaired and tested. Site operational.' end,
      i > 26, case when i > 26 then 'S-' || (26000 + i) end, case when i > 26 then now() - ((i * 9 - 30) || ' hours')::interval end,
      false, now() - ((i * 9) || ' hours')::interval, now() - ((i * 4) || ' hours')::interval
    from _wo w offset ((i - 1) % 12) limit 1;
  end loop;

  -- 6. construction ------------------------------------------------------------
  insert into con_contacts (company_id, name, kind, title, email, phone, customer_id, employer, is_active) values
    (c, 'Dana Whitaker', 'customer', 'Facilities Manager', 'dana@hilltopfuel.example', '(555) 020-2101', cu_hill, 'Hilltop Fuel Co.', true),
    (c, 'Marcus Lee', 'customer', 'Construction PM', 'mlee@quickstop.example', '(555) 020-2001', cu_qs, 'QuickStop Markets', true),
    (c, 'Priya Shah', 'customer', 'Environmental Compliance', 'pshah@quickstop.example', '(555) 020-2002', cu_qs, 'QuickStop Markets', true),
    (c, 'Tom Becker', 'customer', 'Maintenance Lead', 'tbecker@valleytp.example', '(555) 020-2201', cu_val, 'Valley Travel Plazas', true),
    (c, 'Gina Russo', 'vendor', 'Inside Sales', 'gina@fuelparts.example', '(555) 030-3001', null, 'Atlantic Fuel Parts Supply', true),
    (c, 'Ray Dunn', 'vendor', 'Dispatcher', 'ray@readymix.example', '(555) 030-3002', null, 'County Ready-Mix', true),
    (c, 'Lena Ortiz', 'other', 'Permit Technician', 'permits@maplecounty.example', '(555) 040-4001', null, 'Maple County Building Dept', true);

  insert into con_vendors (company_id, name, category, contact_name, phone, email, account_number, is_active) values
    (c, 'Atlantic Fuel Parts Supply', 'Fuel system parts', 'Gina Russo', '(555) 030-3001', 'orders@fuelparts.example', 'SUM-1001', true),
    (c, 'County Ready-Mix', 'Concrete', 'Ray Dunn', '(555) 030-3002', 'dispatch@readymix.example', 'C-4471', true),
    (c, 'Valley Truck Parts', 'Fleet parts', 'Counter', '(555) 030-3003', 'counter@valleytruck.example', 'VT-2290', true),
    (c, 'Tri-State Equipment Rental', 'Equipment rental', 'Rental Desk', '(555) 030-3004', 'rent@tristate.example', 'TS-883', true),
    (c, 'Bluegrass Electrical Supply', 'Electrical', 'Counter', '(555) 030-3005', 'sales@bluegrasselec.example', 'BES-17', true);

  create temp table _jobs (stage text, site int, scope text, prog text, pri text, ago int) on commit drop;
  insert into _jobs values
    ('survey',            3,  'Spill bucket survey — all tanks', 'Spill Bucket Program', 'normal', 3),
    ('survey',            12, 'UDC sump survey for containment upgrade', 'Sump Upgrades', 'normal', 5),
    ('quoting',           1,  'Replace 3 spill buckets (RUL/PUL/DSL)', 'Spill Bucket Program', 'normal', 9),
    ('quoting',           10, 'Install 2 new dispensers + islands', 'Dispenser Replacement', 'high', 12),
    ('permitting',        7,  'Dispenser replacement x10 (Phase 1)', 'Dispenser Replacement', 'high', 30),
    ('permitting',        13, 'STP circuit repair — diesel', 'Electrical', 'urgent', 14),
    ('material_ordering', 2,  'Replace overfill valves', 'Spill Bucket Program', 'normal', 21),
    ('material_ordering', 9,  'UDC replacement pump 1-4', 'Sump Upgrades', 'normal', 25),
    ('needs_scheduled',   4,  'Spill bucket replacement x2', 'Spill Bucket Program', 'normal', 28),
    ('needs_scheduled',   14, 'Fleet island canopy lighting', 'Electrical', 'low', 35),
    ('scheduled',         5,  'Replace 3 spill buckets + vapor bucket', 'Spill Bucket Program', 'normal', 33),
    ('scheduled',         11, 'Install new ATG console + probes', 'Tank Monitoring', 'high', 40),
    ('in_progress',       6,  'Dispenser replacement x6', 'Dispenser Replacement', 'high', 45),
    ('in_progress',       12, 'Concrete island repair + bollards', 'Site Repairs', 'normal', 20),
    ('on_hold',           8,  'Product line replacement — waiting on owner approval', 'Product Line', 'normal', 60),
    ('return_needed',     1,  'Return: re-test vapor bucket after repair', 'Spill Bucket Program', 'high', 18),
    ('return_needed',     15, 'Return: finish striping after rain', 'Site Repairs', 'low', 16),
    ('close_out',         3,  'Spill bucket replacement x3', 'Spill Bucket Program', 'normal', 55),
    ('close_out',         9,  'Sump sensor replacement', 'Tank Monitoring', 'normal', 50),
    ('invoicing',         2,  'Dispenser sump boot replacement', 'Sump Upgrades', 'normal', 70),
    ('invoicing',         13, 'Emergency shear valve replacement', 'Emergency', 'urgent', 40),
    ('complete',          4,  'Spill bucket replacement x2', 'Spill Bucket Program', 'normal', 95),
    ('complete',          7,  'New canopy LED retrofit', 'Electrical', 'normal', 110),
    ('complete',          10, 'Tank top sump upgrade', 'Sump Upgrades', 'normal', 120),
    ('overspill_program', 5,  'Overspill containment program — annual', 'Overspill Program', 'normal', 80),
    ('overspill_program', 11, 'Overspill containment program — annual', 'Overspill Program', 'normal', 85);

  for r in select * from _jobs loop
    v_id := gen_random_uuid();
    job_ids := job_ids || v_id; job_sites := job_sites || r.site; job_stages := job_stages || r.stage;
    insert into con_jobs (id, company_id, site_id, site_number, customer_id, work_order_number, stage, status_detail, scope_of_work, facility_address, gas_brand,
      program, priority, date_received, project_start_date, assigned_manager_id, notes, po_number, created_at)
    values (v_id, c, site_ids[r.site], site_nums[r.site], site_cust[r.site], 'WO-' || (500100 + array_length(job_ids, 1) * 13), r.stage,
      case r.stage when 'on_hold' then 'Waiting on owner approval' when 'permitting' then 'Permit submitted to county' when 'material_ordering' then 'Parts ordered, ETA next week'
                   when 'return_needed' then 'Return trip needed' when 'close_out' then 'Close-out package in progress' end,
      r.scope, site_addr[r.site] || ', ' || site_city[r.site] || ', VA', site_brand[r.site], r.prog, r.pri,
      d0 - r.ago, case when r.stage in ('scheduled','in_progress','return_needed','close_out','invoicing','complete','overspill_program') then d0 - r.ago + 20 end,
      casey, null, case when r.stage in ('invoicing','complete') then 'PO-' || (77000 + array_length(job_ids, 1)) end,
      now() - (r.ago || ' days')::interval);
    -- backfill a believable stage trail
    for k in 1..array_position(stages, r.stage) - 1 loop
      exit when k > 11;
      insert into con_job_stage_history (company_id, job_id, changed_at, changed_by, changed_by_name, from_stage, to_stage)
      values (c, v_id, now() - (round(r.ago * (1 - k::numeric / array_position(stages, r.stage)), 2) || ' days')::interval - interval '3 hours', casey, 'Casey Whitfield', stages[k], stages[k + 1]);
    end loop;
  end loop;
  -- the insert trigger stamps the first stage at "now"; move it back to when the job came in
  update con_job_stage_history h set changed_at = j.created_at, changed_by = casey, changed_by_name = 'Casey Whitfield'
    from con_jobs j where h.job_id = j.id and h.from_stage is null;
  update con_job_stage_history set changed_at = least(changed_at, now() - interval '1 hour');

  -- schedule: next 10 workdays + last 5
  for i in -5..12 loop
    if extract(isodow from d0 + i) < 6 then
      k := 1 + ((i + 20) % array_length(job_ids, 1));
      insert into con_schedule_entries (company_id, schedule_date, job_id, site_number, task_description, crew, equipment, entry_type, source, sort_order, stage_text)
      select c, d0 + i, j.id, j.site_number, j.scope_of_work, array['Blake Harper', 'Quinn Foster', 'Devon Price'], 'C-201, T-401, E-501', 'job', 'manual', 1, j.stage
        from con_jobs j where j.stage in ('scheduled','in_progress','return_needed','overspill_program') order by j.created_at offset (abs(i) % 6) limit 1;
      insert into con_schedule_entries (company_id, schedule_date, job_id, site_number, task_description, crew, equipment, entry_type, source, sort_order, stage_text)
      select c, d0 + i, j.id, j.site_number, j.scope_of_work, array['Quinn Foster'], 'C-202', 'job', 'manual', 2, j.stage
        from con_jobs j where j.stage in ('scheduled','in_progress','needs_scheduled') order by j.created_at desc offset (abs(i) % 4) limit 1;
    end if;
  end loop;
  insert into con_schedule_entries (company_id, schedule_date, entry_type, task_description, crew, source, sort_order)
  values (c, d0 + 3, 'time_off', 'Vacation', array['Devon Price'], 'manual', 9),
         (c, d0 + 1, 'note', 'Safety meeting 6:45 AM at the shop', null, 'manual', 0);

  -- daily updates for active / finished jobs
  for r in select j.id, j.stage, j.project_start_date, j.scope_of_work from con_jobs j where j.stage in ('in_progress','return_needed','close_out','invoicing','complete') loop
    for i in 0..2 loop
      v_id := gen_random_uuid();
      insert into con_daily_updates (id, company_id, job_id, work_date, work_description, weather, notes, submitted_by, review_status, source)
      values (v_id, c, r.id, least(coalesce(r.project_start_date, d0 - 10) + i, d0),
        (array['Mobilized, set up traffic control, saw cut and broke out concrete around tank pad.',
               'Removed old spill buckets, installed new double-wall buckets, hydro tested — passed.',
               'Poured concrete, cleaned site, photos taken for close-out.'])[i + 1],
        (array['Sunny, 58°F','Overcast, 49°F','Light rain AM, 52°F'])[i + 1], null, blake, case when i = 2 and r.stage = 'in_progress' then 'needs_review' else 'filed' end, 'manual');
      insert into con_daily_update_techs (company_id, daily_update_id, tech_name, initials, hours) values
        (c, v_id, 'Blake Harper', 'BH', 9), (c, v_id, 'Quinn Foster', 'QF', 9), (c, v_id, 'Devon Price', 'DP', 8.5);
    end loop;
  end loop;

  -- My Plate tasks
  insert into con_tasks (company_id, owner_id, title, detail, kind, site_number, job_id, priority, due_date, status, waiting_on, waiting_since, source) values
    (c, demo,   'Approve quote for Hilltop H-224 dispensers', 'Morgan finished the takeoff — review and send.', 'quote', 'H-224', job_ids[4], 1, d0, 'open', null, null, 'manual'),
    (c, demo,   'Call QuickStop about #1233 product line', 'Owner approval still pending on the line replacement.', 'followup', '1233', job_ids[15], 2, d0 + 1, 'waiting', 'Marcus Lee (QuickStop)', d0 - 6, 'manual'),
    (c, demo,   'Sign off on 3 time-card corrections', null, 'admin', null, null, 2, d0, 'open', null, null, 'manual'),
    (c, demo,   'Review November fuel card statement', null, 'admin', null, null, 3, d0 + 4, 'open', null, null, 'manual'),
    (c, casey,  'Order ATG console for VTP-5', 'Vendor quote approved.', 'order', 'VTP-5', job_ids[12], 1, d0 + 1, 'open', null, null, 'manual'),
    (c, casey,  'Get permit status from Maple County', null, 'followup', '1219', job_ids[5], 2, d0 + 2, 'waiting', 'Maple County permits', d0 - 3, 'manual'),
    (c, morgan, 'Price spill bucket job #1042', null, 'price', '1042', job_ids[3], 1, d0 + 2, 'open', null, null, 'manual'),
    (c, morgan, 'Bid: Valley Travel Plazas canopy LEDs', null, 'bid', 'VTP-9', null, 2, d0 + 7, 'open', null, null, 'manual'),
    (c, demo,   'Send close-out package for #1103', null, 'admin', '1103', job_ids[18], 2, d0 - 1, 'done', null, null, 'manual');
  update con_tasks set done_at = now() - interval '1 day' where status = 'done';

  -- quotes + invoices
  for i in 1..10 loop
    k := job_sites[1 + ((i * 3) % array_length(job_ids, 1))];
    v_id := gen_random_uuid();
    insert into con_quotes (id, company_id, job_id, proposal_date, customer_id, attn, customer_email, store_label, site_number, facility_address, city_state_zip, project_description,
      profit_overhead_percent, sales_tax_percent, basic_subtotal_material, basic_subtotal_labor, basic_total, grand_total, profit_overhead_amount, tax_amount, final_total,
      status, prepared_by, sent_date, decision_date, department, valid_until, labor_rate, rate_card_id, kind, signer_id)
    values (v_id, c, job_ids[1 + ((i * 3) % array_length(job_ids, 1))], d0 - (5 + i * 6), site_cust[k], 'Facilities', 'ap@example.com',
      site_brand[k] || ' #' || site_nums[k], site_nums[k], site_addr[k], site_city[k] || ', VA', (select scope_of_work from con_jobs where id = job_ids[1 + ((i * 3) % array_length(job_ids, 1))]),
      10, 5.3, 0, 0, 0, 0, 0, 0, 0,
      (array['draft','sent','approved','approved','rejected','sent','approved','draft','sent','approved'])[i], 'Morgan Ellis',
      case when i not in (1, 8) then d0 - (4 + i * 6) end, case when i in (3,4,5,7,10) then d0 - (i * 5) end,
      'construction', d0 + 30 - i * 6, 115, rc, 'quote', demo);
    insert into con_quote_line_items (quote_id, section, line_no, description, quantity, unit_cost, material_total, labor_hours, labor_rate, total_labor, total_material_labor, item_type, sort_order) values
      (v_id, 'basic', 1, 'Double-wall spill bucket, 15 gal', 3, 1185.00, 3555.00, 0, 115, 0, 3555.00, 'material', 1),
      (v_id, 'basic', 2, 'Concrete, 4000 PSI (yd)', 2, 210.00, 420.00, 0, 115, 0, 420.00, 'material', 2),
      (v_id, 'basic', 3, 'Labor — 3-man crew', 1, 0, 0, 24 + i, 115, (24 + i) * 115, (24 + i) * 115, 'labor', 3),
      (v_id, 'basic', 4, 'Trip charge', 2, 95.00, 190.00, 0, 115, 0, 190.00, 'trip', 4),
      (v_id, 'additional', 1, 'Hydrostatic test + report', 3, 85.00, 255.00, 0, 115, 0, 255.00, 'service', 5);
    update con_quotes set basic_subtotal_material = 4165, basic_subtotal_labor = (24 + i) * 115, basic_total = 4165 + (24 + i) * 115,
      additional_subtotal_material = 255, additional_total = 255, grand_total = 4420 + (24 + i) * 115,
      profit_overhead_amount = round((4420 + (24 + i) * 115) * 0.10, 2), tax_amount = round(4165 * 0.053, 2),
      final_total = round((4420 + (24 + i) * 115) * 1.10 + 4165 * 0.053, 2) where id = v_id;
  end loop;

  for i in 1..8 loop
    k := job_sites[array_position(job_stages, (array['invoicing','invoicing','complete','complete','complete','close_out','overspill_program','complete'])[i])];
    v_id := gen_random_uuid();
    insert into con_invoices (id, company_id, job_id, invoice_date, customer_id, attn, store_label, site_number, facility_address, city_state_zip, project_description,
      profit_overhead_percent, sales_tax_percent, basic_subtotal_material, basic_subtotal_labor, basic_total, grand_total, tax_amount, invoice_grand_total,
      status, sent_date, due_date, paid_date, prepared_by, department, po_number, labor_rate, rate_card_id, signer_id)
    values (v_id, c, job_ids[array_position(job_stages, (array['invoicing','invoicing','complete','complete','complete','close_out','overspill_program','complete'])[i])],
      d0 - i * 9, site_cust[k], 'Accounts Payable', site_brand[k] || ' #' || site_nums[k], site_nums[k], site_addr[k], site_city[k] || ', VA', 'Work completed per approved quote.',
      10, 5.3, 2800 + i * 410, 2200 + i * 230, 5000 + i * 640, 5000 + i * 640, round((2800 + i * 410) * 0.053, 2), round((5000 + i * 640) + (2800 + i * 410) * 0.053, 2),
      (array['draft','sent','sent','paid','paid','overdue','paid','void'])[i],
      case when i > 1 then d0 - i * 9 + 1 end, d0 - i * 9 + 30, case when i in (4,5,7) then d0 - i * 9 + 21 end,
      'Taylor Brooks', 'construction', 'PO-' || (77100 + i), 115, rc, demo);
    insert into con_invoice_line_items (invoice_id, section, line_no, description, quantity, unit_cost, material_total, labor_hours, labor_rate, total_labor, total_material_labor, item_type, charge_type, sort_order) values
      (v_id, 'basic', 1, 'Materials per quote', 1, 2800 + i * 410, 2800 + i * 410, 0, 115, 0, 2800 + i * 410, 'material', 'billable', 1),
      (v_id, 'basic', 2, 'Labor', 1, 0, 0, round((2200 + i * 230) / 115.0, 1), 115, 2200 + i * 230, 2200 + i * 230, 'labor', 'billable', 2);
  end loop;

  -- permits
  insert into con_jurisdictions (company_id, name, state, department, address, phone, email, portal_url, submittal_method, typical_turnaround_days, fee_notes,
    requires_building_with_electrical, requires_mechanical_with_electrical, cheat_sheet) values
    (c, 'Maple County', 'VA', 'Building & Development', '1 Courthouse Sq, Maple Hill, VA', '(555) 040-4000', 'permits@maplecounty.example', 'https://example.com/maple-permits', 'Online portal', '10-15', 'Electrical $150 + $5/circuit', 'no', 'no', 'Upload stamped one-line + load calc. Inspections: call by 3 PM for next day.'),
    (c, 'City of Riverton', 'VA', 'Permits & Inspections', '200 Main St, Riverton, VA', '(555) 040-4100', 'permits@riverton.example', null, 'Email PDF', '5-7', 'Flat $95', 'yes', 'no', 'Building permit required with any dispenser work.'),
    (c, 'Oak Grove County', 'VA', 'Code Compliance', '55 Government Ctr, Oak Grove, VA', '(555) 040-4200', 'codes@oakgrove.example', null, 'In person', '15-20', 'Varies by valuation', 'unknown', 'unknown', null),
    (c, 'Lakeside Town', 'VA', 'Zoning & Permits', '9 Lake Rd, Lakeside, VA', '(555) 040-4300', 'zoning@lakeside.example', null, 'Online portal', '7-10', '$125 electrical', 'no', 'no', null);

  for i in 1..6 loop
    k := (array[7, 13, 9, 6, 11, 2])[i];
    insert into con_permit_sites (id, company_id, site_number, brand, name, address, city, state, zip, jurisdiction_id, owner_name, store_phone)
    values (gen_random_uuid(), c, site_nums[k], site_brand[k], site_brand[k] || ' #' || site_nums[k], site_addr[k], site_city[k], 'VA', '220' || (10 + k),
      (select id from con_jurisdictions where name = (array['Maple County','City of Riverton','Oak Grove County','Lakeside Town'])[1 + (i % 4)]),
      (select name from con_customers where id = site_cust[k]), '(555) 050-' || (5000 + k))
    returning id into v_id;
    insert into con_permit_projects (id, company_id, site_id, project_type, request_type, scope, dispenser_count, grades, scheduled_work_date, ready_to_work, job_id)
    values (gen_random_uuid(), c, v_id, (array['Dispenser Replacement','STP Circuit Repair','Product Line / UDC Replacement','Dispenser Replacement','Tank Replacement','MUL Conversion'])[i],
      case when i in (5) then 'PE Stamped' else 'Non-PE Stamped' end, (select scope_of_work from con_jobs where site_id = site_ids[k] limit 1),
      case when i in (1, 4) then 6 + i end, '87 / 89 / 93 / DSL', d0 + 10 + i * 5, i in (4, 6),
      (select id from con_jobs where site_id = site_ids[k] order by created_at limit 1))
    returning id into v_id;
    insert into con_permits (company_id, project_id, permit_type, pulled_by, requirement_status, status, date_submitted_to_jurisdiction, permit_number, fee, date_issued, inspection_date, notes) values
      (c, v_id, 'Electrical', 'RPS', 'Required', (array['In Progress','Permit In-Hand','Not Started','Inspection Scheduled','In Progress','Complete'])[i],
        case when i <> 3 then d0 - 12 + i end, case when i in (2,4,6) then 'E-26-' || (1400 + i) end, 150 + i * 10,
        case when i in (2,4,6) then d0 - 4 + i end, case when i in (4,6) then d0 + i end, null),
      (c, v_id, 'Building', 'Engineering Firm', case when i in (2,5) then 'Required' else 'Not Required' end,
        case when i in (2,5) then 'Submitted to Hash' else 'Complete' end, null, null, null, null, null, null);
  end loop;

  -- 7. inventory ---------------------------------------------------------------
  create temp table _parts (pn text, mfr text, descr text, cat int, catname text, uom text, cost numeric, stocked boolean) on commit drop;
  insert into _parts values
    ('1-2100','OPW','Spill container, 5 gal, single wall',3,'Spill / Overfill','EA',412.00,true),
    ('1-3115','OPW','Spill container, 15 gal, double wall',3,'Spill / Overfill','EA',1185.00,true),
    ('61SO','OPW','Overfill prevention valve',3,'Spill / Overfill','EA',688.00,true),
    ('1DK-2100','OPW','Vapor spill container',3,'Spill / Overfill','EA',530.00,true),
    ('11B-0100','OPW','Unleaded nozzle, 3/4"',2,'Dispenser Parts','EA',96.50,true),
    ('11BP-0400','OPW','Diesel nozzle, 1"',2,'Dispenser Parts','EA',132.00,true),
    ('66CAS','OPW','Breakaway, reconnectable',2,'Dispenser Parts','EA',58.75,true),
    ('H-8FT','Continental','Hose, 3/4" x 8 ft',2,'Dispenser Parts','EA',41.20,true),
    ('10-SHEAR','OPW','Emergency shear valve, 1-1/2"',2,'Dispenser Parts','EA',214.00,true),
    ('FFS-TSP','Franklin Fueling','TSP-ULS sump sensor',5,'Tank Monitoring','EA',268.00,true),
    ('FFS-MAG','Franklin Fueling','Mag probe, 10 ft',5,'Tank Monitoring','EA',1340.00,false),
    ('TS-550','Franklin Fueling','ATG console (EVO 550)',5,'Tank Monitoring','EA',4890.00,false),
    ('STP-15','Red Jacket','Submersible pump 1.5 HP',4,'Pumps / STP','EA',1720.00,false),
    ('FX1V','Red Jacket','Mechanical leak detector',4,'Pumps / STP','EA',305.00,true),
    ('RLY-30A','Square D','Pump relay, 30A',6,'Electrical','EA',62.40,true),
    ('THHN-12','Southwire','THHN 12 AWG (500 ft)',6,'Electrical','RL',96.00,true),
    ('SEAL-EYS','Crouse-Hinds','EYS seal fitting, 3/4"',6,'Electrical','EA',18.90,true),
    ('FLT-10','Cim-Tek','Dispenser filter, 10 micron',2,'Dispenser Parts','EA',11.40,true),
    ('FLT-30W','Cim-Tek','Water-absorbing filter, 30 micron',2,'Dispenser Parts','EA',14.80,true),
    ('BOOT-2','Bravo','Entry boot, 2" pipe',7,'Sumps & Containment','EA',74.00,true),
    ('BOOT-15','Bravo','Entry boot, 1-1/2" pipe',7,'Sumps & Containment','EA',68.00,true),
    ('UDC-36','Bravo','Under-dispenser containment sump',7,'Sumps & Containment','EA',1265.00,false),
    ('FLEX-2','OmegaFlex','Flexible connector, 2" x 18"',7,'Sumps & Containment','EA',189.00,true),
    ('CONC-4K','Ready-Mix','Concrete 4000 PSI',9,'Concrete','YD',210.00,false),
    ('BOLL-6','Generic','Bollard, 6" steel, 6 ft',9,'Site Work','EA',148.00,true),
    ('ABS-PAD','Generic','Absorbent pads (100 ct)',10,'Disposables','BX',39.00,true),
    ('TEF-TAPE','Generic','Fuel-rated thread sealant',10,'Disposables','EA',12.30,true),
    ('GLV-NIT','Generic','Nitrile gloves (box)',10,'Disposables','BX',14.00,true);

  for r in select * from _parts loop
    v_id := gen_random_uuid(); part_ids := part_ids || v_id;
    insert into parts (id, company_id, sku, part_number, manufacturer, description, category, category_name, uom, item_type, taxable, is_stocked, unit_cost, last_cost, avg_cost,
      markup_pct, sell_price, min_qty, max_qty, primary_vendor, price_status, cost_source, cost_date, active, quick_pick)
    values (v_id, c, 'SUM-' || r.pn, r.pn, r.mfr, r.descr, r.cat, r.catname, r.uom, 'material', true, r.stocked, r.cost, r.cost, r.cost,
      25, round(r.cost * 1.25, 2), case when r.stocked then 2 end, case when r.stocked then 12 end, 'Atlantic Fuel Parts Supply',
      case when r.pn in ('TS-550','UDC-36') then 'verify' else 'ok' end, 'vendor quote', d0 - (10 + (random()*120)::int), true, r.stocked and r.cat = 2);
    insert into part_price_history (part_id, kind, price, vendor, reference, observed_on)
    values (v_id, 'cost_receipt', round(r.cost * 0.94, 2), 'Atlantic Fuel Parts Supply', 'INV 55' || (100 + array_length(part_ids, 1)), d0 - 200),
           (v_id, 'cost_vendor_quote', r.cost, 'Atlantic Fuel Parts Supply', 'Quote Q-2210', d0 - 30);
  end loop;

  loc_main := gen_random_uuid();
  insert into stock_locations (id, company_id, name, kind, department, active) values
    (loc_main, c, 'Main Warehouse', 'office', 'shared', true),
    (gen_random_uuid(), c, 'Construction Yard', 'office', 'construction', true),
    (gen_random_uuid(), c, 'Vendor RMA', 'vendor_rma', 'shared', true);
  for i in 1..array_length(techs, 1) loop
    insert into stock_locations (id, company_id, name, kind, department, technician_id, asset_id, active)
    values (gen_random_uuid(), c, 'Truck — ' || tech_names[i], 'truck', 'service', techs[i],
      (select id from assets where unit_number = (array['S-101','S-102','S-103','S-104'])[i]), true);
  end loop;
  select array_agg(id) into loc_ids from stock_locations where kind in ('office','truck');

  for i in 1..array_length(part_ids, 1) loop
    if (select is_stocked from parts where id = part_ids[i]) then
      insert into stock_levels (location_id, part_id, min_qty, max_qty, bin) values (loc_main, part_ids[i], 2, 12, 'A-' || lpad(i::text, 2, '0'));
      insert into inventory_transactions (company_id, txn_type, part_id, location_id, qty, unit_cost, ref_label, note, created_by, created_at)
      values (c, 'receive', part_ids[i], loc_main, 6 + (random()*14)::int, (select unit_cost from parts where id = part_ids[i]), 'PO 4410' || (i % 7), 'Stock order', sam, now() - ((20 + i) || ' days')::interval);
      if i % 2 = 0 then
        k := 2 + (i % (array_length(loc_ids, 1) - 1));
        v_ids := array[gen_random_uuid()];
        insert into inventory_transactions (company_id, txn_type, part_id, location_id, qty, unit_cost, transfer_group, note, created_by, created_at) values
          (c, 'transfer_out', part_ids[i], loc_main, -2, (select unit_cost from parts where id = part_ids[i]), v_ids[1], 'Restock truck', sam, now() - ((10 + i) || ' days')::interval),
          (c, 'transfer_in',  part_ids[i], loc_ids[k], 2, (select unit_cost from parts where id = part_ids[i]), v_ids[1], 'Restock truck', sam, now() - ((10 + i) || ' days')::interval);
        insert into stock_levels (location_id, part_id, min_qty, max_qty) values (loc_ids[k], part_ids[i], 1, 4) on conflict do nothing;
      end if;
      if i % 3 = 0 then
        insert into inventory_transactions (company_id, txn_type, part_id, location_id, qty, unit_cost, ref_label, note, created_by, created_at)
        values (c, 'issue_to_ticket', part_ids[i], loc_main, -1 - (i % 3), (select unit_cost from parts where id = part_ids[i]),
          'WO-' || (880000 + i * 37), 'Used on service call', jordan, now() - ((2 + i % 9) || ' days')::interval);
      end if;
    end if;
  end loop;

  -- 8. HR / DQF ----------------------------------------------------------------
  insert into hr_compliance_settings (company_id, emails_enabled, dqf_notice_days, cert_notice_days, overdue_repeat_days, notify_employee, management_emails, weekly_digest, digest_weekday)
  values (c, false, array[60, 30, 7], array[60, 30], 7, false, array['ops@demo.rpintelligence.app'], false, 1);

  insert into hr_requirement_types (company_id, name, category, kind, issuer, applies_to, expires, renewal_months, regulation, sort_order, is_active, notify) values
    (c, 'Driver''s Application for Employment', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.21', 10, true, true),
    (c, 'Request for Check of Driving Record (pre-hire MVR)', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.23(a)(1)', 20, true, true),
    (c, 'Safety Performance History (prior employers)', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.23(a)(2)', 30, true, true),
    (c, 'Record of Road Test', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.31 / 391.33', 40, true, true),
    (c, 'Medical Examiner''s Certificate - DOT Card', 'dqf', null, 'FMCSA', 'dot', true, 24, '49 CFR 391.41 / 391.43', 50, true, true),
    (c, 'Medical Examiner National Registry Verification', 'dqf', null, 'FMCSA', 'dot', false, null, '49 CFR 391.51(b)(9)', 60, true, true),
    (c, 'Annual MVR', 'dqf', null, 'State DMV', 'dot', true, 12, '49 CFR 391.25(a)', 70, true, true),
    (c, 'Annual Review of Driving Record', 'dqf', null, 'FMCSA', 'dot', true, 12, '49 CFR 391.25(b)', 80, true, true),
    (c, 'Driver License', 'dqf', null, 'State DMV', 'optional', true, null, '49 CFR 391.11', 240, true, true),
    (c, 'Drug and Alcohol Policy Acknowledgement Form', 'dqf', null, 'Company', 'optional', false, null, 'Company policy', 360, true, true),
    (c, 'OSHA 10', 'certification', 'safety', 'OSHA', 'optional', false, null, null, 205, true, false),
    (c, 'CPR & First Aid', 'certification', 'safety', 'Red Cross / AHA', 'optional', true, 24, null, 210, true, false),
    (c, 'Confined Space Training', 'certification', 'safety', null, 'optional', true, 24, null, 215, true, false),
    (c, 'Hot Work Training', 'certification', 'safety', null, 'optional', true, 24, null, 217, true, false),
    (c, 'OPW Certification', 'certification', 'manufacturer', 'OPW', 'optional', true, null, null, 230, true, false),
    (c, 'FFS Pro Certification', 'certification', 'manufacturer', 'Franklin Fueling', 'optional', true, null, null, 237, true, false),
    (c, 'Mini Excavator Certification', 'certification', 'equipment', null, 'optional', true, 36, null, 270, true, false),
    (c, 'Resume', 'personnel', null, null, 'all', false, null, null, 300, true, false),
    (c, 'W-4', 'personnel', null, null, 'all', false, null, null, 302, true, false),
    (c, 'Policies and Procedures Acknowledgement', 'personnel', null, null, 'all', false, null, null, 306, true, false);

  insert into hr_employees (company_id, full_name, email, phone, department, job_title, hire_date, is_dot_driver, is_cdl, license_state, license_class, is_active, notify_employee, profile_id)
  select c, p.full_name, p.email, p.phone, s.dept, s.title, d0 - (200 + (abs(hashtext(p.full_name)) % 2500)),
    s.role in ('service_tech','construction_tech','mechanic','construction_manager','manager'),
    s.role = 'construction_tech', 'VA', case when s.role = 'construction_tech' then 'A' else 'D' end, true, false, p.id
  from profiles p join _staff s on p.email = s.key || '@demo.rpintelligence.app';

  for r in select e.id eid, e.is_dot_driver, t.id tid, t.category, t.expires, t.renewal_months, t.applies_to, (row_number() over ())::int n
             from hr_employees e cross join hr_requirement_types t loop
    continue when r.applies_to = 'dot' and not r.is_dot_driver;
    continue when r.category = 'certification' and (r.n % 3) <> 0;
    k := (r.n * 7) % 10;
    insert into hr_employee_items (company_id, employee_id, type_id, status, issued_date, expiration_date, cert_number, verified_by, verified_at)
    values (c, r.eid, r.tid,
      case when k = 0 then 'missing' when k = 1 then 'in_progress' else 'on_file' end,
      case when k > 1 then d0 - (30 + (r.n * 13) % 600) end,
      case when k > 1 and r.expires then
        case when k = 2 then d0 - 12 when k = 3 then d0 + 18 when k = 4 then d0 + 45 else d0 + 90 + (r.n * 11) % 500 end end,
      case when r.category = 'certification' and k > 1 then 'C-' || (10000 + r.n) end,
      case when k > 1 then taylor end, case when k > 1 then now() - ((r.n % 60) || ' days')::interval end);
  end loop;

  -- 9. expenses ----------------------------------------------------------------
  insert into payment_methods (company_id, code, name, is_active) values
    (c, 'CC1', 'Company Visa ••4417', true), (c, 'FLEET', 'Fleet Fuel Card', true), (c, 'ACCT', 'Vendor Account (net 30)', true), (c, 'CASH', 'Cash / Reimburse', true);
  insert into expense_categories (company_id, name, context, sort_order, is_active)
  select c, x.name, x.ctx, x.n, true from (values
    ('Brakes','asset',1),('Wheels & Tires','asset',2),('Engine / Oil','asset',3),('Electrical','asset',4),('Truck Supplies','asset',5),('Truck Fluids','asset',6),('Misc','asset',9),
    ('Hard Piping','store',1),('Electrical','store',2),('Materials','store',3),('Hardware','store',4),('Equipment Rental','store',5),('Misc','store',9),
    ('Materials','project',1),('Hardware','project',2),('Equipment Rental','project',3),('Safety Equipment','project',4),('Misc','project',9),
    ('Office Supplies','general',1),('Meals','general',2),('Misc','general',9)) as x(name, ctx, n);
  insert into expense_cards (company_id, last4, brand, payment_method_code, holder_profile_id, holder_label, source, seen_count, is_active) values
    (c, '4417', 'Visa', 'CC1', demo, 'Alex Morgan', 'manual', 22, true),
    (c, '8820', 'Visa', 'CC1', blake, 'Blake Harper', 'learned', 14, true),
    (c, '3051', 'Fleet', 'FLEET', cody, 'Cody Novak', 'learned', 31, true);

  for i in 1..36 loop
    insert into expenses (company_id, submitted_by, expense_date, amount, description, vendor, expense_type, asset_id, store_number, category_id, payment_method_code, card_last4,
      is_approved, approved_by, approved_at, submitter_name, created_at)
    select c, p.id, d0 - (i * 2 % 40), round((12 + random() * 480)::numeric, 2),
      (array['Hydraulic fluid + filters','Concrete mix & rebar','Fuel','Pipe fittings','Rental — plate compactor','Shop rags & absorbent','Wiper blades','Electrical fittings'])[1 + i % 8],
      (array['Valley Truck Parts','Home Center #214','Quick Fuel Stop','Atlantic Fuel Parts Supply','Tri-State Equipment Rental','Shop Supply Co.','Auto Parts Plus','Bluegrass Electrical Supply'])[1 + i % 8],
      case when i % 8 in (0,2,5,6) then 'asset' else 'store' end,
      case when i % 8 in (0,2,5,6) then asset_ids[1 + i % 10] end,
      case when i % 8 not in (0,2,5,6) then site_nums[1 + i % 15] end,
      (select id from expense_categories where context = case when i % 8 in (0,2,5,6) then 'asset' else 'store' end order by sort_order offset (i % 4) limit 1),
      (array['CC1','FLEET','CC1','ACCT'])[1 + i % 4], (array['4417','3051','8820',null])[1 + i % 4],
      i > 6, case when i > 6 then demo end, case when i > 6 then now() - ((i % 20) || ' days')::interval end, p.full_name, now() - ((i * 2 % 40) || ' days')::interval
    from profiles p where p.id = (array[blake, cody, demo, quinn, reese, pat])[1 + i % 6];
  end loop;

  -- 10. notifications + daily summary -----------------------------------------
  insert into notifications (company_id, recipient_id, type, title, message, link, is_read, related_asset_id, created_at) values
    (c, demo, 'asset_unsafe', 'C-204 marked UNSAFE', 'Steering box play found — truck tagged out of service.', '/assets', false, (select id from assets where unit_number = 'C-204'), now() - interval '4 days'),
    (c, demo, 'maintenance_overdue', 'Oil change overdue — S-102', 'S-102 is 640 miles past its oil change.', '/maintenance/oil-changes', false, (select id from assets where unit_number = 'S-102'), now() - interval '1 day'),
    (c, demo, 'permit', 'Permit issued — #1126', 'Electrical permit E-26-1404 is in hand.', '/construction/permits', false, null, now() - interval '6 hours'),
    (c, demo, 'time', '3 time cards need approval', 'Riley, Reese and Jamie submitted last week.', '/time/approvals', true, null, now() - interval '2 days');

  insert into daily_summaries (company_id, period_start, period_end, content, email_sent_to, created_via, created_at)
  values (c, now() - interval '1 day', now(),
    E'Daily summary\n\n• 8 service calls dispatched, 5 completed, 2 need a return trip.\n• Construction: 2 jobs in progress (#1204 dispensers, VTP-9 island repair), 2 scheduled this week.\n• Shop: S-104 brakes in progress, E-502 hydraulic leak in progress, C-204 tagged unsafe.\n• 1 DQF item expired (medical card), 2 expiring within 30 days.\n• 2 invoices sent, 1 overdue.',
    null, 'cron', now() - interval '2 hours');

  return 'demo data reset at ' || now();
end;
$$;

revoke all on function public.demo_reseed() from public, anon, authenticated;
grant execute on function public.demo_reseed() to service_role;
