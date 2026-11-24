# RPS Maintenance → RPS Intelligence — rename runbook

**Prepared 09/29/2026.** The product has been RPS Intelligence since June; the name RPS Maintenance still lives in code, slugs, folders and settings. This runbook lists every place, what breaks if it changes, and who changes it. Nothing here is destructive when done in the order shown.

## What is already done (PR from branch `rebrand/rps-intelligence`)

The June rebrand branch (new logo and icons, text rename) had never been merged and was 85 commits behind. It was cherry-picked onto today's main and finished:

| Where | Change |
|---|---|
| Sidebar, login, PWA manifest, share button, alerts settings, Ask RPS prompt | "RPS Maintenance" → "RPS Intelligence" |
| `app/icon.png`, `app/apple-icon.png`, `public/logo-full.png` | RPS Intelligence logo (main still had the June 5 RPS Maintenance logo) |
| `public/sw.js` | push notification title and header comment |
| `package.json`, `package-lock.json` | package name `rps-intelligence` (cosmetic, nothing imports it) |
| `.claude/launch.json` | preview config `rps-intelligence-dev` |
| `CLAUDE.md`, `supabase/schema.sql` | headers; the stale project-folder line now points at the real path |

Not changed on purpose: `next.config.ts`, routes, table names (`con_*`, `svc_*`), env var names, the eight `https://rps-maintenance.vercel.app` URLs in `.github/workflows/*.yml` and `lib/email.ts` (they must match the live domain, see below).

## What is left, by risk

| # | Place | Current | Risk if renamed | Action | Who |
|---|---|---|---|---|---|
| 1 | Vercel project name | `rps-maintenance` | Renaming changes the default domain to `rps-intelligence.vercel.app`; the cron URLs, `NEXT_PUBLIC_APP_URL`, phone PWA installs and any bookmarks point at the old one | Do it as one move: rename in Vercel → Settings → General; then add `rps-maintenance.vercel.app` back as a domain on the project (Vercel allows re-attaching a freed `*.vercel.app` name) so old links keep working; update `NEXT_PUBLIC_APP_URL`; update the eight workflow URLs in a small PR. Better still: put a real domain in front (for example `intelligence.rappahannockpetroleum.com`) and point everything at that once | Trae in Vercel, Claude for the PR |
| 2 | GitHub repo | `Traed-3/rps-maintenance` | GitHub redirects old clone and web URLs automatically; Vercel's Git link survives a rename; each Mac's remote should be updated | Rename in GitHub → Settings; then on both Macs `git remote set-url origin https://github.com/Traed-3/rps-intelligence.git` | Trae, then one command per Mac |
| 3 | Supabase project name | `rps-maintenance` (ref `zktmhxheouwbyupeizjq`) | None; the ref, URL and keys do not change | Dashboard → Project Settings → General → rename | Trae |
| 4 | Google OAuth consent screen app name | shows the old name on the login screen | None functional | Google Cloud Console → APIs & Services → OAuth consent screen → App name | Trae |
| 5 | Local folder `~/Documents/Claude/Claude Projects/RPS Maintenance & System Software/RPS Maintenance & Asset Project/rps-maintenance` | two "RPS Maintenance" parents | Anything holding an absolute path: the app's `.claude/launch.json` is relative (safe); `scripts/ingest/com.rps.docingest.plist` and `scheduled-run.sh` carry no absolute path (checked); memory notes mention the path (Claude will update them) | Rename `RPS Maintenance & System Software` → `RPS Intelligence` and drop the `RPS Maintenance & Asset Project` level so the clone sits at `Claude Projects/RPS Intelligence/rps-maintenance`; leave a symlink at each old path (same trick as the July iCloud migration) so nothing breaks; the repo folder keeps the GitHub name | Trae or Claude, after 2 |
| 6 | Siblings in that folder | `RPS Maintenance - Marketing`, `RPS_Maintenance_Brand_Kit`, two `_ARCHIVE_rps-maintenance-*` clones, `rps-intelligence-rebrand-BACKUP-20260720.bundle` | None | Brand kit and marketing folders: rename or leave. The two `_ARCHIVE_` clones and the bundle are safe to delete once this PR is merged (the bundle was the backup of this very branch) | Trae |
| 7 | iCloud `RP - Rappahannock Petroleum/RPS Maintenance & Asset Project/` and `RP - Rappahannock Petroleum/rps-maintenance/` | stale duplicate clone from May with a `.env.local` inside | None to the live app; a secrets file is sitting in iCloud | Move both into an `_ARCHIVE` folder or delete after confirming nothing in them is unique (both predate the July migration) | Trae confirms, Claude does it |
| 8 | iCloud `RPS - Intelligence/` | exists, holds the Permits plan and tracker | None | Use it as the home for all product docs (this runbook and the intake plan are copied there) | done |
| 9 | Chrome profile "RPS Maintenance for claude" | name only | None | Leave, or rename in Chrome | Trae |
| 10 | Claude memory and skills | notes say RPS Maintenance in places | None | Updated with this session's memory; skills index gained the intake skill | done |
| 11 | Resend from-name | not set yet | None | Set `RESEND_FROM_EMAIL="RPS Intelligence <alerts@…>"` when the key goes in | Trae |

## Recommended order

1. Merge the rebrand PR (code and logo). Check the sidebar, login page and phone icon.
2. Supabase and Google names (items 3–4), five minutes, nothing can break.
3. Decide the domain (item 1). If you want a custom domain, buy or point it first, then rename the Vercel project and update the URLs in one PR.
4. GitHub rename (item 2) and the one-line remote update on both Macs.
5. Folder cleanup (items 5–7) on a quiet day, with symlinks left behind.

## What "breaking" would look like, so you can check

- Crons stop: GitHub → Actions → Gmail sync shows red. Cause: item 1 done without updating the workflow URLs.
- Login loop or "redirect_uri mismatch": the Supabase auth callback is unchanged by any of this; if it appears, the Google OAuth client was edited, not the rename.
- Phone app opens the old URL: reinstall the home-screen app after item 1.
- Claude Code "cannot find folder": a session was opened at the old local path after item 5 without the symlink.
