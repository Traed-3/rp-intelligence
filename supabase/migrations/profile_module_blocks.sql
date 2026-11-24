-- APPLIED to project zktmhxheouwbyupeizjq on 2026-09-25.
-- Per-user module access (Settings → Users). Empty by default — a row here
-- means this one person is blocked from this one module, overriding whatever
-- their role would otherwise allow. See lib/modules.ts for the module list.
CREATE TABLE profile_module_blocks (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module     text NOT NULL CHECK (module IN (
    'maintenance','shop','tickets','construction','service_dispatch','billing','inventory','reports_payroll'
  )),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (profile_id, module)
);

-- Same posture as `profiles` itself: RLS on, zero policies, every read/write
-- goes through the service-role admin client (Settings → Users actions,
-- proxy.ts). No policies needed since nothing queries this with the anon key.
ALTER TABLE profile_module_blocks ENABLE ROW LEVEL SECURITY;
