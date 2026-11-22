import copy,importlib.util,json,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('seasonal',pathlib.Path(__file__).with_name('seasonal-photo-metadata.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SeasonalTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.c=m.worker.connect(self.root/'queue.sqlite');m.init(self.c)
  self.catalog=self.root/'catalog.json';self.catalog.write_text(json.dumps(dict(birds=[dict(id='norcar',name='Northern Cardinal',acceptedName='Northern Cardinal',scientificName='Cardinalis cardinalis',taxonOrder=2,photos=[]),dict(id='mallar3',name='Mallard',scientificName='Anas platyrhynchos',taxonOrder=1,photos=[])])));m.seed(self.c,self.catalog)
  self.p=dict(catalogUrl='https://media.ebird.org/catalog?taxonCode=norcar&mediaType=photo&view=list&beginMonth=1&endMonth=3&sort=rating_rank_desc',rows=[self.row('123','2024-02-29T23:30:00+14:00','S123'),self.row('456','2022-01-23T08:25:00','S456')])
 def row(self,id,date,checklist):return dict(name='Northern Cardinal',scientificName='Cardinalis cardinalis',speciesUrl='https://ebird.org/species/norcar',source='https://macaulaylibrary.org/asset/'+id+'?tracking=discard',url='https://cdn.download.ams.birds.cornell.edu/api/v2/asset/'+id+'/1200',photographer='A Birder',observedAt=date,checklist='https://ebird.org/checklist/'+checklist)
 def tearDown(self):self.c.close();self.tmp.cleanup()
 def test_exact_dates_quarters_idempotency_and_reseed(self):
  self.assertEqual(m.ingest(self.c,self.p)['datedPhotos'],2);self.assertEqual(m.ingest(self.c,self.p)['datedPhotos'],2)
  m.seed(self.c,self.catalog);p=json.loads(self.c.execute("select photo_json from photo_assets where asset_id='123'").fetchone()[0]);self.assertEqual(p['observationDate'],'2024-02-29');self.assertEqual(p['observationDateRaw'],'2024-02-29T23:30:00+14:00');self.assertEqual(p['quarter'],1);self.assertNotIn('tracking',p['source'])
  self.assertEqual(len(json.loads(self.c.execute("select photos from species where id='norcar'").fetchone()[0])),2)
 def test_stale_quarter_missing_date_identity_and_invalid_leap(self):
  for field,value in [('observedAt','2024-08-29T10:00:00'),('observedAt','2023-02-29T10:00:00'),('observedAt',''),('name','Blue Jay'),('photographer','')]:
   p=copy.deepcopy(self.p);p['rows'][1][field]=value
   with self.assertRaises(ValueError):m.ingest(self.c,p)
   self.assertEqual(self.c.execute('select count(*) from photo_assets').fetchone()[0],0)
 def test_date_conflict_rolls_back_and_unknown_is_not_quarter_coverage(self):
  m.ingest(self.c,self.p);p=copy.deepcopy(self.p);p['rows'][0]['observedAt']='2024-03-01T10:00:00'
  with self.assertRaises(ValueError):m.ingest(self.c,p)
  self.assertEqual(self.c.execute("select observed_on from photo_assets where asset_id='123'").fetchone()[0],'2024-02-29')
  report=m.export(self.c,self.root/'export');self.assertEqual(report['completeQuarterSlots'],1);self.assertEqual(report['quarterSlots'],8)
 def test_breadth_first_plan_and_unconfirmed_empty_results(self):
  jobs=m.plan(self.c,10);self.assertEqual(len(jobs),2);self.assertEqual(len({j['species'] for j in jobs}),2);self.assertEqual(jobs[0]['species'],'mallar3')
  p=copy.deepcopy(self.p);p['rows']=[]
  with self.assertRaises(ValueError):m.ingest(self.c,p)
  p['emptyVerified']=True;self.assertEqual(m.ingest(self.c,p)['state'],'no_results')
 def test_four_quarters_are_required_for_complete_species(self):
  self.c.execute('insert into photo_assets values(?,?,?,?,?,?,?)',('norcar','999',None,None,json.dumps({'id':'999'}),None,0));self.c.commit()
  self.assertEqual(m.export(self.c,self.root/'before')['completeSpecies'],0)
  for q,month in [(1,'01'),(2,'04'),(3,'07'),(4,'10')]:
   p=copy.deepcopy(self.p);p['catalogUrl']=f'https://media.ebird.org/catalog?taxonCode=norcar&mediaType=photo&view=list&beginMonth={(q-1)*3+1}&endMonth={q*3}'
   p['rows']=[self.row(str(q*100+1),f'2024-{month}-15T12:00:00','S123'),self.row(str(q*100+2),f'2023-{month}-16T12:00:00','S456')];m.ingest(self.c,p)
   report=m.export(self.c,self.root/'report');self.assertEqual(report['completeSpecies'],1 if q==4 else 0)
  self.assertEqual(report['datedPhotos'],8);self.assertEqual(report['undatedPhotos'],1)
unittest.main()
