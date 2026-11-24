#!/usr/bin/env python3
"""
link-invoice-customers — put the customer on every extracted invoice.

The invoice extractor read the store, address and totals but skipped the
CUSTOMER field, so 369 of 371 invoices came out unattributed. The files do
carry it, just spelled 57 different ways: "7 ELEVEN INC", "7-Eleven Inc. -
Environmental", "SEI-Project Forum", "SEI - Inhouse" and so on.

SEI is 7-Eleven — the Dropbox tree keeps "SEI Completed", "SEI Project
Forum" and "SEI IN HOUSE MAINTENANCE" as work streams for the same
customer — so those map to 7-Eleven with the stream recorded as the job's
program instead of inventing a customer per programme.

Creates any customer that doesn't exist yet, then sets customer_id on the
invoice and on its job. Dry run unless --commit.

  python3 scripts/ingest/link-invoice-customers.py [--commit]
"""
import json, os, re, sys, urllib.request

DRY = '--commit' not in sys.argv

ENV = {}
for line in open(os.path.expanduser('~/Developer/rps-maintenance/.env.local'), encoding='utf8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        ENV[k] = v.strip().strip('"')
URL, KEY = ENV['NEXT_PUBLIC_SUPABASE_URL'], ENV['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}


def api(path, method='GET', body=None, prefer=None):
    req = urllib.request.Request(f'{URL}/rest/v1/{path}', method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    for k, v in H.items():
        req.add_header(k, v)
    if prefer:
        req.add_header('Prefer', prefer)
    with urllib.request.urlopen(req) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw.strip() else None


def page(table, select):
    out, frm = [], 0
    while True:
        req = urllib.request.Request(f'{URL}/rest/v1/{table}?select={select}')
        for k, v in H.items():
            req.add_header(k, v)
        req.add_header('Range', f'{frm}-{frm+999}')
        with urllib.request.urlopen(req) as r:
            b = json.loads(r.read().decode())
        out += b
        if len(b) < 1000:
            return out
        frm += 1000


# (pattern, canonical customer, programme). First match wins, so the more
# specific SEI streams are tested before the bare 7-Eleven spellings.
RULES = [
    (r'sei\s*[-–]?\s*project\s*forum',      '7-Eleven',                 'SEI Project Forum'),
    (r'sei\s*[-–]?\s*in\s*[-–]?\s*house',   '7-Eleven',                 'SEI In-House'),
    (r'sei\s*[-–]?\s*compliance',           '7-Eleven',                 'SEI Compliance'),
    (r'\bsei\b',                            '7-Eleven',                 'SEI'),
    (r'^project\s*forum$',                  '7-Eleven',                 'SEI Project Forum'),
    (r'\bvericon\b',                        'Vericon',                  None),
    (r'wu\s+ching\s+jung',                  'Wu Ching Jung and Ying Wu', None),
    (r'7\s*[-–]?\s*eleven.*environmental',  '7-Eleven',                 'Environmental'),
    (r'7\s*[-–]?\s*eleven',                 '7-Eleven',                 None),
    (r'\bvixxo\b',                          'Vixxo',                    None),
    (r'\bsheetz\b',                         'Sheetz',                   None),
    (r'\bwawa\b',                           'Wawa',                     None),
    (r'\baecom\b',                          'AECOM',                    None),
    (r'capit[oa]l\s+petroleum',             'Capital Petroleum Group',  None),
    (r'global\s+partners',                  'Global Partners',          None),
    (r'\bsunoco\b',                         'Sunoco LP',                None),
    (r'\bspeedway\b',                       'IDS-Speedway',             None),
    (r'\bics\b|imagine\s+commer',           'ICS',                      None),
    (r'\btanknology\b',                     'Tanknology',               None),
    (r'\bmeckley\b',                        'Meckley',                  None),
    (r'jefferson\s+county',                 'Jefferson County Schools', None),
    (r'jf\s+petroleum',                     'JF Petroleum Group',       None),
    (r'\btravel\s*america\b|\bta\b',        'Travel America',           None),
]

# Cells my label matcher grabbed by mistake — not customers.
JUNK = re.compile(r'^(project manager|site\s*#|location:?|customer:?|attn:?|n/?a|store)$', re.I)


def canonical(raw):
    if not raw or JUNK.match(raw.strip()):
        return None, None
    t = raw.strip().lower()
    for pat, name, prog in RULES:
        if re.search(pat, t):
            return name, prog
    return None, None


import xlrd, openpyxl, warnings
warnings.filterwarnings('ignore')


def customer_in(path):
    """Read the CUSTOMER cell — value sits below the label, or to its right."""
    try:
        if path.lower().endswith('.xls'):
            s = xlrd.open_workbook(path).sheet_by_index(0)
            get = lambda r, c: s.cell_value(r, c) if r < s.nrows and c < s.ncols else ''
            R, C = s.nrows, s.ncols
        else:
            s = openpyxl.load_workbook(path, data_only=True).worksheets[0]
            R, C = min(s.max_row or 0, 120), min(s.max_column or 0, 20)
            get = lambda r, c: (s.cell(row=r + 1, column=c + 1).value or '')
        for r in range(R):
            for c in range(C):
                v = get(r, c)
                if isinstance(v, str) and v.strip().upper().rstrip(': ').startswith('CUSTOMER'):
                    for rr in range(r + 1, min(r + 3, R)):
                        t = get(rr, c)
                        if isinstance(t, str) and t.strip() and len(t.strip()) < 45:
                            return t.strip()
                    for cc in range(c + 1, C):
                        t = get(r, cc)
                        if isinstance(t, str) and t.strip() and len(t.strip()) < 45:
                            return t.strip()
    except Exception:
        pass
    return None


print(f"\n== link-invoice-customers {'(DRY RUN)' if DRY else '(COMMIT)'} ==")

customers = {c['name'].lower(): c for c in page('con_customers', 'id,name')}
invoices = page('con_invoices', 'id,job_id,customer_id,store_label')
docs = {}
for d in page('con_documents', 'id,job_id,file_name,source_path,category'):
    if d['category'] == 'invoices' and d.get('source_path'):
        docs.setdefault(d['job_id'], []).append(d)

COMPANY = page('con_jobs', 'company_id')[0]['company_id']

plan, unmatched, nofile = [], {}, 0
for inv in invoices:
    if inv.get('customer_id'):
        continue
    name = prog = raw = None

    # The Dropbox folder is the strongest signal — "SEI Completed",
    # "Capitol Petroleum", "All Other Customers/Global Partners" — and it is
    # right even when the sheet's CUSTOMER cell holds a project manager's
    # name or a site number. Deepest segment first so the customer folder
    # beats the year folder above it.
    for d in docs.get(inv['job_id'], []):
        segs = [s for s in (d.get('source_path') or '').split('/') if s]
        for seg in reversed(segs):
            name, prog = canonical(seg)
            if name:
                raw = seg
                break
        if name:
            break

    # Fall back to reading the CUSTOMER cell out of the sheet itself.
    if not name:
        for d in docs.get(inv['job_id'], []):
            if re.search(r'\.xlsx?$', d['file_name'], re.I) and os.path.exists(d['source_path']):
                cell = customer_in(d['source_path'])
                if cell:
                    raw = cell
                    name, prog = canonical(cell)
                    if name:
                        break

    if not name:
        if raw:
            unmatched[raw] = unmatched.get(raw, 0) + 1
        else:
            nofile += 1
        continue
    plan.append((inv, name, prog))

need = sorted({n for _, n, _ in plan if n.lower() not in customers})
print(f'invoices to link      : {len(plan)}')
print(f'customers to create   : {len(need)}  {need}')
print(f'no customer in file   : {nofile}')
if unmatched:
    print(f'unrecognised names    : {sum(unmatched.values())}')
    for k, v in sorted(unmatched.items(), key=lambda x: -x[1])[:8]:
        print(f'      {v:3}  {k[:45]}')

counts = {}
for _, n, _ in plan:
    counts[n] = counts.get(n, 0) + 1
print('\nwould link:')
for n, c in sorted(counts.items(), key=lambda x: -x[1]):
    print(f'   {c:4}  {n}')

if DRY:
    print('\nDRY RUN — nothing written. Re-run with --commit')
    sys.exit(0)

for name in need:
    made = api('con_customers', 'POST', {'company_id': COMPANY, 'name': name},
               prefer='return=representation')
    customers[name.lower()] = made[0]
    print(f'  created customer: {name}')

linked = progged = 0
for inv, name, prog in plan:
    cid = customers[name.lower()]['id']
    api(f"con_invoices?id=eq.{inv['id']}", 'PATCH', {'customer_id': cid})
    linked += 1
    if inv['job_id']:
        patch = {'customer_id': cid}
        if prog:
            patch['program'] = prog
        api(f"con_jobs?id=eq.{inv['job_id']}&customer_id=is.null", 'PATCH', patch)
        progged += 1

print(f'\nlinked {linked} invoices; pushed the customer onto {progged} jobs')
