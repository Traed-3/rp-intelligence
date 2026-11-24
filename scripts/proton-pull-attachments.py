#!/usr/bin/env python3
"""Pull attachments out of Proton Mail through the local Proton Mail Bridge (IMAP) and save them to a folder.

  python3 scripts/proton-pull-attachments.py --folder "Folders/RPS" --subject "Canopy Replacement" --out "/path/to/Quote Request"
  python3 scripts/proton-pull-attachments.py --folder "All Mail" --from sdodson.rp@gmail.com --since 2026-09-01 --out ./pulled --list

Credentials: PROTON_BRIDGE_USERNAME / PROTON_BRIDGE_PASSWORD from the environment, else from ~/.proton-bridge-credentials
(the same file the Proton connector uses; KEY="value" lines). Bridge must be running (127.0.0.1:1143, STARTTLS).
The Bridge is in split-address mode: the login address decides which mail you see. Default login is tdodson.rp@proton.me
(Trae's RPS folder); pass --user finance.trae@proton.me for the personal side. Same Bridge password for both.
Read-only: nothing is moved, flagged or deleted. Writes <out>/manifest.txt with one line per saved file.
"""
import argparse, email, imaplib, os, re, ssl, sys
from email.header import decode_header, make_header

def creds():
    u, p = os.environ.get('PROTON_BRIDGE_USERNAME'), os.environ.get('PROTON_BRIDGE_PASSWORD')
    host, port = os.environ.get('PROTON_BRIDGE_HOST', '127.0.0.1'), int(os.environ.get('PROTON_BRIDGE_IMAP_PORT', '1143'))
    f = os.path.expanduser('~/.proton-bridge-credentials')
    if (not u or not p) and os.path.exists(f):
        for line in open(f):
            m = re.match(r'\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?', line)
            if not m: continue
            k, v = m.group(1), m.group(2)
            if k == 'PROTON_BRIDGE_USERNAME' and not u: u = v
            if k == 'PROTON_BRIDGE_PASSWORD' and not p: p = v
            if k == 'PROTON_BRIDGE_HOST': host = v
            if k == 'PROTON_BRIDGE_IMAP_PORT': port = int(v)
    if not u or not p:
        sys.exit('No Bridge credentials: set PROTON_BRIDGE_USERNAME/PASSWORD or create ~/.proton-bridge-credentials')
    return u, p, host, port

def safe(name):
    return re.sub(r'[^\w.\-() ]+', '_', name).strip()[:150] or 'attachment'

def hdr(v):
    try: return str(make_header(decode_header(v or '')))
    except Exception: return v or ''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folder', default='INBOX')
    ap.add_argument('--subject', help='substring, case-insensitive')
    ap.add_argument('--from', dest='sender', help='substring of the From address')
    ap.add_argument('--since', help='YYYY-MM-DD')
    ap.add_argument('--out', required=True)
    ap.add_argument('--list', action='store_true', help='list matching messages and their attachment names, do not save')
    ap.add_argument('--max', type=int, default=50)
    ap.add_argument('--user', help='Bridge login address. In split-address mode each Proton address is its own IMAP login with the same Bridge password; Trae\'s RPS folder lives under tdodson.rp@proton.me', default=os.environ.get('PROTON_BRIDGE_USERNAME') or 'tdodson.rp@proton.me')
    a = ap.parse_args()
    os.environ['PROTON_BRIDGE_USERNAME'] = a.user
    u, p, host, port = creds()
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    M = imaplib.IMAP4(host, port); M.starttls(ctx); M.login(u, p)
    typ, _ = M.select('"%s"' % a.folder, readonly=True)
    if typ != 'OK': sys.exit(f'cannot open folder {a.folder}')
    crit = []
    if a.subject: crit += ['SUBJECT', '"%s"' % a.subject]
    if a.sender: crit += ['FROM', '"%s"' % a.sender]
    if a.since:
        y, m, d = a.since.split('-'); months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
        crit += ['SINCE', f'{int(d):02d}-{months[int(m)-1]}-{y}']
    typ, data = M.search(None, *(crit or ['ALL']))
    ids = data[0].split()[-a.max:]
    os.makedirs(a.out, exist_ok=True)
    manifest = open(os.path.join(a.out, 'manifest.txt'), 'a') if not a.list else None
    total = 0
    for i in reversed(ids):
        typ, msgdata = M.fetch(i, '(BODY.PEEK[])')
        raw = next((part[1] for part in msgdata if isinstance(part, tuple)), None)
        if not raw: continue
        msg = email.message_from_bytes(raw)
        subj, frm, date = hdr(msg.get('Subject')), hdr(msg.get('From')), msg.get('Date')
        atts = []
        for part in msg.walk():
            fn = part.get_filename()
            if not fn and part.get_content_disposition() != 'attachment': continue
            if part.get_content_maintype() == 'multipart': continue
            fn = hdr(fn) if fn else f'part-{len(atts)+1}.bin'
            atts.append((fn, part))
        print(f'[{i.decode()}] {date} | {frm} | {subj} | {len(atts)} attachment(s)')
        for fn, part in atts:
            print(f'      - {fn}')
            if manifest is not None:
                payload = part.get_payload(decode=True) or b''
                target = os.path.join(a.out, safe(fn)); n = 1
                while os.path.exists(target):
                    base, ext = os.path.splitext(safe(fn)); target = os.path.join(a.out, f'{base} ({n}){ext}'); n += 1
                open(target, 'wb').write(payload)
                manifest.write(f'{os.path.basename(target)}\t{len(payload)}\t{date}\t{frm}\t{subj}\n'); total += 1
    if manifest: manifest.close(); print(f'saved {total} file(s) to {a.out}')
    M.logout()

if __name__ == '__main__':
    main()
