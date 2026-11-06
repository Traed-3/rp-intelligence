#!/usr/bin/env python3
"""
Keep a running history of the Master Schedule's Job List rows in con_master_schedule_log.

  python3 scripts/sync-master-schedule-log.py "<path to .xlsm>" [--apply]

Starsky rewrites the Job List every day, so the W/O column (a WO# like "WOT0061857-WOT0059119", or the name of
whoever authorized the work, like "John M") is lost once a row is cleared. This upserts every job row it sees —
one log row per site + W/O + scope — bumping last_seen_at, and marks rows that have left the sheet on_sheet=false.
It never deletes, so the authorization stays on record for the ticket sync (lib/job-email-feed.ts).

Run three times a day by scripts/master-schedule-hourly.sh. Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
from .env.local next to the repo root.
"""
import sys, re, json, hashlib, datetime, importlib.util
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit('pip3 install --user openpyxl')

# Same site_key / env / rest helpers as the day-plan import, so both agree on site numbers.
_spec = importlib.util.spec_from_file_location('ms_import', Path(__file__).resolve().parent / 'import-master-schedule.py')
ms = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(ms)

TAB = 'Job List'
# Job List columns: A Date Received, B Site, C Stage, D W/O, E Response, F Start, G Address, H Scope, I Status, J Notes
COL = {'received': 1, 'site': 2, 'stage': 3, 'wo': 4, 'address': 7, 'scope': 8, 'status': 9, 'notes': 10}


def text(v):
    if v is None: return ''
    if isinstance(v, (datetime.date, datetime.datetime)): return v.date().isoformat() if isinstance(v, datetime.datetime) else v.isoformat()
    return re.sub(r'\s+', ' ', str(v)).strip()


def site_tokens(raw, key):
    """Everything a ticket subject might call this site: the key, plus bare numbers for 7-Eleven / Wawa style sites."""
    toks = {key}
    if not re.match(r'^(SU|IP|CP|CPG)\b|-CPG$', key, re.I):
        toks.update(re.findall(r'(?<!\d)\d{3,5}(?!\d)', re.sub(r'\([^)]*\)', ' ', raw)))
    return sorted(t for t in toks if t)


def read_rows(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)[TAB]
    out = {}
    for row in ws.iter_rows(min_row=6, max_col=10, values_only=True):
        site_raw = text(row[COL['site'] - 1])
        if not site_raw: continue                       # weekday bars and section headers have no site
        key = ms.site_key(site_raw)
        wo, scope = text(row[COL['wo'] - 1]), text(row[COL['scope'] - 1])
        fp = hashlib.sha1(f'{TAB}|{key.upper()}|{wo.upper()}|{scope.upper()}'.encode()).hexdigest()
        out[fp] = {
            'company_id': ms.COMPANY_ID, 'fingerprint': fp, 'tab': TAB, 'site_raw': site_raw, 'site_key': key,
            'site_tokens': site_tokens(site_raw, key), 'wo': wo or None, 'stage': text(row[COL['stage'] - 1]) or None,
            'status': text(row[COL['status'] - 1])[:2000] or None, 'notes': text(row[COL['notes'] - 1])[:2000] or None,
            'scope': scope[:2000] or None, 'facility_address': text(row[COL['address'] - 1]) or None,
            'date_received': text(row[COL['received'] - 1]) or None,
        }
    return list(out.values())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args: sys.exit(__doc__)
    rows = read_rows(args[0])
    print(f'{TAB}: {len(rows)} job rows, {sum(1 for r in rows if r["wo"])} with a W/O')
    if '--apply' not in sys.argv: print('Dry run. Add --apply to write.'); return
    e = ms.env(); url, key = e['NEXT_PUBLIC_SUPABASE_URL'], e['SUPABASE_SERVICE_ROLE_KEY']
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')  # no '+' — it'd become a space in the URL
    for i in range(0, len(rows), 200):
        # Upsert: new rows get first_seen_at from the column default; existing rows only move last_seen_at forward.
        batch = [r | {'last_seen_at': now, 'on_sheet': True} for r in rows[i:i + 200]]
        ms.rest(url, key, 'POST', 'con_master_schedule_log?on_conflict=fingerprint', batch,
                prefer='resolution=merge-duplicates,return=minimal')
    ms.rest(url, key, 'PATCH', f'con_master_schedule_log?company_id=eq.{ms.COMPANY_ID}&on_sheet=is.true&last_seen_at=lt.{now}',
            {'on_sheet': False}, prefer='return=minimal')
    print(f'Logged {len(rows)} rows at {now}.')


if __name__ == '__main__':
    main()
