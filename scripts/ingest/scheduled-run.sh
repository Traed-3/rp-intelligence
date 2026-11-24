#!/bin/bash
# rps-doc-ingest scheduled runner (LaunchAgent: com.rps.docingest)
# Imports one bounded batch of Dropbox construction docs into the app on each
# firing, then exits. launchd re-fires on StartInterval. Idempotent/resumable:
# the importer skips anything already filed (source_path in con_documents), so
# runs pick up where the last one stopped and auto-grab newly-downloaded files.
#
# Self-stopping: after 3 consecutive runs that upload 0 files (import drained),
# it unloads its own LaunchAgent so it stops firing. Re-enable by running:
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rps.docingest.plist
set -u

REPO="$HOME/Developer/rps-maintenance"
STATE="$HOME/Library/Application Support/RPS Construction Ingest"
LOG="$STATE/ingest.log"
LOCK="$STATE/run.lock"
STREAK="$STATE/empty-streak"
LABEL="com.rps.docingest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="/opt/homebrew/bin/node"
BATCH=2000         # max uploads per firing (runs survive now that stalls time out)
EMPTY_LIMIT=3      # stop after this many consecutive 0-upload runs

mkdir -p "$STATE"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

# Prevent overlapping runs (a slow batch outliving its interval).
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(ts) [skip] previous run still holding lock" >> "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

cd "$REPO" || { echo "$(ts) [error] repo not found: $REPO" >> "$LOG"; exit 1; }

echo "$(ts) [start] batch up to $BATCH uploads" >> "$LOG"
OUT="$("$NODE" --env-file=.env.local scripts/ingest/ingest.mjs --commit --max-uploads "$BATCH" 2>&1)"
CODE=$?

# Pull the "UPLOADED + FILED:   N   (errors: M)" summary line.
SUMMARY="$(printf '%s\n' "$OUT" | grep -E 'UPLOADED \+ FILED:' | tail -1)"
UP="$(printf '%s\n' "$SUMMARY" | grep -oE '[0-9]+' | head -1)"
[ -z "${UP:-}" ] && UP=-1

echo "$(ts) [done] exit=$CODE ${SUMMARY:-'(no summary — likely interrupted)'}" >> "$LOG"

# Track consecutive empty (0-upload) runs so we can self-terminate when drained.
# A negative UP (no summary / crash) does NOT count as empty — keep trying.
PREV=0; [ -f "$STREAK" ] && PREV="$(cat "$STREAK" 2>/dev/null || echo 0)"
if [ "$UP" = "0" ]; then
  NEW=$((PREV + 1))
  echo "$NEW" > "$STREAK"
  echo "$(ts) [drain] empty run $NEW/$EMPTY_LIMIT" >> "$LOG"
  if [ "$NEW" -ge "$EMPTY_LIMIT" ]; then
    echo "$(ts) [stop] import drained — unloading $LABEL. Re-enable with: launchctl bootstrap gui/$(id -u) $PLIST" >> "$LOG"
    rmdir "$LOCK" 2>/dev/null
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    exit 0
  fi
elif [ "$UP" -gt 0 ] 2>/dev/null; then
  echo 0 > "$STREAK"
fi
exit 0
