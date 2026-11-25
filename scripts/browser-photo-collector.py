#!/usr/bin/env python3
"""Standalone, serial public-catalog collector. No LLM, credentials, or photo downloads."""
import argparse
import datetime
import email.utils
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time

spec = importlib.util.spec_from_file_location('seasonal', pathlib.Path(__file__).with_name('seasonal-photo-metadata.py'))
seasonal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seasonal)
HOST = 'media.ebird.org'
COOLDOWN = 1800
EXTRACT = r"""() => ({catalogUrl: location.href, title: document.title,
 text: document.body.innerText.slice(0, 15000),
 photoCount: (() => {const text=[...document.querySelectorAll('a')].find(a=>a.textContent.startsWith('Remove media type filter'))?.textContent;const n=text?.match(/filter\s*([\d,]+)/);return n ? Number(n[1].replaceAll(',','')) : null;})(),
 rows: [...document.querySelectorAll('ol.ResultsList > li')].slice(0, 100).map(li => ({
 name: li.querySelector('.Species-common')?.textContent?.trim(),
 scientificName: li.querySelector('.Species-sci')?.textContent?.trim(),
 speciesUrl: li.querySelector('.speciesNameOnCard a')?.href,
 source: li.querySelector('a[href^="https://macaulaylibrary.org/asset/"]')?.href?.split('?')[0],
 url: li.querySelector('.ResultsList-media img')?.getAttribute('src'),
 photographer: li.querySelector('.userDateLoc > div')?.textContent?.trim(),
 observedAt: li.querySelector('time')?.getAttribute('datetime'),
 checklist: li.querySelector('a[href^="https://ebird.org/checklist/S"]')?.href?.split('?')[0]
 }))})"""


def atomic(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def init(c):
    seasonal.init(c)
    c.executescript('''CREATE TABLE IF NOT EXISTS browser_photo_control (
      id INTEGER PRIMARY KEY CHECK(id=1), last_request REAL NOT NULL DEFAULT 0,
      retry_at REAL NOT NULL DEFAULT 0, challenges INTEGER NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO browser_photo_control(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS browser_photo_attempts (
      species TEXT NOT NULL, quarter INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(species,quarter));''')
    c.commit()


def retry_after(value, now):
    try:
        return max(0, float(value))
    except (ValueError, TypeError):
        try:
            return max(0, email.utils.parsedate_to_datetime(value).timestamp() - now)
        except (ValueError, TypeError, OverflowError):
            return 0


def challenge(text):
    return bool(re.search(r'anubis|captcha|making sure you.{0,20}not a bot|verify you are human|challenge-platform|access denied', text, re.I))


def payload(snapshot, job, c):
    if snapshot['catalogUrl'] != job['url']:
        raise ValueError('Catalog navigation did not reach the requested filters')
    if 'Media Search' not in snapshot['title']:
        raise ValueError('Unexpected catalog title')
    bird = json.loads(c.execute('select bird from species where id=?', (job['species'],)).fetchone()[0])
    rows = [r for r in snapshot['rows'] if seasonal.identity_matches(bird,r)]
    result = dict(catalogUrl=snapshot['catalogUrl'], rows=rows)
    if not rows:
        # A loading page or changed markup is never evidence of zero coverage.
        if not snapshot['rows'] and snapshot.get('photoCount') == 0 and re.search(r'\bno (?:matching )?results\b|\bno media found\b|\b0 results found\b', snapshot['text'], re.I):
            result['emptyVerified'] = True
        else:
            raise ValueError('No exact species rows; catalog needs review')
    # Validate every retained row before writing evidence or touching the queue.
    seasonal.validate(result, c)
    return result


def record_challenge(c, now):
    with c:
        c.execute('update browser_photo_control set challenges=challenges+1,retry_at=?,blocked=(challenges+1>=2) where id=1', (now + COOLDOWN,))


def record_failure(c, job):
    with c:
        c.execute('insert into browser_photo_attempts values(?,?,1) on conflict(species,quarter) do update set failures=failures+1', (job['species'], job['quarter']))
        n = c.execute('select failures from browser_photo_attempts where species=? and quarter=?', (job['species'], job['quarter'])).fetchone()[0]
        if n >= 3:
            c.execute("update photo_quarter_jobs set state='needs_review' where species_id=? and quarter=?", (job['species'], job['quarter']))
    return n


def control_path(db):
    # AF_UNIX has a short path limit on macOS; user-only directory, fixed DB identity.
    folder = pathlib.Path('/tmp') / ('aviquiz-photo-' + str(os.getuid()))
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.is_symlink() or folder.stat().st_uid != os.getuid():
        raise RuntimeError('Unsafe control directory')
    folder.chmod(0o700)
    return folder / (hashlib.sha256(str(db.resolve()).encode()).hexdigest()[:24] + '.sock')


def send_control(db, command):
    with socket.socket(socket.AF_UNIX) as s:
        s.settimeout(2)
        s.connect(str(control_path(db)))
        s.sendall(command.encode())
        return json.loads(s.recv(4096).decode())


def checkpoint(db):
    if not db.exists():
        return {}
    c = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    try:
        count = c.execute('select count(distinct species_id),count(*) from photo_assets where observed_on is not null').fetchone()
        jobs = seasonal.plan(c, 1)
        result = dict(species_with_dated_photos=count[0], dated_photos=count[1], next_job=jobs[0] if jobs else None)
        if c.execute("select 1 from sqlite_master where name='browser_photo_control'").fetchone():
            result['access'] = dict(c.execute('select retry_at,challenges,blocked from browser_photo_control where id=1').fetchone())
        return result
    except sqlite3.OperationalError:
        return dict(note='Seasonal queue has not been initialized')
    finally:
        c.close()


class Runner:
    def __init__(self, args, c, server):
        self.args, self.c, self.server = args, c, server
        self.stopping = False
        self.requests = 0
        self.state = dict(pid=os.getpid(), running=True, phase='starting', requests=0,
                          manual_verification=getattr(args, 'manual_verification', False))

    def report(self, phase, **fields):
        self.state.update(phase=phase, requests=self.requests, updated=time.time(), **fields)
        atomic(self.args.output / 'collector-status.json', self.state)
        print(json.dumps(dict(time=datetime.datetime.now(datetime.timezone.utc).isoformat(), **self.state)), flush=True)

    def poll(self):
        try:
            client, _ = self.server.accept()
        except BlockingIOError:
            return
        with client:
            try:
                client.settimeout(1)
                if client.recv(64) == b'stop':
                    self.stopping = True
                client.sendall(json.dumps(dict(self.state, stopping=self.stopping)).encode())
            except OSError:
                pass

    def wait(self, until):
        while not self.stopping and time.time() < until:
            time.sleep(min(0.25, max(0, until - time.time())))

    def handle_challenge(self, page, job):
        record_challenge(self.c, time.time())
        if not getattr(self.args, 'manual_verification', False):
            self.report('challenge', url=job['url'], reason='Thirty-minute cooldown; one retry only')
            return False
        self.report('waiting_for_verification', url=job['url'],
                    reason='Complete verification in the open browser. Collection resumes when the requested catalog is visible.')
        # Observe only. Never click a challenge, reload it, or navigate while waiting.
        while not self.stopping:
            if page.is_closed():
                self.report('verification_browser_closed', reason='Browser closed; checkpoint preserved')
                self.stopping = True
                return False
            try:
                snapshot = page.evaluate(EXTRACT)
                if not challenge(snapshot['title'] + '\n' + snapshot['text']):
                    payload(snapshot, job, self.c)
                    # Clear only this browser's access state after verified catalog
                    # access, never the independent HTTP-worker host blocks.
                    with self.c:
                        self.c.execute('update browser_photo_control set challenges=0,blocked=0,retry_at=0,last_request=? where id=1', (time.time(),))
                        self.c.execute('insert into events values(?,?,?,?,?)', (time.time(), job['species'], HOST, 'manual_verification_catalog_available', None))
                    self.report('verification_complete', reason='Requested catalog available; resuming')
                    return True
            except Exception:
                # Navigation during human verification can briefly destroy the DOM.
                pass
            page.wait_for_timeout(1000)
        return False

    def collect(self, page):
        manual_recovery = getattr(self.args, 'manual_verification', False)
        while not self.stopping and (not self.args.max_requests or self.requests < self.args.max_requests):
            host = self.c.execute('select * from browser_photo_control where id=1').fetchone()
            # Explicit manual restart allows one visit for the owner to verify
            # access. Persist the block until a catalog is actually validated.
            recovering = manual_recovery and host['challenges'] > 0
            manual_recovery = False
            if host['blocked'] and not recovering:
                self.report('blocked', reason='Repeated browser challenge; explicit owner review required')
                return
            jobs = seasonal.plan(self.c, 1)
            if not jobs:
                self.report('finished', reason='No pending quarter jobs; inspect coverage for partial or review gaps')
                return
            job = jobs[0]
            until = max(0 if recovering else host['retry_at'], host['last_request'] + self.args.interval)
            if until > time.time():
                self.report('waiting', next_request_at=until)
                self.wait(until)
            if self.stopping:
                return
            self.requests += 1
            with self.c:
                self.c.execute('update browser_photo_control set last_request=? where id=1', (time.time(),))
            self.report('collecting', species=job['species'], quarter=job['quarter'])
            response = None
            navigation_error = False
            try:
                response = page.goto(job['url'], wait_until='domcontentloaded', timeout=45000)
            except Exception:
                # Timeouts can leave a fully loaded page. Inspect it before retrying.
                navigation_error = True
            status = response.status if response else None
            snapshot = page.evaluate(EXTRACT)
            if challenge(snapshot['title'] + '\n' + snapshot['text']) or status == 403:
                if not self.handle_challenge(page, job):
                    continue
                snapshot = page.evaluate(EXTRACT)
            if status == 429 or (status is not None and status >= 500):
                delay = max(COOLDOWN, retry_after(response.headers.get('retry-after'), time.time()))
                with self.c:
                    self.c.execute('update browser_photo_control set retry_at=? where id=1', (time.time() + delay,))
                n = record_failure(self.c, job)
                self.report('rate_limited' if status == 429 else 'server_error', http_status=status, failures=n)
                continue
            try:
                # Wait for rendered rows or an explicit empty state, not network-idle.
                page.wait_for_function(r"""() => document.querySelector('ol.ResultsList li time') || /no (matching )?results|no media found|\b0 results found\b/i.test(document.body.innerText)""", timeout=20000)
                snapshot = page.evaluate(EXTRACT)
                if challenge(snapshot['title'] + '\n' + snapshot['text']):
                    if not self.handle_challenge(page, job):
                        continue
                    snapshot = page.evaluate(EXTRACT)
                evidence = payload(snapshot, job, self.c)
                atomic(self.args.output / (job['species'] + '-q' + str(job['quarter']) + '.json'), evidence)
                result = seasonal.ingest(self.c, evidence)
                with self.c:
                    self.c.execute('update browser_photo_control set retry_at=0 where id=1')
                report = seasonal.export(self.c, self.args.output)
                self.report('saved', result=result, coverage=report)
            except Exception as exc:
                latest = page.evaluate(EXTRACT)
                if challenge(latest['title'] + '\n' + latest['text']):
                    if self.handle_challenge(page, job):
                        # Save the now-verified page without another navigation.
                        evidence = payload(page.evaluate(EXTRACT), job, self.c)
                        atomic(self.args.output / (job['species'] + '-q' + str(job['quarter']) + '.json'), evidence)
                        result = seasonal.ingest(self.c, evidence)
                        self.report('saved', result=result, coverage=seasonal.export(self.c, self.args.output))
                    continue
                n = record_failure(self.c, job)
                self.report('needs_review' if n >= 3 else 'retry_pending', failures=n,
                            reason=str(exc) if isinstance(exc, ValueError) else type(exc).__name__, navigation_timed_out=navigation_error)


def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    args.output.chmod(0o700)
    args.db.parent.mkdir(parents=True, exist_ok=True)
    with open(str(args.db) + '.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another worker holds this queue')
        c = seasonal.worker.connect(args.db)
        init(c)
        if args.seed:
            seasonal.seed(c, args.seed)
        sockpath = control_path(args.db)
        sockpath.unlink(missing_ok=True)  # Only after acquiring the queue lock.
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(str(sockpath))
            os.chmod(sockpath, 0o600)
            server.listen(4)
            server.setblocking(False)
            runner = Runner(args, c, server)
            controller_done = threading.Event()
            def control_loop():
                while not controller_done.is_set():
                    runner.poll()
                    controller_done.wait(0.1)
            controller = threading.Thread(target=control_loop, daemon=True)
            controller.start()
            def halt(*_):
                runner.stopping = True
            signal.signal(signal.SIGTERM, halt)
            signal.signal(signal.SIGINT, halt)
            try:
                from playwright.sync_api import sync_playwright
                for recovery in range(3):
                    try:
                        with sync_playwright() as pw:
                            # Dedicated profile only. No personal browser cookies, stealth, or UA overrides.
                            with pw.chromium.launch_persistent_context(str(args.output / 'browser-profile'), headless=not args.visible, accept_downloads=False) as browser:
                                page = browser.pages[0] if browser.pages else browser.new_page()
                                # Metadata only. Avoid fetching full-resolution image/audio/video files.
                                if not args.manual_verification:
                                    page.route('**/*', lambda route: route.abort() if route.request.resource_type in ('image', 'media', 'font') else route.continue_())
                                runner.collect(page)
                        break
                    except Exception:
                        if runner.stopping:
                            break
                        if recovery == 2:
                            raise
                        runner.report('recovering_browser', attempt=recovery + 1)
                        runner.wait(time.time() + 60)
                        if runner.stopping:
                            break
            except Exception as exc:
                runner.report('error', reason=type(exc).__name__)
                raise
            finally:
                phase = runner.state['phase'] if runner.state['phase'] in ('blocked', 'finished', 'error') else 'stopped'
                runner.state['running'] = False
                runner.report(phase)
                controller_done.set()
                controller.join(timeout=2)
                seasonal.export(c, args.output)
                c.close()
                sockpath.unlink(missing_ok=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['run', 'start', 'stop', 'status'])
    p.add_argument('--db', type=pathlib.Path, default=seasonal.worker.DEFAULT)
    p.add_argument('--output', type=pathlib.Path)
    p.add_argument('--seed', type=pathlib.Path, help='Optional catalog for a new queue')
    p.add_argument('--interval', type=float, default=35, help='Seconds between navigations; minimum 30')
    p.add_argument('--max-requests', type=int, default=0, help='0 runs until pending jobs finish or collection blocks')
    p.add_argument('--visible', action='store_true', help='Show the dedicated browser instead of headless mode')
    p.add_argument('--manual-verification', action='store_true', help='Show browser and wait for human challenge completion; never solves challenges automatically')
    args = p.parse_args()
    if args.manual_verification:
        args.visible = True
    args.db = args.db.resolve()
    args.output = (args.output or args.db.parent / 'seasonal').resolve()
    if args.interval < 30 or args.max_requests < 0:
        p.error('Interval must be at least 30 seconds and max-requests nonnegative')
    if args.command in ('stop', 'status'):
        try:
            print(json.dumps(dict(send_control(args.db, args.command), checkpoint=checkpoint(args.db)), indent=2))
        except (OSError, ValueError):
            path = args.output / 'collector-status.json'
            state = json.loads(path.read_text()) if path.exists() else {}
            print(json.dumps(dict(state, running=False, note='No responding collector', checkpoint=checkpoint(args.db)), indent=2))
        return
    if args.command == 'run':
        run(args)
        return
    try:
        print(json.dumps(send_control(args.db, 'status'), indent=2))
        return
    except (OSError, ValueError):
        pass
    args.output.mkdir(parents=True, exist_ok=True)
    args.output.chmod(0o700)
    command = [sys.executable, str(pathlib.Path(__file__).resolve()), 'run', '--db', str(args.db), '--output', str(args.output), '--interval', str(args.interval), '--max-requests', str(args.max_requests)]
    if args.seed:
        command += ['--seed', str(args.seed.resolve())]
    if args.visible:
        command.append('--visible')
    if args.manual_verification:
        command.append('--manual-verification')
    with open(args.output / 'collector.log', 'a') as log:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    for _ in range(100):
        if process.poll() is not None:
            raise SystemExit('Collector exited; inspect ' + str(args.output / 'collector.log'))
        try:
            print(json.dumps(send_control(args.db, 'status'), indent=2))
            return
        except (OSError, ValueError):
            time.sleep(0.1)
    raise SystemExit('Startup unconfirmed; inspect status/log before starting another collector')


if __name__ == '__main__':
    os.umask(0o077)
    main()
