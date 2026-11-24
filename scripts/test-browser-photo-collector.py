import copy
import importlib.util
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import types
import unittest

spec = importlib.util.spec_from_file_location('collector', pathlib.Path(__file__).with_name('browser-photo-collector.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.c = m.seasonal.worker.connect(self.root / 'queue.sqlite')
        m.init(self.c)
        catalog = self.root / 'catalog.json'
        catalog.write_text(json.dumps({'birds': [dict(id='norcar', name='Northern Cardinal', scientificName='Cardinalis cardinalis', photos=[])]}))
        m.seasonal.seed(self.c, catalog)
        self.job = m.seasonal.plan(self.c, 1)[0]
        self.snapshot = dict(catalogUrl=self.job['url'], title='Media Search - Macaulay Library and eBird', text='', rows=[self.row('123'), self.row('456')])

    def tearDown(self):
        self.c.close()
        self.tmp.cleanup()

    def row(self, asset):
        return dict(name='Northern Cardinal', scientificName='Cardinalis cardinalis', speciesUrl='https://ebird.org/species/norcar', source='https://macaulaylibrary.org/asset/' + asset, url='https://cdn.download.ams.birds.cornell.edu/api/v2/asset/' + asset + '/1200', photographer='A Birder', observedAt='2024-02-29T12:00:00', checklist='https://ebird.org/checklist/S' + asset)

    def test_identity_stale_loading_and_dates(self):
        result = m.payload(self.snapshot, self.job, self.c)
        self.assertEqual(m.seasonal.ingest(self.c, result)['datedPhotos'], 2)
        for field, value in [('catalogUrl', self.job['url'] + '&wrong=1'), ('rows', []), ('title', 'Loading')]:
            bad = copy.deepcopy(self.snapshot)
            bad[field] = value
            with self.assertRaises(ValueError):
                m.payload(bad, self.job, self.c)
        bad = copy.deepcopy(self.snapshot)
        bad['rows'][0]['observedAt'] = '2024-08-01T12:00:00'
        with self.assertRaises(ValueError):
            m.payload(bad, self.job, self.c)

    def test_empty_and_partial_are_explicit(self):
        self.snapshot.update(rows=[], text='0 results found',photoCount=3303)
        with self.assertRaises(ValueError):
            m.payload(self.snapshot,self.job,self.c)
        self.snapshot['photoCount']=0
        result = m.payload(self.snapshot, self.job, self.c)
        self.assertEqual(m.seasonal.ingest(self.c, result)['state'], 'no_results')
        self.snapshot.update(rows=[self.row('123')], text='')
        self.assertEqual(m.seasonal.ingest(self.c, m.payload(self.snapshot, self.job, self.c))['state'], 'partial')

    def test_challenges_persist_and_failures_are_bounded(self):
        self.assertTrue(m.challenge('Making sure you are not a bot'))
        self.assertFalse(m.challenge('Media Search - Northern Cardinal'))
        m.record_challenge(self.c, 100)
        self.assertEqual(dict(self.c.execute('select * from browser_photo_control').fetchone())['retry_at'], 1900)
        m.init(self.c)
        m.record_challenge(self.c, 2000)
        self.assertEqual(self.c.execute('select blocked from browser_photo_control').fetchone()[0], 1)
        self.assertEqual(m.checkpoint(self.root / 'queue.sqlite')['access']['blocked'], 1)
        for n in range(1, 4):
            self.assertEqual(m.record_failure(self.c, self.job), n)
        self.assertEqual(self.c.execute('select state from photo_quarter_jobs where quarter=1').fetchone()[0], 'needs_review')
        self.assertEqual(m.seasonal.plan(self.c, 1)[0]['quarter'], 2)

    def test_retry_after_and_control_during_wait(self):
        self.assertEqual(m.retry_after('2400', 0), 2400)
        self.assertEqual(m.retry_after('Thu, 01 Jan 1970 01:00:00 GMT', 100), 3500)
        self.assertEqual(m.retry_after(None, 0), 0)
        with socket.socket(socket.AF_UNIX) as server:
            path = str(self.root / 'control.sock')
            server.bind(path)
            server.listen()
            server.setblocking(False)
            runner = m.Runner(types.SimpleNamespace(output=self.root), self.c, server)
            with socket.socket(socket.AF_UNIX) as client:
                client.connect(path)
                client.sendall(b'stop')
                runner.poll()
                self.assertTrue(json.loads(client.recv(4096))['stopping'])
            before = time.time()
            runner.wait(time.time() + 1800)
            self.assertLess(time.time() - before, 1)

    def test_manual_verification_waits_for_exact_catalog_without_navigation(self):
        with socket.socket(socket.AF_UNIX) as server:
            args = types.SimpleNamespace(output=self.root, manual_verification=True)
            runner = m.Runner(args, self.c, server)
            bad = copy.deepcopy(self.snapshot)
            bad['catalogUrl'] += '&wrong=1'
            snapshots = [dict(title='Verify you are human', text='captcha'), bad, self.snapshot]
            class Page:
                waits = 0
                def is_closed(self): return False
                def evaluate(self, _): return snapshots.pop(0)
                def wait_for_timeout(self, _): self.waits += 1
            page = Page()
            self.c.execute("update hosts set state='blocked'")
            self.c.commit()
            m.record_challenge(self.c, 0)
            self.assertTrue(runner.handle_challenge(page, self.job))
            self.assertEqual(page.waits, 2)
            access = self.c.execute('select challenges,blocked,retry_at from browser_photo_control').fetchone()
            self.assertEqual(tuple(access), (0, 0, 0))
            self.assertEqual(self.c.execute('select state from hosts').fetchone()[0], 'blocked')
            self.assertEqual(runner.state['phase'], 'verification_complete')
            self.assertEqual(self.c.execute('select count(*) from photo_assets').fetchone()[0], 0)

    def test_manual_verification_stop_and_closed_browser_preserve_block(self):
        with socket.socket(socket.AF_UNIX) as server:
            runner = m.Runner(types.SimpleNamespace(output=self.root, manual_verification=True), self.c, server)
            class Page:
                closed = False
                def is_closed(self): return self.closed
                def evaluate(self, _): return dict(title='Verify you are human', text='captcha')
                def wait_for_timeout(self, _): runner.stopping = True
            page = Page()
            self.assertFalse(runner.handle_challenge(page, self.job))
            self.assertEqual(self.c.execute('select challenges from browser_photo_control').fetchone()[0], 1)
            runner.stopping = False
            page.closed = True
            self.assertFalse(runner.handle_challenge(page, self.job))
            self.assertTrue(runner.stopping)
            self.assertEqual(self.c.execute('select blocked from browser_photo_control').fetchone()[0], 1)

    def test_default_challenge_does_not_wait_for_human(self):
        with socket.socket(socket.AF_UNIX) as server:
            runner = m.Runner(types.SimpleNamespace(output=self.root), self.c, server)
            self.assertFalse(runner.handle_challenge(None, self.job))
            self.assertEqual(runner.state['phase'], 'challenge')

    @unittest.skipUnless(os.environ.get('AVIQUIZ_BROWSER_TESTS') == '1', 'Opt-in offline Chromium integration test')
    def test_real_browser_manual_verification_resumes_without_reload(self):
        from playwright.sync_api import sync_playwright
        html = '<title>Media Search - Macaulay Library and eBird</title><ol class="ResultsList">'
        for row in self.snapshot['rows']:
            html += f'''<li><div class="speciesNameOnCard"><a href="{row['speciesUrl']}"><span class="Species-common">{row['name']}</span><span class="Species-sci">{row['scientificName']}</span></a></div><a href="{row['source']}">Asset</a><div class="ResultsList-media"><img src="{row['url']}"></div><div class="userDateLoc"><div>{row['photographer']}</div></div><time datetime="{row['observedAt']}"></time><a href="{row['checklist']}">Checklist</a></li>'''
        html += '</ol>'
        verification = '<title>Verify you are human</title><button id="test-verify">Complete test verification</button><script>document.querySelector("#test-verify").onclick=()=>{document.title="Media Search - Macaulay Library and eBird";document.body.innerHTML=' + json.dumps(html) + ';};</script>'
        with socket.socket(socket.AF_UNIX) as server, sync_playwright() as pw:
            with pw.chromium.launch() as browser:
                page = browser.new_page()
                documents = []
                def route_request(route):
                    if route.request.resource_type == 'document':
                        documents.append(route.request.url)
                        route.fulfill(body=verification, status=403, content_type='text/html')
                    else:
                        route.abort()
                page.route('**/*', route_request)
                # Simulate the owner pressing a button on a local test page.
                # This is not a real challenge, and no external requests occur.
                normal_wait = page.wait_for_timeout
                def owner_action(_):
                    page.locator('#test-verify').click()
                    normal_wait(1)
                page.wait_for_timeout = owner_action
                args = types.SimpleNamespace(output=self.root, interval=30, max_requests=1, manual_verification=True)
                runner = m.Runner(args, self.c, server)
                runner.collect(page)
                self.assertEqual(documents, [self.job['url']])
                self.assertEqual(self.c.execute('select count(*) from photo_assets where observed_on is not null').fetchone()[0], 2)
                self.assertTrue((self.root / 'norcar-q1.json').exists())
                self.assertEqual(m.checkpoint(self.root / 'queue.sqlite')['next_job']['quarter'], 2)

    @unittest.skipUnless(os.environ.get('AVIQUIZ_BROWSER_TESTS') == '1', 'Opt-in offline CLI lifecycle test')
    def test_cli_start_status_stop_and_restart_preserve_queue(self):
        # Future cooldown ensures no external navigation, even in a child process.
        self.c.execute('update browser_photo_control set retry_at=?', (time.time() + 3600,))
        self.c.commit()
        script = str(pathlib.Path(m.__file__).resolve())
        def cli(command):
            result = subprocess.run([sys.executable, script, command, '--db', str(self.root / 'queue.sqlite'), '--output', str(self.root)], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            return json.loads(result.stdout)
        try:
            for _ in range(2):
                started = cli('start')
                self.assertTrue(started['running'])
                self.assertEqual(cli('start')['pid'], started['pid'])
                self.assertTrue(cli('status')['running'])
                self.assertTrue(cli('stop')['stopping'])
                for attempt in range(100):
                    if not cli('status')['running']:
                        break
                    time.sleep(0.1)
                else:
                    self.fail('Collector did not stop')
                self.assertEqual(m.checkpoint(self.root / 'queue.sqlite')['next_job']['quarter'], 1)
                self.assertEqual(self.c.execute('select count(*) from photo_assets').fetchone()[0], 0)
        finally:
            cli('stop')


if __name__ == '__main__':
    unittest.main()
