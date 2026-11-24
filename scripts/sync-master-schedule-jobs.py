#!/usr/bin/env python3
"""
Keep the app's construction jobs (con_jobs) in step with Starsky's Master Schedule. One way: master -> app.
The workbook is only read, never written.

  python3 scripts/sync-master-schedule-jobs.py "<path to .xlsm>" [--apply] [--json report.json]

Run by scripts/master-schedule-hourly.sh right after sync-master-schedule-log.py, so every Job List row already has
its con_master_schedule_log row. Each run:

  1. Job List: every row (a site in column B) is linked to an app job, in this order:
       a. the job the log row was linked to on an earlier run;
       b. its WO# (WOT…/FWKD…) on any job, at any site (open jobs first);
       c. an open job at the same site with no WO# of its own whose W/O text ("John M", "Disp replacement x 4")
          and/or scope match the row;
     and a new job is added when nothing matches. Starsky lists some jobs twice (status section + day board);
     all rows for one job are read together and the furthest-along stage wins.
  2. Changes only: the stage text each row last pushed is kept in con_master_schedule_log.synced_stage. A job is
     only touched when Starsky changed one of its rows (or the row is new), so moves made in the app — the email
     feed, the 6 AM job routine, a person — stand until he edits that row again.
     A finished app job is reopened only when the master puts it back before the work (Needs Scheduled, In-Progress…),
     never for an invoicing row, and never when the WO# is also on Completed Jobs (then it's a second scope).
  3. Completed Jobs: the first time a row shows up there, the open app job with that WO# (or, for rows without a
     WO#, the same site + W/O text) is marked Complete — unless the WO# is still on the Job List. WOs that were on the
     Job List (per the log) but never got an app job are added as finished jobs.
  4. date_received is filled from the first day the master showed the job, so job numbers get built.
  Jobs with master_sync_hold = true are never changed. The site number on a job is never rewritten (master typos
  like "SU-79330" happen); mismatches are only reported.

Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local next to the repo root.
"""
import sys, re, json, hashlib, datetime, importlib.util, collections, urllib.request, urllib.error, urllib.parse
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit('pip3 install --user openpyxl')

HERE = Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ms = _load('ms_import', 'import-master-schedule.py')      # env(), rest(), COMPANY_ID, site_key() used in log fingerprints
mlog = _load('ms_log', 'sync-master-schedule-log.py')     # text() — the log's own cell normaliser

COMPANY_ID = ms.COMPANY_ID
WO_RE = re.compile(r'\b(WOT\d{7}|FWKD\d{7})\b', re.I)

# Pipeline order: when one job has several rows, the furthest along wins.
STAGE_ORDER = ['survey', 'quoting', 'permitting', 'material_ordering', 'on_hold', 'needs_scheduled', 'return_needed',
               'scheduled', 'in_progress', 'overspill_program', 'close_out', 'invoicing', 'complete']
BEFORE_WORK = {'survey', 'quoting', 'permitting', 'material_ordering', 'on_hold', 'needs_scheduled', 'return_needed',
               'scheduled', 'in_progress'}
# Lead words in the Stage column. Checked before the cell color.
TEXT_RULES = [
    (r'^in[- ]?progress', 'in_progress'), (r'^(needs? (to be )?scheduled|re-?schedul)', 'needs_scheduled'),
    (r'^scheduled', 'scheduled'), (r'^complete', 'complete'), (r'^(on hold|not awarded|declined)', 'on_hold'),
    (r'^waiting on (approval|po|quote)', 'quoting'), (r'^quote', 'quoting'),
    (r'^(need|needs|waiting for|waiting on) permits?|^permit|\bpnf\b', 'permitting'), (r'^waiting on', 'material_ordering'),
    (r'^return', 'return_needed'),
    (r'^(need invoiced|needs invoiced|prepped & sent|prepped and sent|sent to )', 'invoicing'),
    (r'^(sd will invoice|sd close ?out|close ?out)', 'close_out'), (r'^overspill', 'overspill_program'), (r'^survey', 'survey'),
]
# The color key in Job List B1:D4 (label -> stage); the fills are read from the sheet each run.
LEGEND = {'on hold': 'on_hold', 'in-progress': 'in_progress', 'overspill program': 'overspill_program',
          'return needed': 'return_needed', 'needs scheduled': 'needs_scheduled', 'need invoiced': 'invoicing',
          'close out/invoice': 'close_out', 'scheduled': 'scheduled', 'complete': 'complete',
          'permitting': 'permitting', 'quote': 'quoting', 'waiting on material': 'material_ordering'}
STOP = set('the a an and of for to on in at with w per new old x disp replace replacement repair job site store'.split())


def norm(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def wos(*txt):
    return sorted({m.upper() for t in txt if t for m in WO_RE.findall(str(t))})


def site_key(raw):
    """Comparison key. 'SU-7415 (80003090)'->SU-7415, 'SU -1800 (80015635)'->SU-1800, 'Global 3633'->3633, 'Wawa 8617'->8617."""
    s = re.sub(r'\([^)]*\)', ' ', norm(raw)).strip()
    m = re.match(r'^(SU|IP|CP|CPG|F)\s*-?\s*(\d{2,5})P?\b', s, re.I)       # 'SU-7100P' is SU-7100
    if m:
        p = m.group(1).upper()
        return (p + m.group(2)) if p == 'IP' else f'{p}-{m.group(2)}'
    m = re.match(r'^(?:Global|Wawa|Sheetz|Sunoco)\s*-?\s*#?\s*(\d{2,5})\b', s, re.I)
    if m:
        return m.group(1)
    m = re.match(r'^(\d{3,5})\b', s)
    if m and '/' not in s:
        return m.group(1)
    return s.upper()


def app_site(raw):
    """How the app stores a new job's site: SU-1380, Wawa 8617, 3633 (+ brand Global), 40057, else the name without '(…)'."""
    s = re.sub(r'\s*\([^)]*\)\s*', ' ', norm(raw)).strip()
    m = re.match(r'^(SU|IP|CP|CPG|F)\s*-?\s*(\d{2,5})P?$', s, re.I)
    if m:
        p = m.group(1).upper()
        return ((p + m.group(2)) if p == 'IP' else f'{p}-{m.group(2)}'), {'SU': 'Sunoco'}.get(p)
    m = re.match(r'^(Global|Wawa|Sheetz)\s*-?\s*#?\s*(\d{2,5})$', s, re.I)
    if m:
        brand = m.group(1).title()
        return (m.group(2) if brand == 'Global' else f'{brand} {m.group(2)}'), brand
    if re.fullmatch(r'\d{5}', s):
        return s, '7-Eleven'
    return s, None


def wo_text_key(s):
    """W/O text with the WO#s taken out, for comparing 'Disp replacement x 4' with 'Disp replacement ×4'."""
    t = WO_RE.sub(' ', str(s or '')).lower().replace('×', 'x')
    t = re.sub(r'[^a-z0-9]+', ' ', t)
    t = re.sub(r'\bx (\d)', r'x\1', t)
    return norm(t)


def words(s):
    return {w for w in re.findall(r'[a-z0-9]{3,}', str(s or '').lower()) if w not in STOP}


def similar(a, b):
    A, B = words(a), words(b)
    return len(A & B) / len(A | B) if A and B else 0.0


def fill_key(cell):
    f = cell.fill
    if not f or f.fill_type is None:
        return ''
    c = f.fgColor
    if c.type == 'rgb' and isinstance(c.rgb, str):
        return c.rgb[-6:].upper()
    if c.type == 'theme':
        return f'th{c.theme}' + (('%+.1f' % c.tint) if c.tint else '')
    return ''


def read_legend(ws):
    out = {}
    for r in range(1, 5):
        for c in range(2, 5):
            cell = ws.cell(r, c)
            st = LEGEND.get(norm(cell.value).lower())
            if st and fill_key(cell):
                out[fill_key(cell)] = st
    return out


def master_stage(text, fk, legend):
    t = norm(text).lower()
    for rx, st in TEXT_RULES:
        if re.search(rx, t):
            return st
    # The color alone never finishes a job: Starsky shades some MDE/PNF rows the same green as COMPLETE.
    st = legend.get(fk)
    return None if st == 'complete' else st


def read_workbook(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb['Job List']
    legend = read_legend(ws)
    job_list = []
    for r in range(6, ws.max_row + 1):
        site_raw = mlog.text(ws.cell(r, 2).value)
        if not site_raw:
            continue
        wo, scope = mlog.text(ws.cell(r, 4).value), mlog.text(ws.cell(r, 8).value)
        # Same fingerprint as sync-master-schedule-log.py, so each row finds its log row.
        fp = hashlib.sha1(f'Job List|{ms.site_key(site_raw).upper()}|{wo.upper()}|{scope.upper()}'.encode()).hexdigest()
        stage_txt = mlog.text(ws.cell(r, 3).value)
        job_list.append({'row': r, 'fp': fp, 'site_raw': site_raw, 'key': site_key(site_raw), 'wo_txt': wo, 'wos': wos(wo),
                         'wo_text': wo_text_key(wo), 'stage_txt': stage_txt,
                         'stage': master_stage(stage_txt, fill_key(ws.cell(r, 3)), legend),
                         'scope': scope, 'address': mlog.text(ws.cell(r, 7).value)})
    cj = wb['Completed Jobs']
    completed = []
    for r in range(3, cj.max_row + 1):
        site_raw = mlog.text(cj.cell(r, 2).value)
        if not site_raw:
            continue
        stage_txt, wo = mlog.text(cj.cell(r, 3).value), mlog.text(cj.cell(r, 4).value)
        scope, address = mlog.text(cj.cell(r, 8).value), mlog.text(cj.cell(r, 7).value)
        key = site_key(site_raw)
        fp = hashlib.sha1(f'Completed Jobs|{key}|{wo.upper()}|{scope.upper()}|{stage_txt.upper()}'.encode()).hexdigest()
        completed.append({'row': r, 'fp': fp, 'site_raw': site_raw, 'key': key, 'stage_txt': stage_txt, 'wo_txt': wo,
                          'wos': wos(wo), 'wo_text': wo_text_key(wo), 'scope': scope, 'address': address})
    return job_list, completed, len(legend)


# ---------------------------------------------------------------- REST
class Api:
    def __init__(self, apply):
        e = ms.env()
        self.url, self.key, self.apply = e['NEXT_PUBLIC_SUPABASE_URL'], e['SUPABASE_SERVICE_ROLE_KEY'], apply

    def call(self, method, path, body=None, prefer='return=representation', rng=None):
        h = {'apikey': self.key, 'Authorization': f'Bearer {self.key}', 'Content-Type': 'application/json', 'Prefer': prefer}
        if rng:
            h.update({'Range-Unit': 'items', 'Range': rng})
        req = urllib.request.Request(f'{self.url}/rest/v1/{path}', data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=h)
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read() or b'null')
        except urllib.error.HTTPError as ex:
            raise SystemExit(f'{method} {path.split("?")[0]} -> HTTP {ex.code}: {ex.read()[:400].decode(errors="replace")}')

    def get_all(self, path):
        out, off = [], 0
        while True:
            rows = self.call('GET', path, rng=f'{off}-{off + 999}')
            out += rows
            if len(rows) < 1000:
                return out
            off += 1000

    def write(self, method, path, body=None, prefer='return=representation'):
        if not self.apply:
            return [{'id': '(dry-run)'}] if method == 'POST' else None
        return self.call(method, path, body, prefer)


def today_et():
    return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=5)).date()


# ---------------------------------------------------------------- sync
def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    apply = '--apply' in sys.argv
    json_out = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
    if json_out in args:
        args.remove(json_out)
    job_list, completed, legend_n = read_workbook(args[0])
    api = Api(apply)
    today = today_et().isoformat()
    md = today_et().strftime('%-m/%-d/%y')

    jobs = api.get_all(f'con_jobs?company_id=eq.{COMPANY_ID}&select=id,site_number,job_number,work_order_number,stage,status_detail,'
                       'scope_of_work,facility_address,date_received,project_start_date,master_sync_hold,created_at,updated_at')
    J = {j['id']: j for j in jobs}
    for j in jobs:
        j['key'] = site_key(j['site_number'])
        j['wos'] = wos(j['work_order_number'])
        j['wo_text'] = wo_text_key(j['work_order_number'])
    by_wo, by_key = collections.defaultdict(list), collections.defaultdict(list)
    for j in jobs:
        for w in j['wos']:
            by_wo[w].append(j)
        by_key[j['key']].append(j)

    logs = api.get_all(f'con_master_schedule_log?company_id=eq.{COMPANY_ID}&select=id,fingerprint,wo,site_key,site_raw,first_seen_at,'
                       'on_sheet,job_id,synced_stage')
    LOG = {l['fingerprint']: l for l in logs}
    # Identical rows (same site + W/O + scope) share one log row but can carry different stage text (33651 "SD close out"
    # and "COMPLETE"), so the log keeps all of that row's stage texts together.
    fp_text = collections.defaultdict(set)
    for r in job_list:
        fp_text[r['fp']].add(r['stage_txt'])
    fp_text = {fp: ' || '.join(sorted(v)) for fp, v in fp_text.items()}
    list_wos = {w for r in job_list for w in r['wos']}
    done_wos = {w for c in completed for w in c['wos']}
    rank = lambda st: STAGE_ORDER.index(st) if st in STAGE_ORDER else -1
    report = collections.defaultdict(list)

    # ---- 1. link every Job List row
    claimed = {}                                     # job id -> group key that claimed it this run
    links = {}                                       # row fp -> job id
    to_create = collections.OrderedDict()            # group key -> [rows]
    for r in sorted(job_list, key=lambda r: (not r['wos'], r['row'])):
        lg = LOG.get(r['fp'])
        gkey = ('WO', tuple(r['wos'])) if r['wos'] else ('TXT', r['key'], r['wo_text'] or '~' + ' '.join(sorted(words(r['scope'])))[:60])
        how, job = '', None
        if lg and lg.get('job_id') in J:
            job, how = J[lg['job_id']], 'log'
        if not job and r['wos']:
            cands = [j for w in r['wos'] for j in by_wo.get(w, [])]
            open_c = [j for j in cands if j['stage'] != 'complete']
            if open_c:
                job, how = max(open_c, key=lambda j: (set(j['wos']) == set(r['wos']), rank(j['stage']), j['updated_at'])), 'WO'
            elif cands and not (r['stage'] in BEFORE_WORK and set(r['wos']) & done_wos):
                # The WO's job is finished. If the WO is also on Completed Jobs and the row is before the work, it's a
                # second scope under the same WO (fall through to a new job); otherwise it's this job.
                job, how = max(cands, key=lambda j: j['updated_at']), 'WO (finished job)'
        if not job:
            pool = [j for j in by_key.get(r['key'], []) if j['stage'] != 'complete' and not j['wos']
                    and (claimed.get(j['id'], gkey) == gkey or (r['wo_text'] and j['wo_text'] == r['wo_text']))]
            scored = []
            for j in pool:
                same_txt = bool(r['wo_text']) and j['wo_text'] == r['wo_text']
                sim = similar(r['scope'] + ' ' + r['stage_txt'], (j['scope_of_work'] or '') + ' ' + (j['status_detail'] or ''))
                if (same_txt and (sim >= 0.15 or not r['scope'] or not j['scope_of_work'] or not r['wos'])) or sim >= 0.5:
                    scored.append((same_txt, sim, j['updated_at'], j))
            if scored:
                job, how = max(scored, key=lambda s: s[:3])[3], 'site + W/O text' if max(scored, key=lambda s: s[:3])[0] else 'site + scope'
        if job:
            links[r['fp']] = job['id']
            claimed.setdefault(job['id'], gkey)
            report['links'].append({'row': r['row'], 'site': r['site_raw'], 'wo': r['wo_txt'], 'how': how, 'job': job['job_number'] or job['site_number'],
                                    'job_id': job['id'], 'app_stage': job['stage'], 'master_stage': r['stage'], 'stage_txt': r['stage_txt'][:60]})
            if job['key'] != r['key']:
                report['site_mismatch'].append({'row': r['row'], 'master_site': r['site_raw'], 'app_site': job['site_number'], 'wo': r['wo_txt'], 'job_id': job['id']})
        else:
            to_create.setdefault(gkey, []).append(r)

    # ---- 1b. add the jobs the app doesn't have
    for gkey, rows in to_create.items():
        rows.sort(key=lambda r: rank(r['stage']) if r['stage'] else -1, reverse=True)
        lead = rows[0]
        site, brand = app_site(lead['site_raw'])
        first = min([LOG[r['fp']]['first_seen_at'][:10] for r in rows if r['fp'] in LOG] or [today])
        body = {'company_id': COMPANY_ID, 'site_number': site, 'gas_brand': brand, 'work_order_number': lead['wo_txt'] or None,
                'stage': lead['stage'] or 'needs_scheduled',
                'status_detail': lead['stage_txt'][:1000] or None, 'scope_of_work': next((r['scope'] for r in rows if r['scope']), None),
                'facility_address': next((r['address'] for r in rows if r['address']), None), 'date_received': first,
                'notes': f'Added from the Master Schedule (Job List row {lead["row"]}) on {md}.'}
        made = api.write('POST', 'con_jobs', body)
        jid = made[0]['id'] if made else None
        report['created'].append({'rows': [r['row'] for r in rows], 'site': site, 'wo': lead['wo_txt'], 'stage': body['stage'],
                                  'stage_txt': lead['stage_txt'][:60], 'date_received': first, 'job_id': jid})
        for r in rows:
            links[r['fp']] = jid
        if apply and jid:
            for r in rows:
                if r['fp'] in LOG:
                    api.write('PATCH', f'con_master_schedule_log?id=eq.{LOG[r["fp"]]["id"]}',
                              {'job_id': jid, 'synced_stage': fp_text[r['fp']], 'synced_at': datetime.datetime.now(datetime.timezone.utc).isoformat()},
                              prefer='return=minimal')

    # ---- 2. push changed rows onto their jobs
    rows_by_job = collections.defaultdict(list)
    for r in job_list:
        jid = links.get(r['fp'])
        if jid in J:
            rows_by_job[jid].append(r)
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for jid, rows in rows_by_job.items():
        job = J[jid]
        changed = [r for r in rows if not LOG.get(r['fp']) or LOG[r['fp']].get('job_id') != jid or (LOG[r['fp']].get('synced_stage') or '') != fp_text[r['fp']]]
        if not changed:
            continue
        staged = [r for r in rows if r['stage']]
        lead = max(staged, key=lambda r: rank(r['stage'])) if staged else None
        patch = {}
        if job.get('master_sync_hold'):
            report['held'].append({'job': job['job_number'] or job['site_number'], 'wo': job['work_order_number'], 'master': lead and lead['stage_txt'][:60]})
        elif lead:
            want = lead['stage']
            if job['stage'] == 'complete':
                if want in BEFORE_WORK and not (set(job['wos']) & done_wos):
                    patch['stage'] = want
                    report['reopened'].append({'job': job['job_number'] or job['site_number'], 'wo': job['work_order_number'], 'to': want, 'stage_txt': lead['stage_txt'][:60]})
            elif want != job['stage']:
                patch['stage'] = want
            if patch.get('stage') or job['stage'] != 'complete':
                if (job['status_detail'] or '') != lead['stage_txt'][:1000]:
                    patch['status_detail'] = lead['stage_txt'][:1000]
        if not job.get('master_sync_hold'):
            master_wo = next((r['wo_txt'] for r in rows if r['wos']), None) or next((r['wo_txt'] for r in rows if r['wo_txt']), None)
            if master_wo and not norm(job['work_order_number']):
                patch['work_order_number'] = master_wo
            elif master_wo and not job['wos'] and wos(master_wo):
                # The job only had a name/note in W/O ("LXC - PVC style") and the master now gives the WO#: keep both,
                # so the Completed Jobs pass can find it by WO later.
                patch['work_order_number'] = f'{master_wo} ({norm(job["work_order_number"])})'
            if not norm(job['scope_of_work']) and any(r['scope'] for r in rows):
                patch['scope_of_work'] = next(r['scope'] for r in rows if r['scope'])
            if not norm(job['facility_address']) and any(r['address'] for r in rows):
                patch['facility_address'] = next(r['address'] for r in rows if r['address'])
            if not job['date_received'] and not job['project_start_date']:
                seen = [LOG[r['fp']]['first_seen_at'][:10] for r in rows if r['fp'] in LOG] + [job['created_at'][:10]]
                patch['date_received'] = min(seen)
        if patch:
            if 'stage' in patch:
                report['stage_changes'].append({'job': job['job_number'] or job['site_number'], 'wo': job['work_order_number'],
                                                'from': job['stage'], 'to': patch['stage'], 'stage_txt': lead['stage_txt'][:60] if lead else ''})
            report['updated'].append({'job_id': jid, 'job': job['job_number'] or job['site_number'], 'fields': sorted(patch)})
            api.write('PATCH', f'con_jobs?id=eq.{jid}', patch, prefer='return=minimal')
        for r in rows:
            lg = LOG.get(r['fp'])
            if lg and apply:
                api.write('PATCH', f'con_master_schedule_log?id=eq.{lg["id"]}', {'job_id': jid, 'synced_stage': fp_text[r['fp']], 'synced_at': now_iso},
                          prefer='return=minimal')

    # ---- 3. Completed Jobs: act once per new row
    seen = {s['fingerprint'] for s in api.get_all(f'con_master_completed_seen?company_id=eq.{COMPANY_ID}&select=fingerprint')}
    first_run = not seen
    recent_from = max(c['row'] for c in completed) - 300 if completed else 0
    list_txt = {(r['key'], r['wo_text']) for r in job_list if r['wo_text']}
    log_by_wo = collections.defaultdict(list)
    for l in logs:
        for w in wos(l['wo']):
            log_by_wo[w].append(l)
    new_seen, closed_ids = [], set()
    for c in completed:
        if c['fp'] in seen:
            continue
        seen.add(c['fp'])
        action, jid = 'baseline' if first_run else 'none', None
        targets = []
        if c['wos']:
            targets = [j for w in c['wos'] for j in by_wo.get(w, []) if j['stage'] != 'complete' and not (set(j['wos']) & list_wos)]
        elif c['wo_text'] and len(c['wo_text']) >= 4 and (not first_run or c['row'] >= recent_from) and (c['key'], c['wo_text']) not in list_txt:
            targets = [j for j in by_key.get(c['key'], []) if j['stage'] != 'complete' and not j['wos'] and j['wo_text'] == c['wo_text']]
        for j in {t['id']: t for t in targets}.values():
            if j['id'] in closed_ids or j['id'] in links.values():      # still on the Job List under another row
                continue
            if j.get('master_sync_hold'):
                report['held'].append({'job': j['job_number'] or j['site_number'], 'wo': j['work_order_number'], 'master': f'Completed Jobs row {c["row"]}'})
                action = 'skipped:hold'
                continue
            note = f'Complete per Master Schedule (Completed Jobs row {c["row"]}, {md})' + ('' if c['stage_txt'].upper() == 'COMPLETE' else f' · {c["stage_txt"]}')
            api.write('PATCH', f'con_jobs?id=eq.{j["id"]}', {'stage': 'complete', 'status_detail': note}, prefer='return=minimal')
            closed_ids.add(j['id'])
            action, jid = 'closed', j['id']
            report['closed'].append({'job': j['job_number'] or j['site_number'], 'job_id': j['id'], 'wo': j['work_order_number'], 'app_stage': j['stage'],
                                     'completed_row': c['row'], 'master': c['stage_txt']})
        # A WO that was on the Job List (per the log) but never got an app job: add it as finished.
        if c['wos'] and not any(by_wo.get(w) for w in c['wos']) and any(log_by_wo.get(w) for w in c['wos']):
            ls = [l for w in c['wos'] for l in log_by_wo.get(w, [])]
            site, brand = app_site(c['site_raw'])
            body = {'company_id': COMPANY_ID, 'site_number': site, 'gas_brand': brand, 'work_order_number': c['wo_txt'], 'stage': 'complete',
                    'status_detail': f'Complete per Master Schedule (Completed Jobs row {c["row"]}) · on the Job List {min(l["first_seen_at"][:10] for l in ls)}'
                                     f' to {max(l["first_seen_at"][:10] for l in ls)}, added {md}',
                    'scope_of_work': c['scope'] or None, 'facility_address': c['address'] or None,
                    'date_received': min(l['first_seen_at'][:10] for l in ls),
                    'notes': f'Added from the Master Schedule (Completed Jobs row {c["row"]}) on {md}; it came and went before the app copied jobs.'}
            made = api.write('POST', 'con_jobs', body)
            jid = made[0]['id'] if made else None
            for w in c['wos']:
                by_wo[w].append({'id': jid, 'wos': c['wos'], 'stage': 'complete'})
            action = 'created'
            report['created_finished'].append({'site': site, 'wo': c['wo_txt'], 'completed_row': c['row'], 'date_received': body['date_received'], 'job_id': jid})
        new_seen.append({'fingerprint': c['fp'], 'company_id': COMPANY_ID, 'site_raw': c['site_raw'], 'site_key': c['key'], 'wo': c['wo_txt'] or None,
                         'stage': c['stage_txt'] or None, 'scope': (c['scope'] or '')[:2000] or None, 'sheet_row': c['row'],
                         'job_id': jid if jid and jid != '(dry-run)' else None, 'action': action})
    for i in range(0, len(new_seen), 300):
        api.write('POST', 'con_master_completed_seen?on_conflict=fingerprint', new_seen[i:i + 300], prefer='resolution=ignore-duplicates,return=minimal')

    # ---- 4. what's open in the app but not on the Job List (for a person to look at)
    linked = set(links.values())
    report['not_on_master'] = [{'job': j['job_number'] or j['site_number'], 'job_id': j['id'], 'stage': j['stage'], 'wo': j['work_order_number'],
                                'updated': j['updated_at'][:10]} for j in jobs
                               if j['stage'] != 'complete' and j['id'] not in linked and j['id'] not in closed_ids]

    n = lambda k: len(report.get(k, []))
    print(f'{"APPLIED" if apply else "Dry run"} {today}: Job List {len(job_list)} rows (legend {legend_n} colors), Completed Jobs {len(completed)} rows')
    print(f'  linked {len(links) - sum(len(r) for r in to_create.values())} rows; added {n("created")} jobs; stage changes {n("stage_changes")} '
          f'(reopened {n("reopened")}); other field fills {n("updated") - n("stage_changes")}; closed {n("closed")}; '
          f'added finished {n("created_finished")}; held {n("held")}; site mismatches {n("site_mismatch")}; open jobs not on the Job List {n("not_on_master")}')
    for c in report.get('created', []):
        print(f'  + {c["site"]:<14} {c["wo"][:28]:<28} {c["stage"]:<17} rows {c["rows"]}')
    for c in report.get('stage_changes', []):
        print(f'  ~ {c["job"]:<16} {str(c["wo"])[:26]:<26} {c["from"]:>17} -> {c["to"]:<17} {c["stage_txt"]}')
    for c in report.get('closed', []):
        print(f'  x {c["job"]:<16} {str(c["wo"])[:26]:<26} was {c["app_stage"]} (Completed Jobs row {c["completed_row"]})')
    for c in report.get('created_finished', []):
        print(f'  + finished {c["site"]:<12} {c["wo"][:26]:<26} (Completed Jobs row {c["completed_row"]})')
    for c in report.get('site_mismatch', []):
        print(f'  ! site: master {c["master_site"]} vs app {c["app_site"]} ({c["wo"]})')
    if not apply:
        print('Dry run. Add --apply to write.')
    if json_out:
        Path(json_out).write_text(json.dumps(report, indent=1, default=str))


if __name__ == '__main__':
    main()
