#!/usr/bin/env python3
"""RPMail Proton helper (runs on the Mac Studio).

The website (rpintelligence.app) cannot reach Proton Bridge, which only listens on this Mac. So this helper calls the
website, asks for work, and answers each Gmail-style call (list messages, open one, get an attachment, what changed,
mark read, archive, Trash, send) from Proton Bridge over IMAP and SMTP. To the website a Proton mailbox then looks like
a Gmail one.

Which mail belongs to which RPMail mailbox follows the local RPMail exactly (Trae, 11/24/26: "work proton resides in the
folder RPS on proton"):
- A box with a `folder_home` (Work Proton: Folders/RPS) owns everything filed in that folder or under it, from EVERY Proton
  login (mail to the personal address that was filed under RPS is work mail).
- Each Proton login's default box gets the rest of that login's mail.
- A box's "Inbox" is INBOX plus its `inbox_folders` (Work Proton: Folders/RPS itself; its subfolders count as filed).
- Mail that RPMail moved out of the folder that put it in a box (archived, Spam, Trash) stays in that box: the helper
  remembers it in ~/rpmail-relay/moves.json, so archiving work mail never sends it to Personal Proton.

Changes are only made when the website asks, and the website only asks from a person's own click:
- Read / unread and the star are Proton's own flags. Archive, Spam, Trash and the Proton folders are moves; Trash is
  Proton's Trash, never a permanent delete. A label is added by copying into Labels/<name> and taken off by moving the
  message from Labels/<name> back to its own folder (Proton's documented way). Nothing is ever expunged.
- Send goes through Bridge's SMTP port as the mailbox's own address; Proton files the copy in Sent. A send that reached
  this Mac too late (the website had already given up) is refused, so a message never goes out twice.
- Drafts are saved into Drafts; a draft that is saved again or sent has its old copy moved to Trash.

- Proton logins and their Keychain password entries come from ~/rps-inbox/config.json (the local RPMail's own settings,
  read only, never changed). The shared secret is the Keychain item  service "rpmail-relay", account "secret".
- Logs go to ~/rpmail-relay/relay.log and never hold message text, addresses or passwords.
Installed by install.sh as the LaunchAgent com.trae.rpmail-relay.
"""
import base64, calendar, concurrent.futures, email, email.utils, hashlib, imaplib, json, os, queue, re, smtplib, ssl, subprocess, sys, threading, time, urllib.request, urllib.error

HOME = os.path.expanduser('~/rpmail-relay')
SITE = os.environ.get('RPMAIL_SITE', 'https://rpintelligence.app')
PART = 2_900_000
SMTP_PORT = 1025
SEND_TOO_OLD = 30            # seconds: a send job older than this is refused (the website stops waiting at 40)
imaplib._MAXLINE = 50_000_000
os.makedirs(HOME, exist_ok=True)


def log(*a):
    with open(os.path.join(HOME, 'relay.log'), 'a') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + ' '.join(str(x) for x in a) + '\n')


def keychain(service, account):
    r = subprocess.run(['security', 'find-generic-password', '-w', '-s', service, '-a', account], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None


def save_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def b64u(b): return base64.urlsafe_b64encode(b).decode().rstrip('=')
def lid(name): return 'Label_' + hashlib.sha1(name.encode()).hexdigest()[:12]
def q(name): return '"%s"' % name.replace('\\', '\\\\').replace('"', '\\"')


SYSTEM = {'Sent': 'SENT', 'Drafts': 'DRAFT', 'Spam': 'SPAM', 'Trash': 'TRASH', 'Starred': 'STARRED'}
MEMBER_FOLDERS = ('INBOX', 'Sent', 'Drafts', 'Spam', 'Trash', 'Starred', 'Archive')
LOCS = ('INBOX', 'Archive', 'Sent', 'Drafts', 'Spam', 'Trash')     # Proton keeps each message in one of these (or a Folders/ folder)
HDR = '(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (X-PM-INTERNAL-ID MESSAGE-ID REFERENCES IN-REPLY-TO)])'
ADDR_RE = re.compile(r'^[^@\s<>,;"]+@[^@\s<>,;"]+\.[^@\s<>,;"]+$')
IID_RE = re.compile(r'^[A-Za-z0-9_=+/-]{8,200}$')


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
        self.lock = threading.RLock()
        self.refreshed = 0
        self.uv = None
        self.meta = {}           # All Mail uid -> {iid, mid, refs, irt, date, flags}
        self.folder_uids = {}    # folder -> {uid: iid}
        self.folder_status = {}
        self.labels_of = {}      # iid -> set(folder)
        self.folders = []        # user folders and labels
        self.snippets = {}

    # ── connections ──
    def password(self):
        for s in self.acc['keychain']:
            pw = keychain(s, self.acc.get('keychain_account', self.acc['user']))
            if pw:
                return pw
        raise Fail(401, 'no Bridge password in the Keychain')

    def connect(self):
        pw = self.password()
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

    def run(self, fn, retry=True):
        """fn(conn) with a pooled connection, one retry on a broken connection (none for a change that must not repeat)."""
        for attempt in (0, 1):
            m = self.take()
            try:
                out = fn(m)
                self.give(m)
                return out
            except (imaplib.IMAP4.abort, OSError, EOFError):
                try: m.logout()
                except Exception: pass
                if attempt or not retry:
                    raise Fail(503, 'lost the connection to Bridge')

    @staticmethod
    def select(m, folder):
        if m._sel != folder:
            typ, _ = m.select(q(folder), readonly=True)
            if typ != 'OK':
                raise Fail(404, 'no such folder')
            m._sel = folder

    @staticmethod
    def wselect(m, folder):
        """Open a folder to change something in it."""
        if m._sel != ('w', folder):
            typ, _ = m.select(q(folder), readonly=False)
            if typ != 'OK':
                raise Fail(404, 'no such folder')
            m._sel = ('w', folder)

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
            typ, st = m.status(q(f), '(MESSAGES UIDNEXT)')
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

    # ── changes ──
    def find_in(self, folder, iid):
        """This message's number inside one folder (each folder numbers its messages its own way)."""
        if not iid or not IID_RE.match(iid):
            raise Fail(404, 'that message cannot be found')
        for attempt in (0, 1):
            for u, i in self.folder_uids.get(folder, {}).items():
                if i == iid:
                    return u
            if attempt == 0:
                self.folder_status.pop(folder, None)
                self.refresh(force=True)
        raise Fail(404, 'that message is no longer there')

    def set_flag(self, uid, flag, on):
        """Read (\\Seen) or starred (\\Flagged): one flag on the message, the same in every folder."""
        with self.lock:
            def go(m):
                self.wselect(m, 'All Mail')
                typ, d = m.uid('store', str(uid), '+FLAGS' if on else '-FLAGS', '(%s)' % flag)
                if typ != 'OK':
                    raise Fail(502, 'Proton did not take the change')
            self.run(go)
            fl = set((self.meta[uid].get('flags') or '').split())
            if on: fl.add(flag)
            else: fl.discard(flag)
            self.meta[uid]['flags'] = ' '.join(sorted(fl))

    def move(self, uid, src, dest):
        """Move a message from one folder to another (Archive, Spam, Trash, a Proton folder, or back)."""
        with self.lock:
            iid = self.meta[uid]['iid']
            fu = self.find_in(src, iid)
            def go(m):
                self.wselect(m, src)
                typ, d = m.uid('MOVE', str(fu), q(dest))
                if typ != 'OK':
                    raise Fail(502, 'Proton did not move it')
            self.run(go)
            self.folder_uids.get(src, {}).pop(fu, None)
            # A new set, not a change to the old one: another thread may be reading it right now.
            self.labels_of[iid] = (self.labels_of.get(iid, set()) - {src}) | {dest}
            self.folder_status.pop(src, None)
            self.folder_status.pop(dest, None)

    def add_label(self, uid, label):
        """A copy into Labels/<name> puts the label on; the message stays where it is."""
        if not label.startswith('Labels/'):
            raise Fail(400, 'not a label')
        with self.lock:
            def go(m):
                self.wselect(m, 'All Mail')
                typ, d = m.uid('COPY', str(uid), q(label))
                if typ != 'OK':
                    raise Fail(502, 'Proton did not add the label')
            self.run(go)
            iid = self.meta[uid]['iid']
            self.labels_of[iid] = self.labels_of.get(iid, set()) | {label}
            self.folder_status.pop(label, None)

    def drop_label(self, uid, label, home):
        """Moving the message from Labels/<name> back to its own folder takes the label off (Proton's documented way)."""
        if not label.startswith('Labels/'):
            raise Fail(400, 'not a label')
        with self.lock:
            iid = self.meta[uid]['iid']
            fu = self.find_in(label, iid)
            def go(m):
                self.wselect(m, label)
                typ, d = m.uid('MOVE', str(fu), q(home or 'Archive'))
                if typ != 'OK':
                    raise Fail(502, 'Proton did not take the label off')
            self.run(go)
            self.folder_uids.get(label, {}).pop(fu, None)
            self.labels_of[iid] = self.labels_of.get(iid, set()) - {label}
            self.folder_status.pop(label, None)

    def append_draft(self, raw):
        """Save a draft into Drafts. Returns its All Mail number, or None if it could not be found straight away."""
        with self.lock:
            before = set(self.folder_uids.get('Drafts', {}))
            def go(m):
                typ, d = m.append('Drafts', '(\\Draft \\Seen)', imaplib.Time2Internaldate(time.time()), raw)
                if typ != 'OK':
                    raise Fail(502, 'Proton did not save the draft')
                mm = re.search(rb'APPENDUID \d+ (\d+)', b' '.join(x for x in (d or []) if isinstance(x, bytes)))
                return int(mm.group(1)) if mm else None
            du = self.run(go, retry=False)          # never twice: a second try could save it twice
            self.folder_status.pop('Drafts', None)
            self.refresh(force=True)
            drafts = self.folder_uids.get('Drafts', {})
            iid = drafts.get(du) if du else None
            if not iid:
                fresh = sorted(set(drafts) - before)
                iid = drafts[fresh[-1]] if fresh else None
            if not iid:
                return None
            return next((u for u, x in self.meta.items() if x['iid'] == iid), None)

    def create_folder(self, name):
        with self.lock:
            def go(m):
                typ, d = m.create(q(name))
                if typ != 'OK':
                    raise Fail(400, 'Proton would not make that label')
            self.run(go, retry=False)
            self.refreshed = 0

    def rename_folder(self, old, new):
        with self.lock:
            def go(m):
                m._sel = None
                typ, d = m.rename(q(old), q(new))
                if typ != 'OK':
                    raise Fail(400, 'Proton would not rename that label')
            self.run(go, retry=False)
            self.refreshed = 0

    def delete_folder(self, name):
        """Deleting a label in Proton takes it off every message; the messages themselves stay."""
        if not name.startswith('Labels/'):
            raise Fail(400, 'only labels can be deleted from RPMail')
        with self.lock:
            def go(m):
                m._sel = None
                typ, d = m.delete(q(name))
                if typ != 'OK':
                    raise Fail(400, 'Proton would not delete that label')
            self.run(go, retry=False)
            self.refreshed = 0

    def smtp_send(self, raw, sender, rcpts):
        """Send through Proton Bridge. Only ever reached from a person's own Send click on the website."""
        host = self.acc.get('host', '127.0.0.1')
        if host not in ('127.0.0.1', 'localhost', '::1'):
            raise Fail(400, 'Proton Bridge must be on this Mac')
        # Bridge listens only on this Mac and signs with its own certificate, so there is nothing to check it against;
        # the address above is this Mac itself, so nothing outside the Mac is ever trusted this way.
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        try:
            with smtplib.SMTP_SSL(host, SMTP_PORT, timeout=90, context=ctx) as sm:   # Bridge's sending port is SSL from the first byte
                sm.login(self.acc['user'], self.password())
                refused = sm.sendmail(sender, rcpts, raw)
        except smtplib.SMTPRecipientsRefused:
            raise Fail(400, 'Proton refused every address. Check them and send again.')
        except smtplib.SMTPAuthenticationError:
            raise Fail(401, 'Bridge refused the sign-in')
        except (smtplib.SMTPException, OSError) as e:
            raise Fail(502, 'Proton would not send it (%s)' % type(e).__name__)
        self.refreshed = 0
        return sorted(refused or {})


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


def raw_of(body):
    """The message the website built (Gmail's base64url `raw`)."""
    s = body.get('raw') if isinstance(body, dict) else None
    if not isinstance(s, str) or not s or len(s) > 40_000_000 or not re.fullmatch(r'[A-Za-z0-9_=-]+', s):
        raise Fail(400, 'no message to send')
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def split_head(raw):
    for sep in (b'\r\n\r\n', b'\n\n'):
        i = raw.find(sep)
        if i >= 0:
            return raw[:i], raw[i:]
    return raw, b''


def without_headers(raw, names):
    """The message with some header lines (and their continuation lines) taken out, the rest untouched byte for byte."""
    head, rest = split_head(raw)
    out, skip = [], False
    for line in re.split(rb'(?<=\n)', head):
        if line[:1] in (b' ', b'\t'):
            if not skip: out.append(line)
            continue
        name = line.split(b':', 1)[0].strip().lower()
        skip = name in names
        if not skip: out.append(line)
    return b''.join(out) + rest


def recipients(raw):
    msg = email.message_from_bytes(split_head(raw)[0] + b'\r\n\r\n')
    got = email.utils.getaddresses([str(v) for k in ('to', 'cc', 'bcc') for v in msg.get_all(k, [])])
    rc = []
    for _, a in got:
        a = a.strip()
        if a and a.lower() not in (x.lower() for x in rc):
            rc.append(a)
    sender = email.utils.parseaddr(str(msg.get('from', '')))[1].strip()
    return sender, rc


class Router:
    """Which RPMail mailbox each Proton message belongs to, and where messages RPMail moved came from (for Undo)."""

    def __init__(self, homes, defaults):
        self.homes = homes          # [(folder, address)]
        self.defaults = defaults    # login user -> address of that login's default box
        self.file = os.path.join(HOME, 'moves.json')
        self.lock = threading.Lock()
        st = load_json(self.file)
        self.holds = dict(st.get('holds') or {})    # Proton message id -> the mailbox it stays in
        self.moved = dict(st.get('moved') or {})    # Proton message id -> the folder it was last moved out of

    def natural(self, login, uid):
        fs = login.folders_of(uid)
        for home, addr in self.homes:
            if any(under(f, home) for f in fs):
                return addr
        return self.defaults.get(login.user)

    def owner(self, login, uid):
        return self.holds.get(login.meta[uid]['iid']) or self.natural(login, uid)

    def note(self, login, uid, src, address):
        """After RPMail moved a message: remember where it came from, and keep it in the mailbox it was moved from."""
        iid = login.meta[uid]['iid']
        if not iid:
            return
        with self.lock:
            self.moved.pop(iid, None)
            self.moved[iid] = src
            while len(self.moved) > 20000:
                self.moved.pop(next(iter(self.moved)))
            if self.natural(login, uid) != address:
                self.holds[iid] = address
            else:
                self.holds.pop(iid, None)
            save_json(self.file, {'holds': self.holds, 'moved': self.moved})


class View:
    """One RPMail mailbox, made of the mail of one or more Proton logins that belongs to it.

    `parts` is a list of (tag, login, test): `test(login, uid)` says whether that message belongs here. Ids are 16 hex:
    the tag, 7 hex of the login's UIDVALIDITY, then the All Mail UID, so they stay put when mail moves between folders.
    """

    def __init__(self, address, parts, inbox, own=None, router=None):
        self.address = address
        self.parts = parts
        self.inbox = set(inbox)
        self.own = own                  # the Proton login this mailbox writes and sends as
        self.router = router
        self.sent_raw = {}              # drafts saved from here: the message as the website built it (Proton rewrites the stored copy)
        self.lock = threading.Lock()
        self.state_file = os.path.join(HOME, 'view-' + hashlib.sha1(address.encode()).hexdigest()[:10] + '.json')
        st = load_json(self.state_file)
        self.hid = int(st.get('hid') or int(time.time() * 1000))
        self.base = int(st.get('base') or self.hid)
        self.changes = [tuple(c) for c in st.get('changes', [])]
        self.snap = st.get('snap', {})
        self.uvs = st.get('uvs', {})

    def hexid(self, tag, login, uid): return '%x%07x%08x' % (tag, (login.uv or 0) & 0xfffffff, uid)

    def tag_of(self, login):
        return next(t for t, l, _ in self.parts if l is login)

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
            save_json(self.state_file, {'hid': self.hid, 'base': self.base, 'changes': self.changes, 'snap': snap, 'uvs': uvs})

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
        q_ = one(params, 'q', '') or ''
        words, inbox, days, nodraft = [], False, None, False
        for tok in q_.split():
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

    def thread_members(self, tid):
        got = sorted([(l.meta[u]['date'], t, l, u) for t, l, u in self.members() if l.thread_of(u) == tid], key=lambda r: r[0])
        if not got: raise Fail(404)
        return got

    def thread(self, tid, params):
        self.refresh()
        members = self.thread_members(tid)
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

    # ── changes (the website only asks for these from a person's own click) ──
    def where(self, login, uid):
        """(the folder the message lives in, every location folder it is in). Inbox first, then anything but Sent / Drafts."""
        locs = sorted(f for f in login.folders_of(uid) if f in LOCS or f.startswith('Folders/'))
        inbox = [f for f in locs if f in self.inbox]
        if inbox:
            return inbox[0], locs
        rest = [f for f in locs if f not in ('Sent', 'Drafts')]
        return (rest or locs or [None])[0], locs

    def move(self, login, uid, src, dest):
        login.move(uid, src, dest)
        self.router.note(login, uid, src, self.address)

    def came_from(self, login, uid):
        return self.router.moved.get(login.meta[uid]['iid'])

    def modify_one(self, login, uid, add, remove):
        add, remove = set(add), set(remove)
        names = {lid(f): f for f in login.folders}
        known = {'UNREAD', 'STARRED', 'INBOX', 'SPAM'}
        if any(x not in known and x not in names for x in add | remove):
            raise Fail(400, 'Proton does not have that label')
        if add & remove:
            raise Fail(400, 'a label cannot be put on and taken off at once')
        if 'UNREAD' in add: login.set_flag(uid, '\\Seen', False)
        if 'UNREAD' in remove: login.set_flag(uid, '\\Seen', True)
        if 'STARRED' in add: login.set_flag(uid, '\\Flagged', True)
        if 'STARRED' in remove: login.set_flag(uid, '\\Flagged', False)
        here, locs = self.where(login, uid)
        dest = None
        for x in sorted(add):
            if x == 'SPAM': dest = 'Spam'
            elif names.get(x, '').startswith('Folders/'): dest = names[x]
        if dest is None and 'INBOX' in add and not any(f in self.inbox for f in locs):
            back = self.came_from(login, uid)
            dest = back if back in self.inbox else 'INBOX'
        if dest is None and 'SPAM' in remove and 'Spam' in locs:
            back = self.came_from(login, uid)
            dest = back if back and back not in ('Spam', 'Trash') else 'Archive'
        if dest is None and 'INBOX' in remove and any(f in self.inbox for f in locs):
            dest = 'Archive'
        if dest is None and any(names.get(x, '').startswith('Folders/') and names[x] in locs for x in remove):
            dest = 'Archive'
        if dest and here and dest not in locs:
            self.move(login, uid, here, dest)
        for x in sorted(add):
            f = names.get(x, '')
            if f.startswith('Labels/') and f not in login.folders_of(uid):
                login.add_label(uid, f)
        for x in sorted(remove):
            f = names.get(x, '')
            if f.startswith('Labels/') and f in login.folders_of(uid):
                login.drop_label(uid, f, self.where(login, uid)[0])

    def trash_one(self, login, uid):
        here, locs = self.where(login, uid)
        if here and 'Trash' not in locs:
            self.move(login, uid, here, 'Trash')

    def untrash_one(self, login, uid):
        here, locs = self.where(login, uid)
        if 'Trash' not in locs:
            return
        back = self.came_from(login, uid)
        if back in ('Sent', 'Drafts'):
            try:
                return self.move(login, uid, 'Trash', back)
            except Fail:
                pass                      # Proton keeps some folders for itself; Archive then
        self.move(login, uid, 'Trash', back if back and back not in ('Trash', 'Spam', 'Sent', 'Drafts') else 'Archive')

    def change(self, what, targets, body):
        body = body if isinstance(body, dict) else {}
        add, remove = body.get('addLabelIds') or [], body.get('removeLabelIds') or []
        if not isinstance(add, list) or not isinstance(remove, list) or len(add) + len(remove) > 20:
            raise Fail(400, 'bad labels')
        for _, login, uid in targets:
            if what == 'modify': self.modify_one(login, uid, [str(x) for x in add], [str(x) for x in remove])
            elif what == 'trash': self.trash_one(login, uid)
            else: self.untrash_one(login, uid)
        self.refresh()

    def short(self, tag, login, uid):
        return {'id': self.hexid(tag, login, uid), 'threadId': login.thread_of(uid), 'labelIds': self.labels(login, uid)}

    # ── sending and drafts ──
    def checked(self, raw):
        """Who it goes to. It must be from this mailbox's own address."""
        sender, rc = recipients(raw)
        if sender.lower() != self.address:
            raise Fail(400, 'Proton only sends this mailbox as %s.' % self.address)
        bad = [a for a in rc if not ADDR_RE.match(a)]
        if not rc or bad:
            raise Fail(400, 'Check the addresses.' if bad else 'Add who it is going to.')
        if len(rc) > 100:
            raise Fail(400, 'That is too many addresses for one message.')
        return sender, rc

    def send(self, body):
        raw = raw_of(body)
        sender, rc = self.checked(raw)
        self.own.smtp_send(without_headers(raw, (b'bcc',)), sender, rc)
        log('sent from', self.address[:3] + '…', 'to', len(rc), 'recipient(s)')
        return {}

    def draft_save(self, body, replace=None):
        msg = body.get('message') if isinstance(body, dict) else None
        raw = raw_of(msg)
        sender, _ = recipients(raw)
        if sender.lower() != self.address:
            raise Fail(400, 'Proton only saves drafts for this mailbox as %s.' % self.address)
        old = self.resolve(replace) if replace else None
        if old and 'Drafts' not in old[0].folders_of(old[1]):
            raise Fail(404)
        uid = self.own.append_draft(raw)
        if old:
            self.move(old[0], old[1], 'Drafts', 'Trash')      # the old copy, never deleted for good
            self.sent_raw.pop(replace, None)
        self.refresh()
        if uid is None:
            return {}
        hid = self.hexid(self.tag_of(self.own), self.own, uid)
        self.sent_raw[hid] = raw
        while len(self.sent_raw) > 50:
            self.sent_raw.pop(next(iter(self.sent_raw)))
        return {'id': hid, 'message': {'id': hid, 'threadId': self.own.thread_of(uid)}}

    def draft_send(self, body):
        hid = str(body.get('id', '')) if isinstance(body, dict) else ''
        login, uid = self.resolve(hid)
        if 'Drafts' not in login.folders_of(uid):
            raise Fail(404)
        raw = self.sent_raw.get(hid) or without_headers(login.raw(uid), (b'x-pm-internal-id', b'x-pm-date', b'x-pm-external-id', b'x-pm-content-encryption', b'x-pm-origin'))
        sender, rc = self.checked(raw)
        self.own.smtp_send(without_headers(raw, (b'bcc',)), sender, rc)
        log('sent a draft from', self.address[:3] + '…', 'to', len(rc), 'recipient(s)')
        self.sent_raw.pop(hid, None)
        try:
            self.move(login, uid, 'Drafts', 'Trash')           # sent: the draft copy goes to Trash, never deleted for good
        except Fail:
            pass
        self.refresh()
        return {}

    def drafts(self):
        self.refresh()
        got = sorted([(l.meta[u]['date'], t, l, u) for t, l, u in self.members() if 'Drafts' in l.folders_of(u)], key=lambda r: r[0], reverse=True)[:100]
        return {'drafts': [{'id': self.hexid(t, l, u), 'message': {'id': self.hexid(t, l, u), 'threadId': l.thread_of(u)}} for _, t, l, u in got]}

    def draft(self, hid, params):
        login, uid = self.resolve(hid)
        if 'Drafts' not in login.folders_of(uid):
            raise Fail(404)
        return {'id': hid, 'message': self.message(hid, params)}

    # ── labels ──
    @staticmethod
    def label_name(v):
        s = re.sub(r'\s+', ' ', str(v or '')).strip()
        if not s or len(s) > 100 or '/' in s or re.search(r'[\x00-\x1f"\\]', s):
            raise Fail(400, 'A Proton label name cannot be empty or hold / or quotes.')
        return s

    def label_by_id(self, label_id):
        f = next((f for f in self.own.folders if lid(f) == label_id), None)
        if not f:
            raise Fail(404)
        if not f.startswith('Labels/'):
            raise Fail(400, 'Proton folders can only be renamed or deleted in Proton itself.')
        return f

    def label_create(self, body):
        name = self.label_name((body or {}).get('name'))
        f = 'Labels/' + name
        if f not in self.own.folders:
            self.own.create_folder(f)
            for _, login, _ in self.parts:
                login.refreshed = 0
        self.refresh()
        return {'id': lid(f), 'name': name, 'type': 'user'}

    def handle(self, job):
        method, path, params, body = job.get('method', 'GET'), job.get('path', ''), job.get('params') or {}, job.get('body')
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
            if path == 'drafts': return self.drafts()
            mm = re.fullmatch(r'drafts/([0-9a-f]{16})', path)
            if mm: return self.draft(mm.group(1), params)
        elif method == 'POST':
            mm = re.fullmatch(r'messages/([0-9a-f]{16})/(modify|trash|untrash)', path)
            if mm:
                self.refresh()
                login, uid = self.resolve(mm.group(1))
                tag = self.tag_of(login)
                self.change(mm.group(2), [(tag, login, uid)], body)
                return self.short(tag, login, uid)
            mm = re.fullmatch(r'threads/([0-9a-f]{16})/(modify|trash|untrash)', path)
            if mm:
                self.refresh()
                targets = [(t, l, u) for _, t, l, u in self.thread_members(mm.group(1))]
                self.change(mm.group(2), targets, body)
                return {'id': mm.group(1), 'messages': [self.short(t, l, u) for t, l, u in targets]}
            if path == 'messages/send': return self.send(body)
            if path == 'drafts': return self.draft_save(body)
            if path == 'drafts/send': return self.draft_send(body)
            if path == 'labels': return self.label_create(body)
        elif method == 'PUT':
            mm = re.fullmatch(r'drafts/([0-9a-f]{16})', path)
            if mm: return self.draft_save(body, replace=mm.group(1))
        elif method == 'PATCH':
            mm = re.fullmatch(r'labels/(Label_[0-9a-f]{12})', path)
            if mm:
                old = self.label_by_id(mm.group(1))
                new = 'Labels/' + self.label_name((body or {}).get('name'))
                if new != old:
                    self.own.rename_folder(old, new)
                    for _, login, _ in self.parts:
                        login.refreshed = 0
                self.refresh()
                return {'id': lid(new), 'name': new.split('/', 1)[1], 'type': 'user'}
        elif method == 'DELETE':
            mm = re.fullmatch(r'labels/(Label_[0-9a-f]{12})', path)
            if mm:
                self.own.delete_folder(self.label_by_id(mm.group(1)))
                for _, login, _ in self.parts:
                    login.refreshed = 0
                self.refresh()
                return {}
        raise Fail(501, 'not for Proton')


def build_views(cfg):
    """The RPMail mailboxes, split the same way the local RPMail splits them (see the note at the top)."""
    global SMTP_PORT
    SMTP_PORT = int(cfg.get('bridge_smtp_port', SMTP_PORT))
    logins, boxes = [], []
    for a in cfg.get('accounts', []):
        if a.get('type') != 'proton': continue
        login = Login(a)
        logins.append(login)
        for b in a.get('boxes', []):
            boxes.append((login, b))
    homes = [(b['folder_home'], b['address'].lower()) for _, b in boxes if b.get('folder_home')]
    defaults = {login.user: b['address'].lower() for login, b in boxes if b.get('default')}
    router = Router(homes, defaults)
    views = {}
    for login, b in boxes:
        addr = b['address'].lower()
        if not (b.get('folder_home') or b.get('default')): continue
        # Every login is looked at (tag = the login's place in the list, so ids never change); the router decides.
        parts = [(i, other, lambda l, u, a=addr: router.owner(l, u) == a) for i, other in enumerate(logins)]
        inbox = ['INBOX'] + list(b.get('inbox_folders', []))
        views[addr] = View(addr, parts, inbox, own=login, router=router)
    return logins, views


def post(secret, body, timeout):
    req = urllib.request.Request(SITE + '/api/rpmail/relay', data=json.dumps(body).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secret, 'User-Agent': 'rpmail-relay/3'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def age_of(job):
    """Seconds since the website wrote the job (None if it did not say)."""
    s = str(job.get('created_at') or '')
    mm = re.match(r'(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d:?\d\d)?$', s)
    if not mm:
        return None
    y, mo, d, h, mi, se = (int(x) for x in mm.groups()[:6])
    t = calendar.timegm((y, mo, d, h, mi, se, 0, 0, 0))
    z = mm.group(7)
    if z and z != 'Z':
        sign = 1 if z[0] == '+' else -1
        zz = z[1:].replace(':', '')
        t -= sign * (int(zz[:2]) * 3600 + int(zz[2:]) * 60)
    return time.time() - t


SENDS = ('messages/send', 'drafts/send')


def main():
    secret = keychain('rpmail-relay', 'secret')
    if not secret:
        log('no shared secret in the Keychain (service rpmail-relay, account secret); stopping'); sys.exit(1)
    logins, views = build_views(load_json(os.path.expanduser('~/rps-inbox/config.json')))
    addresses = list(views)
    log('started for', len(addresses), 'Proton mailboxes from', len(logins), 'logins (reads and changes)')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=6)
    out = queue.Queue()

    def body_of(job):
        """A large job (a message with attachments) comes in parts; fetched one at a time."""
        b = job.get('body')
        if not (isinstance(b, dict) and isinstance(b.get('_parts'), int)):
            return b
        text = ''
        for i in range(min(b['_parts'], 40)):
            r = post(secret, {'addresses': addresses, 'body_of': {'job': job['id'], 'seq': i}}, 60)
            if not isinstance(r.get('data'), str):
                raise Fail(410, 'the website no longer has that job')
            text += r['data']
        return json.loads(text)

    def work(job):
        try:
            view = views.get(str(job.get('address', '')).lower())
            if not view: raise Fail(404)
            if job.get('method') == 'POST' and job.get('path') in SENDS:
                age = age_of(job)
                if age is None or age > SEND_TOO_OLD:
                    raise Fail(408, 'too late to send')
            job = dict(job, body=body_of(job))
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
