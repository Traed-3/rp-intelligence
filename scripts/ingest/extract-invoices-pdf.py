#!/usr/bin/env python3
"""
extract-invoices-pdf — read the finished PDF invoices.

RPS keeps the same invoice twice: the working spreadsheet
("40419 AECOM ITEMIZATION.xls") and the PDF actually sent to the customer
("40419 AECOM INVOICE.pdf"). Entering both would double the revenue on that
job and corrupt the costing figures this exists to produce, so anything
matching an invoice already on the job is skipped.

The PDFs carry the real RPS invoice number ("Invoice #: 179306"), which the
spreadsheets usually leave blank — so where a PDF matches an invoice we
already extracted, its number is backfilled onto that record instead.

Needs pdftotext (poppler). Dry run unless --commit.

  python3 scripts/ingest/extract-invoices-pdf.py [--commit] [--limit N]
"""
import json, os, re, subprocess, sys, datetime, urllib.request

DRY = '--commit' not in sys.argv
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None

ENV = {}
for line in open(os.path.expanduser('~/Developer/rps-maintenance/.env.local'), encoding='utf8'):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1)
        ENV[k] = v.strip().strip('"')
URL, KEY = ENV['NEXT_PUBLIC_SUPABASE_URL'], ENV['SUPABASE_SERVICE_ROLE_KEY']
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}


def api(path, method='GET', body=None):
    req = urllib.request.Request(f'{URL}/rest/v1/{path}', method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    for k, v in H.items():
        req.add_header(k, v)
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


MONEY = r'\$?\s*([\d,]+\.\d{2})'


def money(s):
    return float(s.replace(',', '') .replace('$', '').strip())


def parse(text):
    """Pull the header fields and the grand total out of the layout text."""
    def grab(pattern, flags=re.I):
        m = re.search(pattern, text, flags)
        return m.group(1).strip() if m else None

    total = None
    for pat in (r'PROPOSAL GRAND TOTAL:?\s*' + MONEY,
                r'INVOICE GRAND TOTAL:?\s*' + MONEY,
                r'GRAND TOTAL:?\s*' + MONEY,
                r'INVOICE TOTAL:?\s*' + MONEY,
                r'TOTAL DUE:?\s*' + MONEY):
        m = re.search(pat, text, re.I)
        if m:
            total = money(m.group(1))
            break

    date = None
    d = grab(r'Invoice Date:?\s*([\d]{1,2}/[\d]{1,2}/[\d]{2,4})')
    if d:
        try:
            mm, dd, yy = [int(x) for x in d.split('/')]
            yy += 2000 if yy < 100 else 0
            date = datetime.date(yy, mm, dd).isoformat()
        except Exception:
            date = None

    return {
        'total': total,
        'invoice_date': date,
        'invoice_number': grab(r'Invoice #:?\s*([A-Za-z0-9-]+)'),
        'po_number': grab(r'PO#:?\s*([A-Za-z0-9-]+)'),
        'store_label': grab(r'STORE\s+(.+?)\s{2,}'),
        'attn': grab(r'ATTN:?\s+(.+?)\s{2,}'),
        'project_description': grab(r'PROJECT DESCRIPTION:?\s+(.{5,180}?)\s{3,}'),
    }


print(f"\n== extract-invoices-pdf {'(DRY RUN)' if DRY else '(COMMIT)'} ==")

if not subprocess.run(['which', 'pdftotext'], capture_output=True).stdout:
    sys.exit('pdftotext not found — install poppler (brew install poppler)')

COMPANY = page('con_jobs', 'company_id')[0]['company_id']

# What we already have, so a PDF of an invoice we extracted from its
# spreadsheet updates that record rather than creating a second one.
have = {}
for inv in page('con_invoices', 'id,job_id,invoice_grand_total,invoice_number'):
    have.setdefault(inv['job_id'], []).append(inv)

DUPLICATE_NAME = re.compile(r'autosaved|conflicted copy', re.I)
# A blank template carries sample figures. Word-bounded so real invoices like
# "Hydro test Invoice" and "PUL Vapor Test fail Invoice" aren't caught.
TEMPLATE_NAME = re.compile(r'\btemplate\b|\bsample\b|\bexample\b|\bblank\b', re.I)

docs = [d for d in page('con_documents', 'id,job_id,file_name,source_path,category')
        if d['category'] == 'invoices' and d.get('source_path')
        and d['file_name'].lower().endswith('.pdf')
        and not DUPLICATE_NAME.search(d['file_name'])
        and not TEMPLATE_NAME.search(d['file_name'])]
if LIMIT:
    docs = docs[:LIMIT]
print(f'PDF invoices to read: {len(docs)}')

new, dupe, backfill, nototal, failed = [], 0, [], 0, 0
for d in docs:
    if not os.path.exists(d['source_path']):
        failed += 1
        continue
    try:
        text = subprocess.run(['pdftotext', '-layout', d['source_path'], '-'],
                              capture_output=True, timeout=60).stdout.decode('utf8', 'ignore')
    except Exception:
        failed += 1
        continue
    info = parse(text)
    if not info['total']:
        nototal += 1
        continue

    # Same job + same money (to the cent) = the same invoice, filed twice.
    match = next((i for i in have.get(d['job_id'], [])
                  if abs(float(i.get('invoice_grand_total') or 0) - info['total']) < 0.01), None)
    if match:
        dupe += 1
        if info['invoice_number'] and not (match.get('invoice_number') or '').startswith(info['invoice_number']):
            backfill.append((match['id'], info['invoice_number']))
        continue
    new.append((d, info))

print(f'  new invoices found        : {len(new)}')
print(f'  already on the job (skipped): {dupe}')
print(f'  real invoice # to backfill : {len(backfill)}')
print(f'  no total in the PDF        : {nototal}')
print(f'  unreadable                 : {failed}')

if DRY:
    print('\nsample of new invoices:')
    for d, i in new[:10]:
        print(f"   {str(i['total']):>11}  {i['invoice_date'] or '(no date)':>10}  "
              f"{(i['invoice_number'] or '-'):>8}  {d['file_name'][:44]}")
    print(f"\n   value of NEW invoices: ${sum(i['total'] for _, i in new):,.2f}")
    print('\nDRY RUN — nothing written. Re-run with --commit')
    sys.exit(0)

for inv_id, number in backfill:
    try:
        api(f'con_invoices?id=eq.{inv_id}', 'PATCH', {'invoice_number': number})
    except Exception:
        pass
print(f'backfilled {len(backfill)} real invoice numbers')

made = 0
for d, i in new:
    body = {
        'company_id': COMPANY, 'job_id': d['job_id'],
        'invoice_number': i['invoice_number'],
        'invoice_date': i['invoice_date'],
        'po_number': i['po_number'], 'store_label': i['store_label'],
        'attn': i['attn'], 'project_description': i['project_description'],
        'invoice_grand_total': round(i['total'], 2),
        'grand_total': round(i['total'], 2),
        'status': 'sent',
    }
    try:
        api('con_invoices', 'POST', body)
        made += 1
    except Exception:
        failed += 1
print(f'created {made} invoice records from PDFs')
