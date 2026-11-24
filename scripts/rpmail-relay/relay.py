#!/usr/bin/env python3
"""RPMail Proton helper (runs on the Mac Studio).

The website (rpintelligence.app) cannot reach Proton Bridge, which only listens on this Mac. So this helper calls the
website, asks for work, and answers each Gmail-style question (list messages, open one, get an attachment, what changed)
from Proton Bridge over IMAP. To the website a Proton mailbox then looks like a Gmail one.

- Proton accounts and their Keychain password entries are read from ~/rps-inbox/config.json (the local RPMail's own
  settings, read only, never changed). The shared secret is the Keychain item  service "rpmail-relay", account "secret".
- Nothing is written to Proton yet: changes (mark read, archive, send) answer "not yet" (501).
- Logs go to ~/rpmail-relay/relay.log and never hold message text, addresses or passwords.
Installed by install.sh as the LaunchAgent com.trae.rpmail-relay.
"""
import base64, concurrent.futures, email, email.policy, hashlib, imaplib, json, os, queue, re, subprocess, sys, threading, time, traceback, urllib.request, urllib.error
from email.utils import parsedate_to_datetime

HOME = os.path.expanduser('~/rpmail-relay')
SITE = os.environ.get('RPMAIL_SITE', 'https://rpintelligence.app')
PART = 2_900_000
imaplib._MAXLINE = 50_000_000
os.makedirs(HOME, exist_ok=True)

def log(*a):
    with open(os.path.join(HOME, 'relay.log'), 'a') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + ' '.join(str(x) for x in a) + '\n')

def keychain(service, account):
    r = subprocess.run(['security', 'find-generic-password', '-w', '-s', service, '-a', account], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None

def b64u(b): return base64.urlsafe_b64encode(b).decode().rstrip('=')
def lid(name): return 'Label_' + hashlib.sha1(name.encode()).hexdigest()[:12]

SYSTEM = {'Sent': 'SENT', 'Drafts': 'DRAFT', 'Spam': 'SPAM', 'Trash': 'TRASH', 'Starred': 'STARRED'}
MEMBER_FOLDERS = ('INBOX', 'Sent', 'Drafts', 'Spam', 'Trash', 'Starred', 'Archive')
HDR = '(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (X-PM-INTERNAL-ID MESSAGE-ID REFERENCES IN-REPLY-TO)])'

class Fail(Exception):
    def __init__(self, code, msg=''): super().__init__(msg); self.code = code


class Account:
    def __init__(self, acc, inbox_folders):
        self.user = acc['user'].lower()
        self.acc = acc
        self.inbox = set(['INBOX'] + list(inbox_folders))
        self.pool = queue.Queue()
        self.lock = threading.Lock()          # one refresh at a time
        self.refreshed = 0
        self.uv = None
        self.meta = {}                        # All Mail uid -> {iid, mid, refs, irt, date, flags}
        self.folder_uids = {}                 # folder -> {uid: iid}
        self.folder_status = {}
        self.labels_of = {}                   # iid -> set(folder)
        self.snippets = {}
        self.folders = []
        self.state_file = os.path.join(HOME, 'state-' + hashlib.sha1(self.user.encode()).hexdigest()[:10] + '.json')
        st = {}
        try:
            st = json.load(open(self.state_file))
        except Exception:
            pass
        self.hid = int(st.get('hid') or int(time.time() * 1000))
        self.base = int(st.get('base') or self.hid)
        self.changes = [tuple(c) for c in st.get('changes', [])]
        self.snap = st.get('snap', {})
        self.saved_uv = st.get('uv')

    # ── connections ──
    def connect(self):
        pw = None
        for s in self.acc['keychain']:
            pw = keychain(s, self.acc.get('keychain_account', self.acc['user']))
            if pw:
                break
        if not pw:
            raise Fail(401, 'no Bridge password in the Keychain')
        m = imaplib.IMAP4(self.acc.get('host', '127.0.0.1'), int(self.acc.get('port', 1143)), timeout=60)
        m.starttls()
        try:
            m.login(self.acc['user'], pw)
        except imaplib.IMAP4.error:
            raise Fail(401, 'Bridge refused the sign-in')
        m._sel = None
        return m

    def take(self):
        try:
            return self.pool.get_nowait()
        except queue.Empty:
            return self.connect()

    def give(self, m):
        # Kept open for the next job: signing in to Bridge takes a second or two, a read on an open connection a few ms.
        if self.pool.qsize() < 6:
            self.pool.put(m)
        else:
            try: m.logout()
            except Exception: pass

    def run(self, fn):
        """fn(conn) with a pooled connection, one retry on a broken connection."""
        for attempt in (0, 1):
            m = self.take()
            try:
                out = fn(m)
                self.give(m)
                return out
            except (imaplib.IMAP4.abort, OSError, EOFError):
                try: m.logout()
                except Exception: pass
                if attempt:
                    raise Fail(503, 'lost the connection to Bridge')

    @staticmethod
    def select(m, folder):
        if m._sel != folder:
            typ, _ = m.select('"%s"' % folder.replace('"', '\\"'), readonly=True)
            if typ != 'OK':
                raise Fail(404, 'no such folder')
            m._sel = folder

    # ── keeping track of what is where ──
    def hexid(self, uid): return '%08x%08x' % ((self.uv or 0) & 0xffffffff, uid)
    def uid_of(self, hexid):
        if not re.fullmatch(r'[0-9a-f]{16}', hexid or '') or int(hexid[:8], 16) != (self.uv or 0) & 0xffffffff:
            raise Fail(404)
        uid = int(hexid[8:], 16)
        if uid not in self.meta:
            raise Fail(404)
        return uid

    def thread_of(self, uid):
        x = self.meta[uid]
        root = (x['refs'].split() or [None])[0] or x['irt'] or x['mid'] or str(uid)
        return hashlib.sha1(root.encode()).hexdigest()[:16]

    def labels(self, uid):
        x = self.meta[uid]
        out = set()
        for f in self.labels_of.get(x['iid'], ()):
            if f in self.inbox: out.add('INBOX')
            if f in SYSTEM: out.add(SYSTEM[f])
            if f.startswith('Folders/') or f.startswith('Labels/'): out.add(lid(f))
        if '\\Seen' not in x['flags']: out.add('UNREAD')
        if '\\Flagged' in x['flags']: out.add('STARRED')
        return sorted(out)

    @staticmethod
    def hdr_map(raw):
        msg = email.message_from_bytes(raw or b'')
        return {k.lower(): str(v) for k, v in msg.items()}

    def refresh(self, force=False):
        with self.lock:
            if not force and time.time() - self.refreshed < 20:
                return
            self.run(self._refresh)
            self.refreshed = time.time()

    def _refresh(self, m):
        typ, data = m.list()
        names = []
        for line in data or []:
            s = (line[0] + b' ' + line[1] if isinstance(line, tuple) else line).decode('utf-8', 'replace')
            mm = re.match(r'\((.*?)\) (?:"(.*?)"|NIL) "?(.*?)"?$', s)
            if mm and '\\Noselect' not in mm.group(1):
                names.append(mm.group(3))
        self.folders = [n for n in names if n.startswith('Folders/') or n.startswith('Labels/')]
        m._sel = None
        typ, d = m.select('"All Mail"', readonly=True)
        m._sel = 'All Mail'
        uv = int(m.response('UIDVALIDITY')[1][0])
        if self.uv is not None and uv != self.uv or (self.saved_uv is not None and uv != self.saved_uv):
            # Bridge rebuilt its copy: every id changes, so the website must reload this mailbox.
            self.meta, self.folder_uids, self.labels_of, self.snap, self.changes = {}, {}, {}, {}, []
            self.base = self.hid = int(time.time() * 1000)
            self.saved_uv = None
            log(self.user[:3] + '…', 'Bridge copy rebuilt; the website will reload')
        self.uv = uv
        typ, d = m.uid('search', None, 'ALL')
        on = {int(x) for x in (d[0] or b'').split()}
        new = sorted(on - self.meta.keys())
        for i in range(0, len(new), 300):
            self._fetch_meta(m, new[i:i + 300])
        for u in list(self.meta):
            if u not in on:
                del self.meta[u]
        if self.meta:
            typ, d = m.uid('fetch', '1:*', '(UID FLAGS)')
            for it in d or []:
                line = it[0] if isinstance(it, tuple) else it
                if not isinstance(line, bytes): continue
                mu = re.search(rb'UID (\d+)', line); mf = re.search(rb'FLAGS \((.*?)\)', line)
                if mu and mf and int(mu.group(1)) in self.meta:
                    self.meta[int(mu.group(1))]['flags'] = mf.group(1).decode()
        # Which folders each message sits in (Proton keeps one copy and shows it in each folder and label).
        for f in list(MEMBER_FOLDERS) + self.folders:
            typ, st = m.status('"%s"' % f.replace('"', '\\"'), '(MESSAGES UIDNEXT)')
            if typ != 'OK': continue
            if self.folder_status.get(f) == st[0] and f in self.folder_uids: continue
            self.select(m, f)
            typ, d = m.uid('search', None, 'ALL')
            uids = {int(x) for x in (d[0] or b'').split()}
            have = self.folder_uids.get(f, {})
            have = {u: i for u, i in have.items() if u in uids}
            want = sorted(uids - have.keys())
            for i in range(0, len(want), 400):
                chunk = ','.join(str(u) for u in want[i:i + 400])
                typ, dd = m.uid('fetch', chunk, '(UID BODY.PEEK[HEADER.FIELDS (X-PM-INTERNAL-ID)])')
                for it in dd or []:
                    if isinstance(it, tuple):
                        mu = re.search(rb'UID (\d+)', it[0])
                        iid = self.hdr_map(it[1]).get('x-pm-internal-id', '').strip()
                        if mu and iid: have[int(mu.group(1))] = iid
            self.folder_uids[f] = have
            self.folder_status[f] = st[0]
        for f in list(self.folder_uids):
            if f not in MEMBER_FOLDERS and f not in self.folders:
                del self.folder_uids[f]
        lab = {}
        for f, us in self.folder_uids.items():
            for iid in us.values():
                lab.setdefault(iid, set()).add(f)
        self.labels_of = lab
        m._sel = None
        # What changed since last time: the website asks for these through "history".
        snap = {self.hexid(u): ','.join(self.labels(u)) for u in self.meta}
        changed = [k for k, v in snap.items() if self.snap.get(k) != v] + [k for k in self.snap if k not in snap]
        if self.snap and changed:
            self.hid += 1
            self.changes.append((self.hid, changed[:3000]))
            self.changes = self.changes[-500:]
        elif not self.snap:
            self.hid += 1
        self.snap = snap
        self.saved_uv = uv
        tmp = self.state_file + '.tmp'
        json.dump({'hid': self.hid, 'base': self.base, 'changes': self.changes, 'snap': snap, 'uv': uv}, open(tmp, 'w'))
        os.replace(tmp, self.state_file)

    def _fetch_meta(self, m, uids):
        if not uids: return
        typ, d = m.uid('fetch', ','.join(str(u) for u in uids), HDR)
        for it in d or []:
            if not isinstance(it, tuple): continue
            head = it[0]
            mu = re.search(rb'UID (\d+)', head)
            if not mu: continue
            mf = re.search(rb'FLAGS \((.*?)\)', head); mi = re.search(rb'INTERNALDATE "([^"]+)"', head)
            h = self.hdr_map(it[1])
            try:
                ms = int(time.mktime(imaplib.Internaldate2tuple(b'INTERNALDATE "' + mi.group(1) + b'"')) * 1000) if mi else 0
            except Exception:
                ms = 0
            self.meta[int(mu.group(1))] = {'iid': h.get('x-pm-internal-id', '').strip(), 'mid': h.get('message-id', '').strip(),
                'refs': h.get('references', ''), 'irt': h.get('in-reply-to', '').strip(), 'date': ms, 'flags': mf.group(1).decode() if mf else ''}

    # ── building Gmail-style answers ──
    def raw(self, uid, peek='BODY.PEEK[]'):
        def go(m):
            self.select(m, 'All Mail')
            typ, d = m.uid('fetch', str(uid), '(UID %s)' % peek)
            for it in d or []:
                if isinstance(it, tuple): return it[1]
            raise Fail(404)
        return self.run(go)

    @staticmethod
    def payload(msg, part_id=''):
        headers = [{'name': k, 'value': str(v)} for k, v in msg.items()]
        p = {'partId': part_id, 'mimeType': msg.get_content_type(), 'filename': msg.get_filename() or '', 'headers': headers}
        if msg.is_multipart():
            p['body'] = {'size': 0}
            p['parts'] = [Account.payload(s, (part_id + '.' if part_id else '') + str(i)) for i, s in enumerate(msg.get_payload())]
        else:
            data = msg.get_payload(decode=True) or b''
            disp = (msg.get('Content-Disposition') or '').lower()
            if msg.get_filename() or 'attachment' in disp or (msg.get('Content-ID') and msg.get_content_maintype() == 'image'):
                p['body'] = {'size': len(data), 'attachmentId': part_id or '0'}
            else:
                p['body'] = {'size': len(data), 'data': b64u(data)}
        return p

    def snippet_of(self, msg):
        for part in msg.walk():
            if part.get_content_type() in ('text/plain', 'text/html') and not part.get_filename():
                t = (part.get_payload(decode=True) or b'').decode(part.get_content_charset() or 'utf-8', 'replace')
                if part.get_content_type() == 'text/html':
                    t = re.sub(r'<(style|script)[^>]*>.*?</\1>', ' ', t[:200000], flags=re.S | re.I)
                    t = re.sub(r'<[^>]{0,2000}>', ' ', t)
                t = re.sub(r'\s+', ' ', t).strip()
                if t: return t[:200]
        return ''

    def message(self, hexid, params):
        self.refresh()
        uid = self.uid_of(hexid)
        x = self.meta[uid]
        fmt = (params.get('format') or ['full'])[0] if isinstance(params.get('format'), list) else params.get('format', 'full')
        base = {'id': hexid, 'threadId': self.thread_of(uid), 'labelIds': self.labels(uid), 'internalDate': str(x['date']), 'historyId': str(self.hid)}
        if fmt == 'minimal':
            return base
        if fmt == 'metadata':
            raw = self.raw(uid, 'BODY.PEEK[HEADER]')
            msg = email.message_from_bytes(raw)
            want = params.get('metadataHeaders')
            want = {w.lower() for w in (want if isinstance(want, list) else [want])} if want else None
            hs = [{'name': k, 'value': str(v)} for k, v in msg.items() if not want or k.lower() in want]
            return {**base, 'snippet': self.snippets.get(hexid, ''), 'payload': {'mimeType': msg.get_content_type(), 'headers': hs}}
        msg = email.message_from_bytes(self.raw(uid))
        sn = self.snippet_of(msg)
        self.snippets[hexid] = sn
        return {**base, 'snippet': sn, 'sizeEstimate': 0, 'payload': self.payload(msg)}

    def attachment(self, hexid, part_id):
        uid = self.uid_of(hexid)
        msg = email.message_from_bytes(self.raw(uid))
        node = msg
        if part_id not in ('', '0') or msg.is_multipart():
            for i in (part_id.split('.') if part_id else []):
                if not node.is_multipart(): raise Fail(404)
                kids = node.get_payload()
                if not re.fullmatch(r'\d{1,3}', i) or int(i) >= len(kids): raise Fail(404)
                node = kids[int(i)]
        data = node.get_payload(decode=True) or b''
        return {'size': len(data), 'data': b64u(data)}

    def search(self, text):
        def go(m):
            self.select(m, 'All Mail')
            t = text.replace('\\', ' ').replace('"', ' ')[:100]
            typ, d = m.uid('search', 'CHARSET', 'UTF-8', 'TEXT', '"%s"' % t)
            return {int(x) for x in (d[0] or b'').split()}
        return self.run(go)

    def list(self, params):
        self.refresh()
        q = (params.get('q') or '')
        q = q[0] if isinstance(q, list) else q
        words, inbox, days, nodraft = [], False, None, False
        for tok in q.split():
            if tok == 'in:inbox': inbox = True
            elif tok.startswith('newer_than:') and tok.endswith('d') and tok[11:-1].isdigit(): days = int(tok[11:-1])
            elif tok == '-in:drafts': nodraft = True
            elif tok.startswith('-in:') or tok.startswith('in:'): pass
            else: words.append(tok)
        uids = set(self.meta)
        if words: uids &= self.search(' '.join(words))
        since = (time.time() - days * 86400) * 1000 if days else None
        out = []
        for u in uids:
            labs = self.labels(u)
            if 'SPAM' in labs or 'TRASH' in labs: continue
            if inbox and 'INBOX' not in labs: continue
            if nodraft and 'DRAFT' in labs: continue
            if since and self.meta[u]['date'] < since: continue
            out.append(u)
        out.sort(key=lambda u: self.meta[u]['date'], reverse=True)
        start = int(params.get('pageToken') or 0) if str(params.get('pageToken') or '0').isdigit() else 0
        n = min(500, int(params.get('maxResults') or 100) if str(params.get('maxResults') or '').isdigit() else 100)
        page = out[start:start + n]
        res = {'messages': [{'id': self.hexid(u), 'threadId': self.thread_of(u)} for u in page], 'resultSizeEstimate': len(out)}
        if start + n < len(out): res['nextPageToken'] = str(start + n)
        return res

    def thread(self, tid, params):
        self.refresh()
        members = sorted([u for u in self.meta if self.thread_of(u) == tid], key=lambda u: self.meta[u]['date'])
        if not members: raise Fail(404)
        fmt = params.get('format', 'full')
        if fmt == 'minimal':
            return {'id': tid, 'messages': [{'id': self.hexid(u), 'threadId': tid, 'labelIds': self.labels(u)} for u in members]}
        return {'id': tid, 'messages': [self.message(self.hexid(u), {'format': 'metadata', 'metadataHeaders': params.get('metadataHeaders')}) for u in members[-100:]]}

    def history(self, params):
        self.refresh()
        try:
            start = int(params.get('startHistoryId') or 0)
        except ValueError:
            raise Fail(400, 'bad history id')
        if start < self.base or start > self.hid:
            raise Fail(404)
        ids = []
        for h, changed in self.changes:
            if h > start: ids.extend(changed)
        seen = set()
        ids = [i for i in ids if not (i in seen or seen.add(i))][:3000]
        return {'history': [{'id': str(self.hid), 'messages': [{'id': i} for i in ids]}] if ids else [], 'historyId': str(self.hid)}

    def labels_list(self):
        self.refresh()
        sys_ = [{'id': i, 'name': i, 'type': 'system'} for i in ('INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'STARRED', 'UNREAD')]
        return {'labels': sys_ + [{'id': lid(f), 'name': f.split('/', 1)[1], 'type': 'user'} for f in self.folders]}

    def handle(self, job):
        method, path, params = job.get('method', 'GET'), job.get('path', ''), job.get('params') or {}
        if method == 'GET':
            if path == 'profile':
                self.refresh()
                return {'emailAddress': self.user, 'historyId': str(self.hid)}
            if path == 'labels': return self.labels_list()
            if path == 'messages': return self.list(params)
            if path == 'history': return self.history(params)
            mm = re.fullmatch(r'messages/([0-9a-f]{16})', path)
            if mm: return self.message(mm.group(1), params)
            mm = re.fullmatch(r'messages/([0-9a-f]{16})/attachments/([\d.]{1,20})', path)
            if mm: return self.attachment(mm.group(1), mm.group(2))
            mm = re.fullmatch(r'threads/([0-9a-f]{16})', path)
            if mm: return self.thread(mm.group(1), params)
            if path == 'drafts': return {'drafts': []}
        raise Fail(501, 'not yet for Proton')


def post(secret, body, timeout):
    req = urllib.request.Request(SITE + '/api/rpmail/relay', data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret, 'User-Agent': 'rpmail-relay/1'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def main():
    secret = keychain('rpmail-relay', 'secret')
    if not secret:
        log('no shared secret in the Keychain (service rpmail-relay, account secret); stopping'); sys.exit(1)
    cfg = json.load(open(os.path.expanduser('~/rps-inbox/config.json')))
    accounts = {}
    for a in cfg.get('accounts', []):
        if a.get('type') != 'proton': continue
        inboxes = [f for b in a.get('boxes', []) for f in b.get('inbox_folders', [])]
        accounts[a['user'].lower()] = Account(a, inboxes)
    addresses = list(accounts)
    log('started for', len(addresses), 'Proton accounts')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=6)
    out = queue.Queue()

    def work(job):
        try:
            acc = accounts.get(str(job.get('address', '')).lower())
            if not acc: raise Fail(404)
            body, code = acc.handle(job), 200
        except Fail as e:
            body, code = {'error': {'message': str(e)}}, e.code
        except Exception as e:
            log('job failed:', job.get('method'), re.sub(r'[0-9a-f]{16}', ':id', str(job.get('path')))[:60], type(e).__name__)
            body, code = {'error': {'message': 'the helper hit a problem'}}, 500
        text = json.dumps(body)
        parts = [text[i:i + PART] for i in range(0, len(text), PART)] or ['']
        for i, p in enumerate(parts):
            out.put({'job': job['id'], 'seq': i, 'last': i == len(parts) - 1, 'code': code, 'data': p})

    def sender():
        while True:
            r = out.get()
            batch = [r]
            size = len(r['data'])
            while size < PART and not out.empty():
                nxt = out.get(); batch.append(nxt); size += len(nxt['data'])
                if size > PART: break
            for attempt in range(4):
                try:
                    post(secret, {'addresses': addresses, 'results': batch}, 60); break
                except Exception as e:
                    log('could not send answers:', type(e).__name__); time.sleep(2 + attempt * 3)

    def keeper():
        while True:
            for a in accounts.values():
                try: a.refresh(force=True)
                except Exception as e: log('refresh failed for', a.user[:3] + '…', type(e).__name__, str(e)[:80])
            time.sleep(60)

    # Open a few Bridge connections up front, so the first jobs do not each wait for a sign-in.
    for a in accounts.values():
        for _ in range(3):
            try: a.pool.put(a.connect())
            except Exception as e: log('could not open a Bridge connection for', a.user[:3] + '…', type(e).__name__); break
    threading.Thread(target=sender, daemon=True).start()
    threading.Thread(target=keeper, daemon=True).start()
    while True:
        try:
            r = post(secret, {'addresses': addresses, 'wait': True}, 40)
            for job in r.get('jobs', []):
                pool.submit(work, job)
        except urllib.error.HTTPError as e:
            log('website said', e.code); time.sleep(10 if e.code != 403 else 60)
        except Exception as e:
            log('cannot reach the website:', type(e).__name__); time.sleep(5)


if __name__ == '__main__':
    main()
