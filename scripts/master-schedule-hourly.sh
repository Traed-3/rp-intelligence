#!/bin/bash
# Snapshot (7:05 / 12:05 / 17:05) of Starsky's Master Schedule (the workbook is rewritten daily, so anything not captured is lost):
#   1. sync-master-schedule-log.py  — every Job List row + its W/O / authorizer, kept forever
#   2. sync-master-schedule-jobs.py — the app's construction jobs follow the master: new W/Os become jobs, stages move
#                                     when Starsky changes a row, Completed Jobs rows close the job (one way; never writes the workbook)
#   3. import-master-schedule.py    — who goes where each day (con_schedule_entries; replaces today and later only,
#                                     so past days keep their record). Runs after step 2 so new jobs get their day plan.
# Run by the Claude desktop scheduled task "rps-master-schedule-snapshot" (the app can read Dropbox; launchd can't).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HOME/Library/CloudStorage/Dropbox-RP/Construction Department/1-Master Schedule/1 - Schedule/1 - Master schedule .xlsm"
PY=/usr/bin/python3
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "=== $(date '+%Y-%m-%d %H:%M:%S') ==="
# A checkout made only to run this (it has a .autoupdate file) follows origin/main, so merged fixes reach the snapshot.
if [ -f "$REPO/.autoupdate" ]; then
  git -C "$REPO" fetch -q origin main 2>/dev/null && git -C "$REPO" checkout -q --detach origin/main 2>/dev/null \
    && echo "scripts at $(git -C "$REPO" log -1 --format='%h %s' | cut -c1-70)" || echo "(could not update scripts; running the copy on disk)"
fi
if [ ! -f "$SRC" ]; then echo "Master schedule not found: $SRC"; exit 1; fi
# Read a copy — Excel/Dropbox may be writing the original.
cp "$SRC" "$WORK/ms.xlsm" || { echo "Could not copy the workbook (Dropbox still syncing?)"; exit 1; }

"$PY" "$REPO/scripts/sync-master-schedule-log.py" "$WORK/ms.xlsm" --apply || echo "!! schedule log sync failed"
if "$PY" "$REPO/scripts/sync-master-schedule-jobs.py" "$WORK/ms.xlsm" --apply > "$WORK/jobs.txt" 2>&1; then head -40 "$WORK/jobs.txt"
else head -40 "$WORK/jobs.txt"; echo "!! job sync failed"; fi
"$PY" "$REPO/scripts/import-master-schedule.py" "$WORK/ms.xlsm" --apply | tail -3 || echo "!! day-plan import failed"
