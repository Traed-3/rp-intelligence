#!/usr/bin/env python3
"""Checks for the Proton helper's filing rules, against a stand-in for Proton Bridge (no real mail is touched).

Run:  python3 -I scripts/rpmail-relay/test_relay.py
"""
import base64, os, sys, tempfile, time, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import relay  # noqa: E402

relay.HOME = tempfile.mkdtemp(prefix='rpmail-relay-test-')
relay.log = lambda *a: None

WORK, PERS = 'tdodson.rp@proton.me', 'finance.trae@proton.me'


class FakeLogin(relay.Login):
    """A Login whose Bridge calls only change the in-memory index, and note what was asked."""

    def __init__(self, user):
        super().__init__({'user': user, 'keychain': []})
        self.uv = 1234567
        self.calls = []
        self.folders = ['Folders/RPS', 'Folders/RPS/Project Folders', 'Folders/Bills', 'Labels/Urgent']
        self.refreshed = time.time()

    def add(self, uid, iid, folders, flags='\\Seen', refs='', mid=None):
        self.meta[uid] = {'iid': iid, 'mid': mid or '<%s@x>' % iid, 'refs': refs, 'irt': '', 'date': uid * 1000, 'flags': flags}
        self.labels_of[iid] = set(folders)

    def refresh(self, force=False): pass

    def set_flag(self, uid, flag, on):
        self.calls.append(('flag', uid, flag, on))
        fl = set(self.meta[uid]['flags'].split())
        (fl.add if on else fl.discard)(flag)
        self.meta[uid]['flags'] = ' '.join(sorted(fl))

    def move(self, uid, src, dest):
        iid = self.meta[uid]['iid']
        assert src in self.labels_of[iid], (src, self.labels_of[iid])
        self.calls.append(('move', uid, src, dest))
        self.labels_of[iid] = (self.labels_of[iid] - {src}) | {dest}

    def add_label(self, uid, label):
        self.calls.append(('label+', uid, label))
        self.labels_of[self.meta[uid]['iid']] |= {label}

    def drop_label(self, uid, label, home):
        self.calls.append(('label-', uid, label, home))
        self.labels_of[self.meta[uid]['iid']] -= {label}

    def smtp_send(self, raw, sender, rcpts):
        self.calls.append(('send', sender, tuple(rcpts), raw))
        return []

    def append_draft(self, raw):
        uid = max(self.meta) + 1
        self.add(uid, 'draft%05d' % uid, {'Drafts'})
        self.calls.append(('draft', uid))
        return uid

    def create_folder(self, name): self.calls.append(('create', name)); self.folders.append(name)
    def rename_folder(self, old, new): self.calls.append(('rename', old, new))
    def delete_folder(self, name): self.calls.append(('delete', name))


def views():
    w, p = FakeLogin(WORK), FakeLogin(PERS)
    homes, defaults = [('Folders/RPS', WORK)], {WORK: WORK, PERS: PERS}
    for f in os.listdir(relay.HOME):
        os.remove(os.path.join(relay.HOME, f))
    router = relay.Router(homes, defaults)
    logins = [w, p]
    out = {}
    for login, addr, inbox in ((w, WORK, ['INBOX', 'Folders/RPS']), (p, PERS, ['INBOX'])):
        parts = [(i, other, lambda l, u, a=addr: router.owner(l, u) == a) for i, other in enumerate(logins)]
        out[addr] = relay.View(addr, parts, inbox, own=login, router=router)
    return w, p, out[WORK], out[PERS]


def raw(text):
    return base64.urlsafe_b64encode(text.replace('\n', '\r\n').encode()).decode().rstrip('=')


def ids(view):
    return sorted(view.hexid(t, l, u) for t, l, u in view.members())


class Filing(unittest.TestCase):
    def setUp(self):
        self.w, self.p, self.work, self.pers = views()
        self.p.add(10, 'iidPersonalFiledRPS', {'Folders/RPS'})            # mail to the personal address, filed under RPS: work mail
        self.p.add(11, 'iidPersonalInbox01', {'INBOX'})
        self.w.add(20, 'iidWorkInboxMail01', {'INBOX'}, flags='')
        self.w.add(21, 'iidWorkSentMail001', {'Sent'})
        self.wid = self.work.hexid(1, self.p, 10)

    def job(self, view, method, path, body=None):
        return view.handle({'method': method, 'path': path, 'params': {}, 'body': body})

    def test_archiving_work_mail_keeps_it_in_work_proton(self):
        self.assertIn(self.wid, ids(self.work))
        r = self.job(self.work, 'POST', 'messages/%s/modify' % self.wid, {'removeLabelIds': ['INBOX']})
        self.assertEqual(self.p.calls[-1], ('move', 10, 'Folders/RPS', 'Archive'))
        self.assertNotIn('INBOX', r['labelIds'])
        self.assertIn(self.wid, ids(self.work))                                # still Work Proton's
        self.assertNotIn(self.pers.hexid(1, self.p, 10), ids(self.pers))       # and not Personal Proton's
        # Undo: back where it was, and the hold is let go
        self.job(self.work, 'POST', 'messages/%s/modify' % self.wid, {'addLabelIds': ['INBOX']})
        self.assertEqual(self.p.calls[-1], ('move', 10, 'Archive', 'Folders/RPS'))
        self.assertEqual(self.work.router.holds, {})
        # Remembered across a restart of the helper
        self.job(self.work, 'POST', 'messages/%s/trash' % self.wid)
        again = relay.Router(self.work.router.homes, self.work.router.defaults)
        self.assertEqual(again.holds.get('iidPersonalFiledRPS'), WORK)
        self.assertEqual(again.moved.get('iidPersonalFiledRPS'), 'Folders/RPS')

    def test_personal_archive_and_inbox(self):
        pid = self.pers.hexid(1, self.p, 11)
        self.job(self.pers, 'POST', 'messages/%s/modify' % pid, {'removeLabelIds': ['INBOX']})
        self.assertEqual(self.p.calls[-1], ('move', 11, 'INBOX', 'Archive'))
        self.assertEqual(self.pers.router.holds, {})                           # Archive is still Personal: nothing to hold
        self.job(self.pers, 'POST', 'messages/%s/modify' % pid, {'addLabelIds': ['INBOX']})
        self.assertEqual(self.p.calls[-1], ('move', 11, 'Archive', 'INBOX'))

    def test_trash_and_untrash_go_back_where_they_were(self):
        self.job(self.work, 'POST', 'messages/%s/trash' % self.wid)
        self.assertEqual(self.p.calls[-1], ('move', 10, 'Folders/RPS', 'Trash'))
        self.assertIn(self.wid, ids(self.work))
        self.job(self.work, 'POST', 'messages/%s/untrash' % self.wid)
        self.assertEqual(self.p.calls[-1], ('move', 10, 'Trash', 'Folders/RPS'))
        # Trash twice does nothing more
        self.job(self.work, 'POST', 'messages/%s/trash' % self.wid)
        n = len(self.p.calls)
        self.job(self.work, 'POST', 'messages/%s/trash' % self.wid)
        self.assertEqual(len(self.p.calls), n)

    def test_spam_and_back(self):
        self.job(self.work, 'POST', 'messages/%s/modify' % self.wid, {'addLabelIds': ['SPAM'], 'removeLabelIds': ['INBOX']})
        self.assertEqual(self.p.calls[-1], ('move', 10, 'Folders/RPS', 'Spam'))
        self.job(self.work, 'POST', 'messages/%s/modify' % self.wid, {'addLabelIds': ['INBOX'], 'removeLabelIds': ['SPAM']})
        self.assertEqual(self.p.calls[-1], ('move', 10, 'Spam', 'Folders/RPS'))

    def test_read_star_and_labels(self):
        mid = self.work.hexid(0, self.w, 20)
        self.job(self.work, 'POST', 'messages/%s/modify' % mid, {'removeLabelIds': ['UNREAD']})
        self.job(self.work, 'POST', 'messages/%s/modify' % mid, {'addLabelIds': ['STARRED']})
        self.assertEqual(self.w.calls[:2], [('flag', 20, '\\Seen', True), ('flag', 20, '\\Flagged', True)])
        self.assertIn('STARRED', self.work.labels(self.w, 20))
        self.w.labels_of['iidWorkInboxMail01'] |= {'Starred'}                  # Bridge's Starred folder catches up a minute late
        self.job(self.work, 'POST', 'messages/%s/modify' % mid, {'removeLabelIds': ['STARRED']})
        self.assertNotIn('STARRED', self.work.labels(self.w, 20))              # so the flag alone decides
        urgent = relay.lid('Labels/Urgent')
        self.job(self.work, 'POST', 'messages/%s/modify' % mid, {'addLabelIds': [urgent]})
        self.assertEqual(self.w.calls[-1], ('label+', 20, 'Labels/Urgent'))
        self.job(self.work, 'POST', 'messages/%s/modify' % mid, {'removeLabelIds': [urgent]})
        self.assertEqual(self.w.calls[-1], ('label-', 20, 'Labels/Urgent', 'INBOX'))   # moved back to its own folder
        # A Proton folder used as a label is a move
        bills = relay.lid('Folders/Bills')
        self.job(self.work, 'POST', 'messages/%s/modify' % mid, {'addLabelIds': [bills], 'removeLabelIds': ['INBOX']})
        self.assertEqual(self.w.calls[-1], ('move', 20, 'INBOX', 'Folders/Bills'))

    def test_refuses_what_it_does_not_know(self):
        mid = self.work.hexid(0, self.w, 20)
        for body in ({'addLabelIds': ['TRASH']}, {'addLabelIds': ['Label_000000000000']}, {'addLabelIds': ['UNREAD'], 'removeLabelIds': ['UNREAD']}):
            with self.assertRaises(relay.Fail) as e:
                self.job(self.work, 'POST', 'messages/%s/modify' % mid, body)
            self.assertEqual(e.exception.code, 400)
        with self.assertRaises(relay.Fail) as e:
            self.job(self.work, 'PATCH', 'labels/' + relay.lid('Folders/RPS'), {'name': 'x'})
        self.assertEqual(e.exception.code, 400)                                # Proton folders are never renamed from here
        with self.assertRaises(relay.Fail) as e:
            self.job(self.work, 'DELETE', 'labels/' + relay.lid('Folders/RPS'))
        self.assertEqual(e.exception.code, 400)
        with self.assertRaises(relay.Fail):
            self.job(self.pers, 'POST', 'messages/%s/trash' % self.pers.hexid(1, self.p, 10))   # not Personal's to touch
        self.assertEqual([c for c in self.p.calls if c[0] == 'move'], [])

    def test_thread_moves_every_message_in_it(self):
        self.w.add(30, 'iidThreadFirst0001', {'INBOX'}, mid='<root@x>')
        self.w.add(31, 'iidThreadReply0001', {'INBOX'}, refs='<root@x>')
        tid = self.w.thread_of(30)
        self.assertEqual(tid, self.w.thread_of(31))
        r = self.job(self.work, 'POST', 'threads/%s/modify' % tid, {'removeLabelIds': ['INBOX']})
        self.assertEqual(len(r['messages']), 2)
        self.assertEqual(sorted(c[1] for c in self.w.calls if c[0] == 'move'), [30, 31])


class FolderList(unittest.TestCase):
    def test_each_mailbox_shows_its_own_folders_like_the_local_rpmail(self):
        w, p, work, pers = views()
        for login in (w, p):
            login.folders = ['Folders/RPS', 'Folders/RPS/Project Folders', 'Folders/Personal', 'Folders/Personal/Turbo Tenant', 'Folders/Poker', 'Labels/Urgent']
        w.add(1, 'iidWorkInTurboTen1', {'Folders/Personal/Turbo Tenant'})     # work mail filed in a personal folder
        p.add(2, 'iidPersonalPoker01', {'Folders/Poker'})
        p.add(3, 'iidPersonalLabel01', {'INBOX', 'Labels/Urgent'})
        names = lambda v: [l['name'] for l in v.labels_list()['labels'] if l['type'] == 'user']
        # Work: its own RPS tree, plus the folders its mail is in (and their parents). Not Poker.
        self.assertEqual(names(work), ['Personal', 'Personal/Turbo Tenant', 'RPS', 'RPS/Project Folders'])
        # Personal: every folder outside Work's RPS tree (it has no home of its own), and the labels on its mail.
        self.assertEqual(names(pers), ['Personal', 'Personal/Turbo Tenant', 'Poker', 'Urgent'])


class Sending(unittest.TestCase):
    def setUp(self):
        self.w, self.p, self.work, self.pers = views()
        self.w.add(1, 'iidSomethingOld001', {'INBOX'})

    def test_send_goes_out_as_the_mailbox_with_bcc_taken_off(self):
        m = 'From: "Trae" <%s>\nTo: a@example.com, B <b@example.com>\nCc: c@example.com\nBcc: d@example.com\nSubject: Hi\n\nHello\n' % WORK
        self.assertEqual(self.work.handle({'method': 'POST', 'path': 'messages/send', 'body': {'raw': raw(m)}}), {})
        kind, sender, rc, sent = self.w.calls[-1]
        self.assertEqual((kind, sender), ('send', WORK))
        self.assertEqual(rc, ('a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'))
        self.assertNotIn(b'Bcc', sent)
        self.assertIn(b'\r\n\r\nHello', sent)

    def test_send_refuses_another_from_and_bad_addresses(self):
        for m in ('From: %s\nTo: a@example.com\n\nx' % PERS, 'From: %s\nTo: not an address\n\nx' % WORK, 'From: %s\nSubject: x\n\nx' % WORK):
            with self.assertRaises(relay.Fail) as e:
                self.work.handle({'method': 'POST', 'path': 'messages/send', 'body': {'raw': raw(m)}})
            self.assertEqual(e.exception.code, 400)
        self.assertEqual([c for c in self.w.calls if c[0] == 'send'], [])

    def test_drafts_save_replace_and_send(self):
        m = 'From: %s\nTo: a@example.com\nSubject: Draft\n\nfirst' % WORK
        r = self.work.handle({'method': 'POST', 'path': 'drafts', 'body': {'message': {'raw': raw(m)}}})
        first = r['id']
        self.assertEqual([d['id'] for d in self.work.drafts()['drafts']], [first])
        r2 = self.work.handle({'method': 'PUT', 'path': 'drafts/' + first, 'body': {'id': first, 'message': {'raw': raw(m.replace('first', 'second'))}}})
        self.assertNotEqual(r2['id'], first)
        self.assertEqual(self.w.calls[-1][0:2], ('move', int(first[8:], 16)))     # the old copy went to Trash
        self.assertEqual(self.w.calls[-1][3], 'Trash')
        self.work.handle({'method': 'POST', 'path': 'drafts/send', 'body': {'id': r2['id']}})
        sends = [c for c in self.w.calls if c[0] == 'send']
        self.assertEqual(len(sends), 1)
        self.assertIn(b'second', sends[0][3])
        self.assertEqual(self.work.drafts()['drafts'], [])

    def test_a_late_send_is_refused(self):
        now = time.strftime('%Y-%m-%dT%H:%M:%S.123456+00:00', time.gmtime())
        old = time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(time.time() - 120))
        self.assertLess(relay.age_of({'created_at': now}), 5)
        self.assertGreater(relay.age_of({'created_at': old}), 100)
        self.assertGreater(relay.age_of({'created_at': time.strftime('%Y-%m-%dT%H:%M:%S-05:00', time.localtime(time.time() - 120)) if time.timezone == 18000 else old}), 100)
        self.assertIsNone(relay.age_of({}))

    def test_without_headers_leaves_the_rest_alone(self):
        m = b'From: a@x.com\r\nBcc: one@x.com,\r\n two@x.com\r\nSubject: s\r\n\r\nBcc: this line is the body\r\n'
        self.assertEqual(relay.without_headers(m, (b'bcc',)), b'From: a@x.com\r\nSubject: s\r\n\r\nBcc: this line is the body\r\n')


if __name__ == '__main__':
    unittest.main(verbosity=1)
