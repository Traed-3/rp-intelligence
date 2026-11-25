# Public demo (demo.rpintelligence.app)

A sandbox prospects can click around in. It is fully separate from production:

| | Production | Demo |
|---|---|---|
| Vercel project | `rps-maintenance` (rpintelligence.app) | `rp-intelligence-demo` (demo.rpintelligence.app) |
| Supabase project | `rp-intelligence` (`zktmhxheouwbyupeizjq`) | `rp-intelligence-demo` (`mkgxfxnvubravxrqvhdi`) |
| Data | real | fictional only, wiped and reseeded nightly |
| Keys | real | demo database keys only. No Resend, Gmail, VAPID, Anthropic or CRON keys |

## How demo mode works

`NEXT_PUBLIC_DEMO_MODE=1` (set only on the demo Vercel project) turns on:

- the amber "Demo — sample data" banner (`components/demo-banner.tsx`)
- the one-click **Try the demo** sign-in (`app/login/demo-actions.ts`). It signs in as
  `demo@demo.rpintelligence.app` (owner) and first resets that login's password, active flag, role and
  module blocks, so one visitor can't lock out the next
- `lib/supabase/admin.ts` blocks account changes (create, delete, re-password) and storage uploads
- placeholders instead of real mailboxes, vendor contacts, customer names and personal emails

With the flag off, all of this is skipped and production behaves exactly as before.

## Data

- `demo_seed.sql` defines `public.demo_reseed()`. It truncates every public table and inserts the fictional
  company "Summit Petroleum Services (Demo)": 16 staff, 22 assets, 20 repair tickets, 44 service calls,
  26 construction jobs across every stage, permits, quotes, invoices, inventory, DQF items and expenses.
  Dates are relative to today.
- `demo_lockdown.sql` drops browser upload policies on storage and schedules the nightly reset with
  pg_cron (`demo-nightly-reset`, 08:00 UTC).
- The 16 logins in `auth.users` were created once and survive resets. The seed finds them by email.

**Only ever apply these files to the demo project.** `demo_reseed()` refuses to run unless the demo
login exists, but it still truncates the whole public schema.

## Updating the demo after new features ship

1. Apply any new production migrations to the demo project too (same SQL files in `supabase/migrations/`).
2. If a new table should have sample rows, add them to `demo_seed.sql`, re-apply it to the demo project,
   then run `select public.demo_reseed();`.
3. Deploy: from a checkout of `main` linked to the `rp-intelligence-demo` project, run `vercel deploy --prod`.
