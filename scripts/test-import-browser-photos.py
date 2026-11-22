import importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('importer',pathlib.Path(__file__).with_name('import-browser-photos.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ImportTests(unittest.TestCase):
 def test_batch_validation_idempotency_and_block_preservation(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);c=m.worker.connect(p/'q.sqlite');bird=dict(id='norcar',name='Northern Cardinal',scientificName='Cardinalis cardinalis',photos=[])
   c.execute('insert into species(id,bird,state,updated) values(?,?,?,0)',('norcar',json.dumps(bird),'pending'));c.execute("update hosts set state='blocked',challenges=2");c.commit()
   record=dict(page='https://ebird.org/species/norcar',title='Northern Cardinal - eBird',heading='Northern Cardinal Cardinalis cardinalis',alt='Northern Cardinal - A Birder',url='https://cdn.download.ams.birds.cornell.edu/api/v2/asset/123/900')
   bad={**record,'heading':'Blue Jay Cyanocitta cristata'}
   with self.assertRaises(ValueError):m.ingest(c,[record,bad])
   self.assertEqual(c.execute('select state from species').fetchone()[0],'pending')
   m.ingest(c,[record]);m.ingest(c,[record]);self.assertEqual(len(json.loads(c.execute('select photos from species').fetchone()[0])),1)
   self.assertEqual(c.execute('select state from hosts').fetchone()[0],'blocked')
unittest.main()
