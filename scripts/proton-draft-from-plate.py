#!/usr/bin/env python3
"""
Push order emails drafted on My Plate (/my) into Trae's Proton Drafts through the Proton Mail Bridge.

  python3 scripts/proton-draft-from-plate.py [--owner dodson3.trae@gmail.com] [--apply]

The app only stores the draft (action.draft on con_tasks); nothing is ever sent. This script runs on the Mac with
the Bridge (same login as scripts/proton-pull-attachments.py, split-address: tdodson.rp@proton.me) and APPENDs each
pending draft to the Drafts folder, where it shows up in Proton web and iOS ready to review and send. After a push the
task's action.draft_status becomes 'in_proton' so it is never appended twice.
Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local and the Bridge creds from the environment or ~/.proton-bridge-credentials.
"""
import sys, os, re, json, ssl, time, imaplib, urllib.request, urllib.error, email.utils
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FROM = 'tdodson.rp@proton.me'

def env():
    e = {}
    for line in (ROOT / '.env.local').read_text().splitlines():
        m = re.match(r'^([A-Z_][A-Z0-9_]*)=(.*)$', line)
        if m: e[m.group(1)] = m.group(2).strip('"')
    return e

def bridge_creds():
    u, p = os.environ.get('PROTON_BRIDGE_USERNAME'), os.environ.get('PROTON_BRIDGE_PASSWORD')
    host, port = os.environ.get('PROTON_BRIDGE_HOST', '127.0.0.1'), int(os.environ.get('PROTON_BRIDGE_IMAP_PORT', '1143'))
    f = os.path.expanduser('~/.proton-bridge-credentials')
    if not p and os.path.exists(f):
        for line in open(f):
            m = re.match(r'\s*(?:export\s+)?([A-Z_]+)\s*=\s*"?([^"\n]*)"?', line)
            if not m: continue
            k, v = m.group(1), m.group(2)
            if k == 'PROTON_BRIDGE_PASSWORD': p = v
            if k == 'PROTON_BRIDGE_HOST': host = v
            if k == 'PROTON_BRIDGE_IMAP_PORT': port = int(v)
    if not p: sys.exit('No Bridge password: set PROTON_BRIDGE_PASSWORD or create ~/.proton-bridge-credentials')
    return p, host, port

def rest(url, key, method, path, body=None):
    req = urllib.request.Request(f'{url}/rest/v1/{path}', data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Prefer': 'return=representation'})
    try:
        with urllib.request.urlopen(req) as resp: return json.loads(resp.read() or b'null')
    except urllib.error.HTTPError as ex: sys.exit(f'{method} {path.split("?")[0]} -> HTTP {ex.code}: {ex.read()[:300].decode(errors="replace")}')

def main():
    flags = sys.argv[1:]
    owner = flags[flags.index('--owner') + 1] if '--owner' in flags else 'dodson3.trae@gmail.com'
    apply = '--apply' in flags
    e = env(); url, key = e['NEXT_PUBLIC_SUPABASE_URL'], e['SUPABASE_SERVICE_ROLE_KEY']
    prof = rest(url, key, 'GET', f'profiles?email=eq.{owner}&select=id')
    if not prof: sys.exit(f'no profile for {owner}')
    tasks = rest(url, key, 'GET', f"con_tasks?owner_id=eq.{prof[0]['id']}&action->>type=eq.order_email&action->>draft_status=eq.drafted&status=neq.done&select=id,title,site_number,action")
    print(f'{len(tasks)} drafted order email(s) waiting')
    if not tasks: return
    for t in tasks:
        d = t['action']['draft']
        print(f"  {t['site_number'] or '-'}  To {d['to']}  Subject: {d['subject']}")
    if not apply: print('\nDry run. Add --apply to put them in Proton Drafts.'); return
    p, host, port = bridge_creds()
    ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
    M = imaplib.IMAP4(host, port); M.starttls(ctx); M.login(FROM, p)
    for t in tasks:
        d = t['action']['draft']
        msg = EmailMessage()
        msg['From'] = f'Trae Dodson <{FROM}>'; msg['To'] = d['to']; msg['Cc'] = ', '.join(d.get('cc') or []); msg['Subject'] = d['subject']
        msg['Date'] = email.utils.formatdate(localtime=True); msg['Message-ID'] = email.utils.make_msgid(domain='proton.me')
        msg.set_content(d['body'])
        for att in (t['action'].get('attachments') or []):
            req = urllib.request.Request(f"{url}/storage/v1/object/{att['bucket']}/{att['path']}", headers={'apikey': key, 'Authorization': f'Bearer {key}'})
            try:
                with urllib.request.urlopen(req) as resp: data = resp.read()
            except urllib.error.HTTPError as ex: print(f"  attachment {att['name']}: HTTP {ex.code}"); continue
            main_type, sub_type = ('application', 'pdf') if att['name'].lower().endswith('.pdf') else ('application', 'octet-stream')
            msg.add_attachment(data, maintype=main_type, subtype=sub_type, filename=att['name'])
        typ, _ = M.append('Drafts', '\\Draft', imaplib.Time2Internaldate(time.time()), msg.as_bytes())
        if typ != 'OK': print(f"  FAILED {t['title'][:60]}"); continue
        action = dict(t['action']); action['draft_status'] = 'in_proton'; action['pushed_at'] = time.strftime('%Y-%m-%dT%H:%M:%S')
        rest(url, key, 'PATCH', f"con_tasks?id=eq.{t['id']}", {'action': action})
        print(f"  in Proton Drafts: {d['subject']}")
    M.logout()

if __name__ == '__main__':
    main()
