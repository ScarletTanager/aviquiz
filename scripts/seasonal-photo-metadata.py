#!/usr/bin/env python3
"""Dated Cornell photo metadata and a breadth-first quarter queue. No HTTP."""
import argparse,datetime,importlib.util,json,pathlib,re,time,urllib.parse
spec=importlib.util.spec_from_file_location('photo_worker',pathlib.Path(__file__).with_name('photo-metadata-worker.py'));worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
SCI_RENAMES={'Troglodytes hiemalis':'Nannus hiemalis'}
# Reviewed public catalog form, linked by Cornell to /species/redpol1.
# Keep this explicit: do not infer arbitrary hybrids/forms from name prefixes.
CATALOG_FORMS={'redpol1':{('Redpoll (Common)','Acanthis flammea flammea/rostrata')}}
def identity_matches(bird,row):
 names={worker.normalize(bird[k]) for k in ('name','acceptedName') if bird.get(k)}
 science={bird['scientificName'],SCI_RENAMES.get(bird['scientificName'])}-{None}
 return (worker.normalize(row.get('name','')) in names and row.get('scientificName') in science) or (row.get('name'),row.get('scientificName')) in CATALOG_FORMS.get(bird['id'],set())
def init(c):
 c.executescript('''CREATE TABLE IF NOT EXISTS photo_assets (
 species_id TEXT NOT NULL REFERENCES species(id),asset_id TEXT NOT NULL,
 observed_on TEXT,quarter INTEGER CHECK(quarter BETWEEN 1 AND 4),
 photo_json TEXT NOT NULL,source_url TEXT,checked_at REAL NOT NULL,
 PRIMARY KEY(species_id,asset_id),CHECK((observed_on IS NULL)=(quarter IS NULL)));
 CREATE TABLE IF NOT EXISTS photo_quarter_jobs (
 species_id TEXT NOT NULL REFERENCES species(id),quarter INTEGER NOT NULL CHECK(quarter BETWEEN 1 AND 4),
 taxon_order REAL NOT NULL,target_count INTEGER NOT NULL DEFAULT 2,
 state TEXT NOT NULL DEFAULT 'pending',last_checked REAL,source_url TEXT,
 PRIMARY KEY(species_id,quarter));''');c.commit()
def quarter(date):return (datetime.date.fromisoformat(date).month-1)//3+1
def canonical(value,host,pattern):
 u=urllib.parse.urlsplit(value or '')
 if u.scheme!='https' or u.netloc!=host or not re.fullmatch(pattern,u.path):raise ValueError('Invalid metadata reference')
 return 'https://'+host+u.path

def seed(c,catalog):
 with c:
  for bird in json.loads(pathlib.Path(catalog).read_text())['birds']:
   prior=c.execute('select state,photos,bird from species where id=?',(bird['id'],)).fetchone()
   refs={p['id']:p for p in json.loads(prior['photos'] or '[]')} if prior else {}
   refs.update({p['id']:{**refs.get(p['id'],{}),**p} for p in bird.get('photos',[])})
   existing=json.loads(prior['bird']) if prior else {}
   merged={**existing,**bird,'photos':list(refs.values())}
   state='ready' if refs else prior['state'] if prior else 'pending'
   c.execute("insert into species(id,bird,state,photos,updated) values(?,?,?,?,?) on conflict(id) do update set bird=excluded.bird,photos=excluded.photos,state=excluded.state,updated=excluded.updated",(bird['id'],json.dumps(merged),'ready' if state=='ready' else 'pending',json.dumps(list(refs.values())),time.time()))
 with c:
  for bird in json.loads(pathlib.Path(catalog).read_text())['birds']:
   for q in range(1,5):c.execute('insert or ignore into photo_quarter_jobs(species_id,quarter,taxon_order) values(?,?,?)',(bird['id'],q,bird.get('taxonOrder',0)))
   for p in bird['photos']:
    c.execute('insert or ignore into photo_assets values(?,?,?,?,?,?,?)',(bird['id'],p['id'],p.get('observationDate'),quarter(p['observationDate']) if p.get('observationDate') else None,json.dumps(p),p.get('metadataSource'),time.time()))
  c.execute("update photo_quarter_jobs set state='complete' where (select count(*) from photo_assets a where a.species_id=photo_quarter_jobs.species_id and a.quarter=photo_quarter_jobs.quarter)>=target_count")

def validate(payload,c):
 u=urllib.parse.urlsplit(payload['catalogUrl']);q=urllib.parse.parse_qs(u.query)
 if u.scheme!='https' or u.netloc!='media.ebird.org' or u.path!='/catalog':raise ValueError('Unexpected catalog')
 species=q.get('taxonCode',[None])[0];start=int(q.get('beginMonth',['0'])[0]);end=int(q.get('endMonth',['0'])[0]);which=(start-1)//3+1
 if not 1<=which<=4 or start!=(which-1)*3+1 or end!=which*3 or q.get('mediaType')!=['photo'] or q.get('view')!=['list']:raise ValueError('Expected one complete quarter of photo results')
 row=c.execute('select bird from species where id=?',(species,)).fetchone()
 if not row:raise ValueError('Enqueue species before metadata import')
 bird=json.loads(row['bird'])
 query='https://media.ebird.org/catalog?'+urllib.parse.urlencode({k:q[k][0] for k in ('birdOnly','taxonCode','mediaType','view','beginMonth','endMonth','sort') if k in q})
 if not payload['rows'] and payload.get('emptyVerified') is not True:raise ValueError('Empty catalog results need visible no-results confirmation')
 photos=[];seen=set()
 for r in payload['rows']:
  if not identity_matches(bird,r):raise ValueError('Photo species identity mismatch')
  if canonical(r.get('speciesUrl'),'ebird.org',r'/species/[a-z0-9]+')!='https://ebird.org/species/'+species:raise ValueError('Species URL mismatch')
  source=canonical(r.get('source'),'macaulaylibrary.org',r'/asset/\d+');ident=source.rsplit('/',1)[1]
  url=canonical(r.get('url'),'cdn.download.ams.birds.cornell.edu',r'/api/v2/asset/'+ident+r'/\d+')
  raw=r.get('observedAt','');date=raw[:10]
  try:datetime.datetime.fromisoformat(raw)
  except (ValueError,TypeError):raise ValueError('Exact observation date required')
  if quarter(date)!=which:raise ValueError('Observation date outside requested quarter; stale results rejected')
  owner=(r.get('photographer') or '').strip()
  if not owner:raise ValueError('Photographer credit required')
  checklist=canonical(r.get('checklist'),'ebird.org',r'/checklist/S\d+')
  if ident in seen:continue
  seen.add(ident)
  p=dict(id=ident,source=source,url=url,alt=r['name']+' - '+owner,photographer=owner,credit=r['name']+' © '+owner,observationDate=date,observationDateRaw=raw,observationDateSource='cornell-catalog-observation',quarter=which,metadataSource=query,checklist=checklist)
  p['catalogCommonName']=r['name'];p['catalogScientificName']=r['scientificName'];photos.append(p)
 return species,which,query,photos

def ingest(c,payload):
 species,q,source,photos=validate(payload,c)
 # Prefer independent checklists when the catalog offers a choice. Preserve
 # all valid observed candidates, but only two are needed for this MVP target.
 chosen=[];seen_checklists=set()
 for p in photos:
  if p['checklist'] not in seen_checklists:chosen.append(p);seen_checklists.add(p['checklist'])
 for p in photos:
  if p not in chosen:chosen.append(p)
 chosen=chosen[:2]
 with c:
  for p in chosen:
   old=c.execute('select observed_on from photo_assets where species_id=? and asset_id=?',(species,p['id'])).fetchone()
   if old and old['observed_on'] and old['observed_on']!=p['observationDate']:raise ValueError('Conflicting observation dates for existing asset')
   c.execute('insert into photo_assets values(?,?,?,?,?,?,?) on conflict(species_id,asset_id) do update set observed_on=excluded.observed_on,quarter=excluded.quarter,photo_json=excluded.photo_json,source_url=excluded.source_url,checked_at=excluded.checked_at',(species,p['id'],p['observationDate'],q,json.dumps(p),source,time.time()))
  count=c.execute('select count(*) from photo_assets where species_id=? and quarter=?',(species,q)).fetchone()[0]
  c.execute("update photo_quarter_jobs set state=?,last_checked=?,source_url=? where species_id=? and quarter=?",('complete' if count>=2 else 'partial' if count else 'no_results',time.time(),source,species,q))
  old=json.loads(c.execute('select photos from species where id=?',(species,)).fetchone()[0] or '[]');merged={p['id']:p for p in old};merged.update({p['id']:p for p in chosen})
  c.execute("update species set photos=?,state='ready',updated=? where id=?",(json.dumps(list(merged.values())),time.time(),species))
  c.execute('insert into events values(?,?,?,?,?)',(time.time(),species,'media.ebird.org','quarter_'+str(q)+'_metadata_verified',None))
 return dict(species=species,quarter=q,datedPhotos=count,state='complete' if count>=2 else 'partial' if count else 'no_results')

def plan(c,limit):
 rows=c.execute('''WITH coverage AS (SELECT j.species_id,j.quarter,j.taxon_order,j.state,count(a.asset_id) AS n FROM photo_quarter_jobs j LEFT JOIN photo_assets a ON a.species_id=j.species_id AND a.quarter=j.quarter GROUP BY j.species_id,j.quarter), totals AS (SELECT species_id,sum(case when n>=2 then 1 else 0 end) AS filled,sum(n) AS photos FROM coverage GROUP BY species_id)
 SELECT c.*,t.filled,t.photos FROM coverage c JOIN totals t USING(species_id) WHERE c.n<2 AND c.state='pending' ORDER BY t.filled,t.photos,c.taxon_order,c.quarter''').fetchall()
 # One queued quarter per species in a batch before revisiting that species.
 seen=set();jobs=[]
 for r in rows:
  if r['species_id'] in seen:continue
  seen.add(r['species_id']);q=r['quarter'];jobs.append(dict(species=r['species_id'],quarter=q,url='https://media.ebird.org/catalog?'+urllib.parse.urlencode(dict(birdOnly='true',taxonCode=r['species_id'],mediaType='photo',view='list',beginMonth=(q-1)*3+1,endMonth=q*3,sort='rating_rank_desc'))))
  if len(jobs)>=limit:break
 return jobs

def export(c,directory):
 directory.mkdir(parents=True,exist_ok=True)
 photos={}
 for row in c.execute('select species_id,photo_json from photo_assets order by species_id,asset_id'):photos.setdefault(row['species_id'],[]).append(json.loads(row['photo_json']))
 covered=c.execute('select count(*) from photo_quarter_jobs where state=\'complete\'').fetchone()[0];total=c.execute('select count(*) from photo_quarter_jobs').fetchone()[0]
 dated=c.execute('select count(*) from photo_assets where observed_on is not null').fetchone()[0];unknown=c.execute('select count(*) from photo_assets where observed_on is null').fetchone()[0]
 complete_species=c.execute("select count(*) from (select species_id from photo_quarter_jobs group by species_id having sum(case when state='complete' then 1 else 0 end)=4)").fetchone()[0]
 dated_species=c.execute('select count(distinct species_id) from photo_assets where observed_on is not null').fetchone()[0]
 report=dict(completeSpecies=complete_species,speciesWithDatedPhotos=dated_species,jobStates=dict(c.execute('select state,count(*) from photo_quarter_jobs group by state').fetchall()),updated=datetime.datetime.now(datetime.timezone.utc).isoformat(),species=total//4,quarterSlots=total,completeQuarterSlots=covered,datedPhotos=dated,undatedPhotos=unknown,targetPerQuarter=2)
 for name,value in [('dated-photos.json',photos),('coverage.json',report)]:
  dest=directory/name;temp=dest.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(dest)
 return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',type=pathlib.Path,default=worker.DEFAULT);p.add_argument('--seed',type=pathlib.Path);p.add_argument('--import-file',type=pathlib.Path);p.add_argument('--plan',type=int);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();c=worker.connect(a.db);init(c)
 if a.seed:seed(c,a.seed)
 if a.import_file:print(json.dumps(ingest(c,json.loads(a.import_file.read_text()))))
 report=export(c,a.output)
 if a.plan:print(json.dumps(plan(c,a.plan)))
 else:print(json.dumps(report))
