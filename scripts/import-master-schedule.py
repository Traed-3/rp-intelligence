#!/usr/bin/env python3
"""
Import this week's plan from the Job List sheet of "1 - Master schedule.xlsm" into con_schedule_entries.

  python3 scripts/import-master-schedule.py "<path to .xlsm>" [--week 2026-09-28] [--apply]

The Job List is a manual list: yellow rows that say Mon / Tues / Wed / Thur / Fri split the sheet, and every
job row under a weekday line (until the next yellow or red line) is planned for that day of the current week.
Blue rows are In-Progress; the technicians' initials follow "In-Progress" (e.g. "In-Progress EL-CLS-TW 1" =
crew EL, CLS, TW, first stop of the day).

Rows land with source = 'master_schedule'. A re-import deletes that week's master_schedule rows first, so the
sheet stays the source of truth and hand-entered rows in the app are never touched.
Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local next to the repo root.
"""
import sys, re, os, json, datetime, urllib.request, urllib.error
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit('pip3 install --user openpyxl')

COMPANY_ID = 'f3d06874-2e21-40f3-a7d0-a1d86bad02e7'
DAY = {'mon': 0, 'monday': 0, 'tue': 1, 'tues': 1, 'tuesday': 1, 'wed': 2, 'weds': 2, 'wednesday': 2, 'thu': 3, 'thur': 3, 'thurs': 3, 'thursday': 3, 'fri': 4, 'friday': 4, 'sat': 5, 'saturday': 5, 'sun': 6, 'sunday': 6}
YELLOW, RED = 'FFFF00', 'FF0000'

def env():
    e = {}
    for line in (Path(__file__).resolve().parent.parent / '.env.local').read_text().splitlines():
        m = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line)
        if m: e[m.group(1)] = m.group(2).strip('"')
    return e

def fill_rgb(cell):
    f = cell.fill
    if not f or f.fill_type is None: return None
    c = f.fgColor
    return c.rgb[-6:].upper() if c is not None and c.type == 'rgb' and isinstance(c.rgb, str) else None

def site_key(raw):
    """'SU-10810 (80008546)' -> SU-10810; '4640 / 45985 ' -> '4640/45985'; 'Wawa 662' stays."""
    s = re.sub(r'\s*\([^)]*\)\s*', ' ', str(raw)).strip()
    s = re.sub(r'\s*/\s*', '/', s)
    m = re.match(r'^(SU|IP|CP|CPG)\s*-?\s*(\d{3,5})$', s, re.I)
    if m: return f'{m.group(1).upper()}-{m.group(2)}' if m.group(1).upper() != 'IP' else f'IP{m.group(2)}'
    return s

def parse_stage(text):
    """'In-Progress EL-CLS-TW 1' -> ('In-Progress', ['EL','CLS','TW'], 1); 'Scheduled Fri 10/2/26 DSL treat' -> ('Scheduled', [], None)."""
    t = (text or '').strip()
    m = re.match(r'^(In-Progress|Scheduled|Needs Scheduled|Rescheduled|Reschedule|Waiting on [^:]+?|Quote[^:]*?|Check and load material[^:]*?)\b\s*(.*)$', t, re.I)
    head, rest = (m.group(1), m.group(2)) if m else (t, '')
    crew, seq = crew_from(rest)
    if crew:
        rest = re.sub(r'\s*-?\s*\b' + '-'.join(crew) + r'\b\s*\d{0,2}', ' ', rest).strip(' -')
    return head, crew, seq, rest

def next_weekday(after, wd, inclusive):
    """First date >= (or >) `after` that falls on weekday index wd."""
    d = after if inclusive else after + datetime.timedelta(days=1)
    return d + datetime.timedelta(days=(wd - d.weekday()) % 7)

STOP = {'VR', 'DSL', 'RUL', 'PUL', 'TLS', 'LVD', 'STP', 'UDC', 'ATG', 'PLLD', 'CSLD', 'VA', 'MD', 'WV', 'DC', 'FP', 'EZ', 'AST', 'UST', 'PVC', 'NOV', 'CNI', 'MAPS', 'PE', 'SB', 'DW', 'RJ', 'PF', 'GC', 'AM', 'PM', 'ICON', 'OWL', 'JM', 'SAD', 'SEI', 'HH', 'MG', 'FWKD', 'WOT', 'DH', 'SD', 'TD'}
def crew_from(text):
    """Technician initials in the stage text: 'TJD-RM', 'CLS-MNB-GB-DL', 'EL-JF-TW-TB-BC', 'EL-CLS-TW 1', '... - GB'."""
    for m in re.finditer(r'\b([A-Z]{1,3}(?:-[A-Z]{1,3})+)\b\s*(\d{1,2})?', text):
        parts = m.group(1).split('-')
        if all(p not in STOP for p in parts): return parts, (int(m.group(2)) if m.group(2) else None)
    m = re.search(r'(?:^|-\s+|\s)([A-Z]{2,3})\s*(\d{1,2})?\s*$', text)
    if m and m.group(1) not in STOP: return [m.group(1)], (int(m.group(2)) if m.group(2) else None)
    m = re.match(r'^([A-Z]{2,3})\s+(\d{1,2})\b', text)
    if m and m.group(1) not in STOP: return [m.group(1)], int(m.group(2))
    return [], None

def read_plan(path, week=None):
    ws = openpyxl.load_workbook(path, data_only=True)['Job List']
    today = datetime.date.fromisoformat(week) if week else datetime.date.today()
    monday = today - datetime.timedelta(days=today.weekday())
    day, order, out, last = None, 0, [], None
    for r in range(6, ws.max_row + 1):
        b, c = ws.cell(r, 2), ws.cell(r, 3)
        bval, cval = (b.value or ''), (c.value or '')
        label = str(cval or bval).strip()
        wd = re.match(r'^(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b\.?\s*(.*)$', label, re.I)
        if fill_rgb(c) == YELLOW and wd and not str(bval).strip():
            # the list starts at today and runs forward; a weekday that comes "before" the last one is next week
            idx = DAY[wd.group(1).lower()]
            day = next_weekday(today, idx, True) if last is None else next_weekday(last, idx, False)
            last, order = day, 0
            continue
        if fill_rgb(c) == RED or (fill_rgb(c) == YELLOW and not wd and not str(bval).strip()):
            day = None                                   # "Urgent" and other section bars end the weekly block
            continue
        if fill_rgb(c) == '04FAE1' and not str(bval).strip():
            day = None                                   # the cyan "In-Progress" header: in progress, no day assigned
            continue
        if day is None or not str(bval).strip():
            continue
        head, crew, seq, rest = parse_stage(str(cval))
        order += 1
        wo = str(ws.cell(r, 4).value or '').strip()
        addr = str(ws.cell(r, 7).value or '').strip()
        scope = str(ws.cell(r, 8).value or '').strip()
        extra = str(ws.cell(r, 9).value or '').strip()
        task = ' — '.join(x for x in [rest, scope] if x) or head
        notes = ' · '.join(x for x in [f'W/O {wo}' if wo else '', addr, extra] if x) or None
        out.append({
            'company_id': COMPANY_ID, 'schedule_date': day.isoformat(), 'site_number': site_key(bval), 'raw_site': str(bval).strip(),
            'stage_text': str(cval).strip() or None, 'task_description': task[:300], 'crew': crew or None,
            'notes': notes, 'sort_order': seq if seq is not None else order, 'source': 'master_schedule', 'row': r,
            'in_progress': fill_rgb(c) == '04FAE1' or head.lower().startswith('in-progress'),
        })
    return out, monday

def rest(url, key, method, path, body=None, prefer=None):
    req = urllib.request.Request(f'{url}/rest/v1/{path}', data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Prefer': prefer or 'return=representation'})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read() or b'null')
    except urllib.error.HTTPError as ex:
        sys.exit(f'{method} {path.split("?")[0]} -> HTTP {ex.code}: {ex.read()[:400].decode(errors="replace")}')

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = sys.argv[1:]
    if not args: sys.exit(__doc__)
    week = flags[flags.index('--week') + 1] if '--week' in flags else None
    apply = '--apply' in flags
    plan, monday = read_plan(args[0], week)
    print(f'From {monday} (today {datetime.date.today() if not week else week}): {len(plan)} planned rows')
    for p in plan:
        print(f"  {p['schedule_date']} {'*' if p['in_progress'] else ' '} {p['site_number']:<22} crew={'-'.join(p['crew'] or []) or '-':<12} #{p['sort_order']}  {p['task_description'][:70]}")
    if not apply: print('\nDry run. Add --apply to write.'); return
    e = env(); url, key = e['NEXT_PUBLIC_SUPABASE_URL'], e['SUPABASE_SERVICE_ROLE_KEY']
    # match jobs by site (prefer a non-complete job; prefer one whose W/O text appears in the notes)
    jobs = rest(url, key, 'GET', f'con_jobs?company_id=eq.{COMPANY_ID}&stage=neq.complete&select=id,site_number,work_order_number,stage')
    by_site, by_num = {}, {}
    for j in jobs:
        sk = (j['site_number'] or '').strip().upper()
        by_site.setdefault(sk, []).append(j)
        n = re.search(r'\d{3,5}$', sk)                     # "Global 3633" in the sheet is site "3633" in the app
        if n: by_num.setdefault(n.group(0), []).append(j)
    rows = []
    for p in plan:
        num = re.search(r'\d{3,5}$', p['site_number'])
        cands = by_site.get(p['site_number'].upper()) or by_site.get(p['raw_site'].upper()) or (by_num.get(num.group(0), []) if num and not re.match(r'^(SU|IP|CP)', p['site_number'], re.I) else [])
        pick = next((j for j in cands if j.get('work_order_number') and p['notes'] and j['work_order_number'].split()[0] in p['notes']), cands[0] if cands else None)
        rows.append({k: v for k, v in p.items() if k not in ('row', 'raw_site', 'in_progress')} | {'job_id': pick['id'] if pick else None})
    dates = sorted({p['schedule_date'] for p in plan})
    lo, hi = min(dates), max(dates)
    rest(url, key, 'DELETE', f"con_schedule_entries?company_id=eq.{COMPANY_ID}&source=eq.master_schedule&schedule_date=gte.{lo}&schedule_date=lte.{hi}", prefer='return=minimal')
    written = rest(url, key, 'POST', 'con_schedule_entries', rows)
    unmatched = [r['site_number'] for r in rows if not r['job_id']]
    print(f"\nWrote {len(written)} rows for {', '.join(dates)}. Jobs matched: {len(rows) - len(unmatched)}; no job found for: {', '.join(unmatched) or 'none'}")

if __name__ == '__main__':
    main()
