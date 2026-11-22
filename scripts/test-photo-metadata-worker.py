import importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).with_name('photo-metadata-worker.py'));w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
class WorkerTests(unittest.TestCase):
 def test_identity_credit_and_challenge(self):
  bird=dict(id='norcar',name='Northern Cardinal',acceptedName='Northern Cardinal')
  text='<meta property="og:image" content="https://cdn.download.ams.birds.cornell.edu/api/v2/asset/123/900"><meta property="og:image:alt" content="Northern Cardinal - A &amp; B">'
  p=w.parse_photo(text,bird);self.assertEqual(p['photographer'],'A & B');self.assertEqual(p['source'],'https://macaulaylibrary.org/asset/123')
  self.assertIsNone(w.parse_photo('anubis '+text,bird));self.assertIsNone(w.parse_photo(text.replace('Northern Cardinal','Blue Jay'),bird));self.assertIsNone(w.parse_photo(text.replace('cdn.download.ams.birds.cornell.edu','evil.test'),bird))
 def test_catalog_json(self):
  text=json.dumps({'results':{'content':[dict(mediaType='Photo',commonName='Northern Cardinal',assetId=123,userDisplayName='A Birder')]}})
  self.assertEqual(w.parse_photo(text,dict(name='Northern Cardinal'))['photographer'],'A Birder')
  self.assertIsNone(w.parse_photo(text,dict(name='Blue Jay')))
 def test_durable_queue_and_host_stop(self):
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d);c=w.connect(path/'queue.sqlite');file=path/'birds.json';file.write_text(json.dumps(dict(birds=[dict(id='norcar',name='Northern Cardinal',photos=[])])))
   w.enqueue(c,[file]);w.enqueue(c,[file]);self.assertEqual(c.execute('select count(*) from species').fetchone()[0],1)
   w.record_challenge(c,'norcar');self.assertEqual(c.execute('select state from hosts').fetchone()[0],'cooldown')
   w.record_challenge(c,'norcar');w.enqueue(c,[file]);self.assertEqual(c.execute('select state from hosts').fetchone()[0],'blocked')
   w.report(c,path/'status.json');self.assertIn('challenge_blocked',(path/'access-log.tsv').read_text());c.close()
   c=w.connect(path/'queue.sqlite');self.assertEqual(c.execute('select challenges from hosts').fetchone()[0],2)
unittest.main()
