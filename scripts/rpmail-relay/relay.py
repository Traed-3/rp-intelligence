#!/usr/bin/env python3
"""RPMail Proton helper (runs on the Mac Studio).

The website (rpintelligence.app) cannot reach Proton Bridge, which only listens on this Mac. So this helper calls the
website, asks for work, and answers each Gmail-style question (list messages, open one, get an attachment, what changed)
from Proton Bridge over IMAP. To the website a Proton mailbox then looks like a Gmail one.

Which mail belongs to which RPMail mailbox follows the local RPMail exactly (Trae, 11/24/26: "work proton resides in the
folder RPS on proton"):
- A box with a `folder_home` (Work Proton: Folders/RPS) owns everything filed in that folder or under it, from EVERY Proton
  login (mail to the personal address that was filed under RPS is work mail).
- Each Proton login's default box gets the rest of that login's mail.
- A box's "Inbox" is INBOX plus its `inbox_folders` (Work Proton: Folders/RPS itself; its subfolders count as filed).

- Proton logins and their Keychain password entries come from ~/rps-inbox/config.json (the local RPMail's own settings,
  read only, never changed). The shared secret is the Keychain item  service "rpmail-relay", account "secret".
- Nothing is written to Proton yet: changes (mark read, archive, send) answer "not yet" (501).
- Logs go to ~/rpmail-relay/relay.log and never hold message text, addresses or passwords.
Installed by install.sh as the LaunchAgent com.trae.rpmail-relay.
"""
import base64, concurrent.futures, email, hashlib, imaplib, json, os, queue, re, subprocess, sys, threading, time, urllib.request, urllib.error

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
    def __init__(self, code, msg=''):
        super().__init__(msg)
        self.code = code


def under(folder, home):
    return folder == home or folder.startswith(home + '/')


class Login:
    """One Proton Bridge login: its connections, and an index of every message (All Mail) and which folders hold it."""

    def __init__(self, acc):
        self.user = acc['user'].lower()
        self.acc = acc
        self.pool = queue.Queue()
        self.lock = threading.Lock()
        self.refreshed = 0
        self.uv = None
        self.meta = {}           # All Mail uid -> {iid, mid, refs, irt, date, flags}
        self.folder_uids = {}    # folder -> {uid: iid}
        self.folder_status = {}
        self.labels_of = {}      # iid -> set(folder)
        self.folders = []        # user folders and labels
        self.snippets = {}

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

    @staticmethod
    def hdr_map(raw):
        msg = email.message_from_bytes(raw or b'')
        return {k.lower(): str(v) for k, v in msg.items()}

    def folders_of(self, uid):
        return self.labels_of.get(self.meta[uid]['iid'], set())

    def thread_of(self, uid):
        x = self.meta[uid]
        root = (x['refs'].split() or [None])[0] or x['irt'] or x['mid'] or (self.user + str(uid))
        return hashlib.sha1(root.encode()).hexdigest()[:16]

    # ── keeping the index up to date ──
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
        m.select('"All Mail"', readonly=True)
        m._sel = 'All Mail'
        uv = int(m.response('UIDVALIDITY')[1][0])
        if self.uv is not None and uv != self.uv:
            # Bridge rebuilt its copy: every id changes; the views notice the new UIDVALIDITY and the website reloads.
            self.meta, self.folder_uids, self.folder_status, self.labels_of = {}, {}, {}, {}
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
            have = {u: i for u, i in self.folder_uids.get(f, {}).items() if u in uids}
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

    # ── reading ──
    def raw(self, uid, peek='BODY.PEEK[]'):
        def go(m):
            self.select(m, 'All Mail')
            typ, d = m.uid('fetch', str(uid), '(UID %s)' % peek)
            for it in d or []:
                if isinstance(it, tuple): return it[1]
            raise Fail(404)
        return self.run(go)

    def search(self, text):
        def go(m):
            self.select(m, 'All Mail')
            t = text.replace('\\', ' ').replace('"', ' ')[:100]
            typ, d = m.uid('search', 'CHARSET', 'UTF-8', 'TEXT', '"%s"' % t)
            return {int(x) for x in (d[0] or b'').split()}
        return self.run(go)


def payload(msg, part_id=''):
    headers = [{'name': k, 'value': str(v)} for k, v in msg.items()]
    p = {'partId': part_id, 'mimeType': msg.get_content_type(), 'filename': msg.get_filename() or '', 'headers': headers}
    if msg.is_multipart():
        p['body'] = {'size': 0}
        p['parts'] = [payload(s, (part_id + '.' if part_id else '') + str(i)) for i, s in enumerate(msg.get_payload())]
    else:
        data = msg.get_payload(decode=True) or b''
        disp = (msg.get('Content-Disposition') or '').lower()
        if msg.get_filename() or 'attachment' in disp or (msg.get('Content-ID') and msg.get_content_maintype() == 'image'):
            p['body'] = {'size': len(data), 'attachmentId': part_id or '0'}
        else:
            p['body'] = {'size': len(data), 'data': b64u(data)}
    return p


def snippet_of(msg):
    for part in msg.walk():
        if part.get_content_type() in ('text/plain', 'text/html') and not part.get_filename():
            t = (part.get_payload(decode=True) or b'').decode(part.get_content_charset() or 'utf-8', 'replace')
            if part.get_content_type() == 'text/html':
                t = re.sub(r'<(style|script)[^>]*>.*?</\1>', ' ', t[:200000], flags=re.S | re.I)
                t = re.sub(r'<[^>]{0,2000}>', ' ', t)
            t = re.sub(r'\s+', ' ', t).strip()
            if t: return t[:200]
    return ''


def one(params, key, default=None):
    v = params.get(key, default)
    return v[0] if isinstance(v, list) and v else v


class View:
    """One RPMail mailbox, made of the mail of one or more Proton logins that belongs to it.

    `parts` is a list of (tag, login, test): `test(login, uid)` says whether that message belongs here. Ids are 16 hex:
    the tag, 7 hex of the login's UIDVALIDITY, then the All Mail UID, so they stay put when mail moves between folders.
    """

    def __init__(self, address, parts, inbox):
        self.address = address
        self.parts = parts
        self.inbox = set(inbox)
        self.lock = threading.Lock()
        self.state_file = os.path.join(HOME, 'view-' + hashlib.sha1(address.encode()).hexdigest()[:10] + '.json')
        st = {}
        try:
            st = json.load(open(self.state_file))
        except Exception:
            pass
        self.hid = int(st.get('hid') or int(time.time() * 1000))
        self.base = int(st.get('base') or self.hid)
        self.changes = [tuple(c) for c in st.get('changes', [])]
        self.snap = st.get('snap', {})
        self.uvs = st.get('uvs', {})

    def hexid(self, tag, login, uid): return '%x%07x%08x' % (tag, (login.uv or 0) & 0xfffffff, uid)

    def members(self):
        for tag, login, test in self.parts:
            for uid in list(login.meta):
                if uid in login.meta and test(login, uid):
                    yield tag, login, uid

    def resolve(self, hexid):
        if not re.fullmatch(r'[0-9a-f]{16}', hexid or ''): raise Fail(404)
        tag, uvp, uid = int(hexid[0], 16), int(hexid[1:8], 16), int(hexid[8:], 16)
        for t, login, test in self.parts:
            if t == tag and (login.uv or 0) & 0xfffffff == uvp and uid in login.meta and test(login, uid):
                return login, uid
        raise Fail(404)

    def labels(self, login, uid):
        x = login.meta[uid]
        out = set()
        for f in login.folders_of(uid):
            if f in self.inbox: out.add('INBOX')
            if f in SYSTEM: out.add(SYSTEM[f])
            if f.startswith('Folders/') or f.startswith('Labels/'): out.add(lid(f))
        if '\\Seen' not in x['flags']: out.add('UNREAD')
        if '\\Flagged' in x['flags']: out.add('STARRED')
        return sorted(out)

    def refresh(self, force=False):
        for _, login, _ in self.parts:
            login.refresh(force)
        with self.lock:
            uvs = {login.user: login.uv for _, login, _ in self.parts}
            if self.uvs and uvs != self.uvs:
                self.snap, self.changes = {}, []
                self.base = self.hid = int(time.time() * 1000)
            snap = {self.hexid(t, l, u): ','.join(self.labels(l, u)) for t, l, u in self.members()}
            changed = [k for k, v in snap.items() if self.snap.get(k) != v] + [k for k in self.snap if k not in snap]
            if self.snap and changed:
                self.hid += 1
                self.changes.append((self.hid, changed[:3000]))
                self.changes = self.changes[-500:]
            elif not self.snap:
                self.hid += 1
            self.snap, self.uvs = snap, uvs
            tmp = self.state_file + '.tmp'
            json.dump({'hid': self.hid, 'base': self.base, 'changes': self.changes, 'snap': snap, 'uvs': uvs}, open(tmp, 'w'))
            os.replace(tmp, self.state_file)

    # ── Gmail-style answers ──
    def message(self, hexid, params):
        self.refresh()
        login, uid = self.resolve(hexid)
        x = login.meta[uid]
        fmt = one(params, 'format', 'full')
        base = {'id': hexid, 'threadId': login.thread_of(uid), 'labelIds': self.labels(login, uid), 'internalDate': str(x['date']), 'historyId': str(self.hid)}
        if fmt == 'minimal':
            return base
        if fmt == 'metadata':
            msg = email.message_from_bytes(login.raw(uid, 'BODY.PEEK[HEADER]'))
            want = params.get('metadataHeaders')
            want = {w.lower() for w in (want if isinstance(want, list) else [want])} if want else None
            hs = [{'name': k, 'value': str(v)} for k, v in msg.items() if not want or k.lower() in want]
            return {**base, 'snippet': login.snippets.get(uid, ''), 'payload': {'mimeType': msg.get_content_type(), 'headers': hs}}
        msg = email.message_from_bytes(login.raw(uid))
        sn = snippet_of(msg)
        login.snippets[uid] = sn
        return {**base, 'snippet': sn, 'sizeEstimate': 0, 'payload': payload(msg)}

    def attachment(self, hexid, part_id):
        login, uid = self.resolve(hexid)
        node = email.message_from_bytes(login.raw(uid))
        for i in (part_id.split('.') if part_id not in ('', '0') or node.is_multipart() else []):
            if not node.is_multipart(): raise Fail(404)
            kids = node.get_payload()
            if not re.fullmatch(r'\d{1,3}', i) or int(i) >= len(kids): raise Fail(404)
            node = kids[int(i)]
        data = node.get_payload(decode=True) or b''
        return {'size': len(data), 'data': b64u(data)}

    def list(self, params):
        self.refresh()
        q = one(params, 'q', '') or ''
        words, inbox, days, nodraft = [], False, None, False
        for tok in q.split():
            if tok == 'in:inbox': inbox = True
            elif tok.startswith('newer_than:') and tok.endswith('d') and tok[11:-1].isdigit(): days = int(tok[11:-1])
            elif tok == '-in:drafts': nodraft = True
            elif tok.startswith('-in:') or tok.startswith('in:'): pass
            else: words.append(tok)
        hits = None
        if words:
            hits = {}
            for _, login, _ in self.parts:
                if login.user not in hits:
                    hits[login.user] = login.search(' '.join(words))
        since = (time.time() - days * 86400) * 1000 if days else None
        out = []
        for tag, login, uid in self.members():
            if hits is not None and uid not in hits.get(login.user, ()): continue
            labs = self.labels(login, uid)
            if 'SPAM' in labs or 'TRASH' in labs: continue
            if inbox and 'INBOX' not in labs: continue
            if nodraft and 'DRAFT' in labs: continue
            if since and login.meta[uid]['date'] < since: continue
            out.append((login.meta[uid]['date'], tag, login, uid))
        out.sort(key=lambda r: r[0], reverse=True)
        tok = str(one(params, 'pageToken', '0') or '0')
        start = int(tok) if tok.isdigit() else 0
        mr = str(one(params, 'maxResults', '100') or '100')
        n = min(500, int(mr) if mr.isdigit() else 100)
        page = out[start:start + n]
        res = {'messages': [{'id': self.hexid(t, l, u), 'threadId': l.thread_of(u)} for _, t, l, u in page], 'resultSizeEstimate': len(out)}
        if start + n < len(out): res['nextPageToken'] = str(start + n)
        return res

    def thread(self, tid, params):
        self.refresh()
        members = sorted([(l.meta[u]['date'], t, l, u) for t, l, u in self.members() if l.thread_of(u) == tid], key=lambda r: r[0])
        if not members: raise Fail(404)
        if one(params, 'format', 'full') == 'minimal':
            return {'id': tid, 'messages': [{'id': self.hexid(t, l, u), 'threadId': tid, 'labelIds': self.labels(l, u)} for _, t, l, u in members]}
        return {'id': tid, 'messages': [self.message(self.hexid(t, l, u), {'format': 'metadata', 'metadataHeaders': params.get('metadataHeaders')}) for _, t, l, u in members[-100:]]}

    def history(self, params):
        self.refresh()
        try:
            start = int(one(params, 'startHistoryId', 0) or 0)
        except ValueError:
            raise Fail(400, 'bad history id')
        if start < self.base or start > self.hid:
            raise Fail(404)
        ids, seen = [], set()
        for h, changed in self.changes:
            if h > start:
                for i in changed:
                    if i not in seen:
                        seen.add(i); ids.append(i)
        ids = ids[:3000]
        return {'history': [{'id': str(self.hid), 'messages': [{'id': i} for i in ids]}] if ids else [], 'historyId': str(self.hid)}

    def labels_list(self):
        self.refresh()
        names = sorted({f for _, login, _ in self.parts for f in login.folders})
        sys_ = [{'id': i, 'name': i, 'type': 'system'} for i in ('INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'STARRED', 'UNREAD')]
        return {'labels': sys_ + [{'id': lid(f), 'name': f.split('/', 1)[1], 'type': 'user'} for f in names]}

    def handle(self, job):
        method, path, params = job.get('method', 'GET'), job.get('path', ''), job.get('params') or {}
        if method == 'GET':
            if path == 'profile':
                self.refresh()
                return {'emailAddress': self.address, 'historyId': str(self.hid)}
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


def build_views(cfg):
    """The RPMail mailboxes, split the same way the local RPMail splits them (see the note at the top)."""
    logins, boxes = [], []
    for a in cfg.get('accounts', []):
        if a.get('type') != 'proton': continue
        login = Login(a)
        logins.append(login)
        for b in a.get('boxes', []):
            boxes.append((login, b))
    homes = [b['folder_home'] for _, b in boxes if b.get('folder_home')]
    in_home = lambda login, uid, home: any(under(f, home) for f in login.folders_of(uid))
    in_any_home = lambda login, uid: any(in_home(login, uid, h) for h in homes)
    views = {}
    for login, b in boxes:
        parts = []
        if b.get('folder_home'):
            home = b['folder_home']
            # Everything filed under its folder, from every login; plus the rest of its own login's mail if it is that login's default.
            for i, other in enumerate(logins):
                if other is login and b.get('default'):
                    parts.append((i, other, lambda l, u, h=home: True if not in_any_home(l, u) else in_home(l, u, h)))
                else:
                    parts.append((i, other, lambda l, u, h=home: in_home(l, u, h)))
        elif b.get('default'):
            i = logins.index(login)
            parts.append((i, login, lambda l, u: not in_any_home(l, u)))
        if parts:
            inbox = ['INBOX'] + list(b.get('inbox_folders', []))
            views[b['address'].lower()] = View(b['address'].lower(), parts, inbox)
    return logins, views


def post(secret, body, timeout):
    req = urllib.request.Request(SITE + '/api/rpmail/relay', data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret, 'User-Agent': 'rpmail-relay/2'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def main():
    secret = keychain('rpmail-relay', 'secret')
    if not secret:
        log('no shared secret in the Keychain (service rpmail-relay, account secret); stopping'); sys.exit(1)
    logins, views = build_views(json.load(open(os.path.expanduser('~/rps-inbox/config.json'))))
    addresses = list(views)
    log('started for', len(addresses), 'Proton mailboxes from', len(logins), 'logins')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=6)
    out = queue.Queue()

    def work(job):
        try:
            view = views.get(str(job.get('address', '')).lower())
            if not view: raise Fail(404)
            body, code = view.handle(job), 200
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
            batch = [out.get()]
            size = len(batch[0]['data'])
            while size < PART and not out.empty():
                nxt = out.get(); batch.append(nxt); size += len(nxt['data'])
            for attempt in range(4):
                try:
                    post(secret, {'addresses': addresses, 'results': batch}, 60); break
                except Exception as e:
                    log('could not send answers:', type(e).__name__); time.sleep(2 + attempt * 3)

    def keeper():
        while True:
            for v in views.values():
                try: v.refresh(force=True)
                except Exception as e: log('refresh failed for', v.address[:3] + '…', type(e).__name__, str(e)[:80])
            time.sleep(60)

    # Open a few Bridge connections up front, so the first jobs do not each wait for a sign-in.
    for login in logins:
        for _ in range(3):
            try: login.pool.put(login.connect())
            except Exception as e: log('could not open a Bridge connection for', login.user[:3] + '…', type(e).__name__); break
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
