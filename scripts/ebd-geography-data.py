"""Offline stages for the standalone geography pipeline. No network or app writes."""
import datetime
import gzip
import hashlib
import importlib.util
import json
import pathlib
import re
import shutil
import sqlite3
import time

HERE=pathlib.Path(__file__).resolve().parent
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
aggregate=module('geo_aggregate','ebd-aggregate-region.py');p=aggregate.p;b=p.benchmark
seasonal=module('geo_photos','seasonal-photo-metadata.py')
GIB=1024**3

def atomic(path,value):
 path=pathlib.Path(path);temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)

def load(path):return json.loads(pathlib.Path(path).read_text())

def validate_scope(scope,parent=None):
 if re.fullmatch(r'L\d+',scope):
  if not parent or not re.fullmatch(r'[A-Z]{2}(?:-[A-Z0-9]{1,12}){0,2}',parent):raise ValueError('A hotspot needs --parent with a country/region code')
 elif not re.fullmatch(r'[A-Z]{2}(?:-[A-Z0-9]{1,12}){0,2}',scope):raise ValueError('Use an eBird country, subregion, county, or public hotspot code')
 return scope

def tick(config,phase,**metrics):
 if time.monotonic()>config['_deadline']:raise b.LimitReached('Job runtime limit reached')
 if shutil.disk_usage(config['directory']).free<config['reserve_free_bytes']:raise b.LimitReached('Free disk reserve reached')
 now=time.monotonic()
 if now-config.get('_progress_at',0)>2:
  config['_progress_at']=now;atomic(pathlib.Path(config['directory'])/'progress.json',dict(phase=phase,updated_at=p.stamp(),**metrics))

def checksum(file,config):
 digest=hashlib.sha256();done=0
 with pathlib.Path(file).open('rb') as stream:
  while block:=stream.read(4*1024*1024):
   digest.update(block);done+=len(block);tick(config,'verifying_source',source=pathlib.Path(file).name,bytes_read=done)
 return digest.hexdigest()

def checked_source(root,item,kind,config):
 source=aggregate.safe_path(root,item['files'][kind]['path']);expected=item['files'][kind]
 if source.stat().st_size!=expected['bytes'] or checksum(source,config)!=expected['sha256']:raise ValueError('Source partition checksum mismatch')
 return source

def source_plan(config):
 scope=config['scope'];container=config.get('parent') or scope
 if config.get('manifest'):
  manifest=load(config['manifest']);root=pathlib.Path(config['manifest']).resolve().parent
  if manifest.get('status')!='partitioned' or manifest.get('schema')!='aviquiz-ebd-partitions-v1':raise ValueError('A completed paired partition manifest is required')
  selected=[e for e in manifest['partitions'] if e['region']==container or container.startswith(e['region']+'-') or e['region'].startswith(container+'-')]
  if not selected:raise ValueError('No source partition covers this geography')
  return manifest,root,selected
 return {'release':config['release'],'partitions':[]},None,[None]

def extract(config):
 out=pathlib.Path(config['directory']);scope=config['scope'];manifest,root,selected=source_plan(config)
 entry=dict(region=scope,name=scope,rows={},files={});taxa={};parents={};names={};counts={}
 archive_hashes={};original_sources={}
 def remember(row):
  key=row['TAXON CONCEPT ID'];value=[row['CATEGORY'],row['SCIENTIFIC NAME'],row['COMMON NAME']]
  if not key:raise ValueError('Missing source taxon identifier')
  if value[0]=='species':parents[key]=value
  if aggregate.in_scope(row,scope):
   if key in taxa and taxa[key]!=value:raise ValueError('Conflicting source taxonomy identity')
   taxa[key]=value
 def place_names(row):
  country,state,county=row['COUNTRY CODE'],row['STATE CODE'],row['COUNTY CODE']
  names.setdefault(country,dict(id=country,name=row.get('COUNTRY') or country,kind='country',parent='world'))
  if state and not state.endswith('-'):names.setdefault(state,dict(id=state,name=row.get('STATE') or state,kind='subnational1',parent=country))
  if county and not county.endswith('-') and not county.endswith('-000'):names.setdefault(county,dict(id=county,name=row.get('COUNTY') or county,kind='subnational2',parent=state or country))
  if row['LOCALITY TYPE']=='H':
   ident=row['LOCALITY ID'];parent=county if county in names else state if state in names else country
   names.setdefault(ident,dict(id=ident,name=row.get('LOCALITY') or ident,kind='hotspot',parent=parent))
 for kind in ['sampling','observations']:
  output=out/(kind+'.tsv.gz');scanned=retained=0
  with output.open('wb') as raw,gzip.GzipFile(fileobj=raw,mode='wb',mtime=0) as target:
   target.write(('\t'.join(p.PROJECTION[kind])+'\n').encode())
   for item in selected:
    source=checked_source(root,item,kind,config) if item else pathlib.Path(config[kind])
    before=p.identity(source);original_sources[str(source)]=before
    if item is None:archive_hashes[kind]=checksum(source,config)
    with b.source(source) as (stream,metadata,compressed):
     header,_=b.fields(stream)
     if not set(p.PROJECTION[kind])<=set(header):raise ValueError('Missing required EBD '+kind+' fields')
     for row in b.records(stream,header,config['_deadline']):
      scanned+=1
      if kind=='observations':remember(row)
      if aggregate.in_scope(row,scope):
       day=datetime.date.fromisoformat(row['OBSERVATION DATE'])
       if day.isoformat()!=row['OBSERVATION DATE'] or day.year<1800:raise ValueError('Invalid observation date')
       if not row['SAMPLING EVENT IDENTIFIER'] or not row['LOCALITY ID']:raise ValueError('Missing event or locality')
       target.write(('\t'.join(row[k] for k in p.PROJECTION[kind])+'\n').encode());retained+=1
       if kind=='sampling':place_names(row)
      if scanned%10000==0:tick(config,'extracting_'+kind,rows_scanned=scanned,rows_retained=retained,compressed_bytes=compressed.tell() if compressed else None,source=source.name)
    if before!=p.identity(source):raise ValueError('Source changed while reading')
  entry['rows'][kind]=retained;entry['files'][kind]=dict(path=output.name,bytes=output.stat().st_size,sha256=checksum(output,config))
  counts[kind]=dict(scanned=scanned,retained=retained)
 if not entry['rows']['sampling']:raise ValueError('No sampling events found for requested scope')
 required={v[1] for v in taxa.values() if v[0] in ('species','issf','form','intergrade')}
 species={v[1] for v in parents.values() if v[0]=='species'};provenance=[]
 if required-species and root:
  for other in manifest['partitions']:
   if other in selected:continue
   source=checked_source(root,other,'observations',config);found=False;rows=0
   with b.source(source) as (stream,_,_):
    header,_=b.fields(stream)
    for row in b.records(stream,header,config['_deadline']):
     rows+=1
     if row['CATEGORY']=='species' and row['SCIENTIFIC NAME'] in required-species:
      parents[row['TAXON CONCEPT ID']]=[row['CATEGORY'],row['SCIENTIFIC NAME'],row['COMMON NAME']];species.add(row['SCIENTIFIC NAME']);found=True
     if rows%10000==0:tick(config,'resolving_source_taxonomy',source=other['region'],rows_scanned=rows,unresolved_species=len(required-species))
     if not required-species:break
   if found:provenance.append(dict(region=other['region'],source_sha256=other['files']['observations']['sha256']))
   if not required-species:break
 if required-species:
  atomic(out/'taxonomy-unresolved.json',sorted(required-species));raise ValueError('Source species parents unresolved; see taxonomy-unresolved.json')
 own_species={k for k,v in taxa.items() if v[0]=='species'}
 own_names={taxa[k][1] for k in own_species}
 external={k:v for k,v in parents.items() if k not in own_species and v[1] in required-own_names}
 profile=dict(rows=entry['rows']['observations'],observation_source_sha256=entry['files']['observations']['sha256'],taxa=taxa,external_species_parents=external,parent_provenances=provenance)
 foreign=[e for e in manifest['partitions'] if not (e['region']==scope or e['region'].startswith(scope+'-'))]
 # Foreign references remain immutable inputs, never duplicated geographic extracts.
 # safe_path requires a common source root. References are expressed relative to
 # the original manifest root in a separate provenance manifest, not path escapes.
 generated=dict(schema='aviquiz-ebd-partitions-v1',status='partitioned',release=manifest['release'],partitions=[entry],scope=scope,source_counts=counts,place_names=names)
 if root:
  generated['foreign_manifest']=str(pathlib.Path(config['manifest']).resolve())
  # Aggregator accepts explicitly verified immutable foreign references below.
  generated['foreign_partitions']=foreign
 else:
  source=pathlib.Path(config['sampling']);generated['external_sampling']=dict(path=str(source.resolve()),bytes=source.stat().st_size,sha256=archive_hashes['sampling'])
  if external:profile['parent_archive_provenance']=dict(path=str(pathlib.Path(config['observations']).resolve()),bytes=pathlib.Path(config['observations']).stat().st_size,sha256=archive_hashes['observations'])
 atomic(out/'taxonomy-profile.json',profile);atomic(out/'manifest.json',generated)
 return dict(manifest=str(out/'manifest.json'),profile=str(out/'taxonomy-profile.json'),counts=counts)

def export(config):
 out=pathlib.Path(config['directory']);database=pathlib.Path(config['daily_database']);extract_manifest=load(config['extract_manifest']);geo=config['scope']
 taxonomy=load(config['taxonomy']);by_sci={t['sciName']:t for t in taxonomy if t.get('category','species')=='species'}
 if 'Nannus hiemalis' in by_sci:by_sci['Troglodytes hiemalis']=by_sci['Nannus hiemalis']
 refs={}
 for source in config.get('photo_sources',[]):
  if not pathlib.Path(source).exists():continue
  value=load(source)
  if 'birds' in value:value={bird['id']:bird.get('photos',[]) for bird in value['birds']}
  for ident,photos in value.items():refs.setdefault(ident,{}).update({str(photo['id']):photo for photo in photos})
 first,last=config['first_year'],config['last_year'];c=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)
 birds=[];keys={};unresolved=[];identities=set()
 try:
  for key,sci,name in c.execute('select distinct t.taxon_key,t.scientific_name,t.common_name from ebd_taxon t join ebd_detection_day d using(taxon_key,taxonomy_version) where d.observation_year between ? and ? order by t.scientific_name',(first,last)):
   taxon=by_sci.get(sci)
   if not taxon:unresolved.append(dict(source_taxon=key,scientific_name=sci,common_name=name));continue
   if taxon['speciesCode'] in identities:raise ValueError('Multiple source species map to the same current species: '+taxon['speciesCode'])
   identities.add(taxon['speciesCode'])
   keys[key]=len(birds);ident=taxon['speciesCode'];birds.append(dict(id=ident,name=taxon['comName'],acceptedName=name,scientificName=taxon['sciName'],family=taxon['familySciName'],taxonOrder=taxon['taxonOrder'],photos=list(refs.get(ident,{}).values()),sites=[],worldLifer=False,colombiaLifer=False))
  if unresolved:
   atomic(out/'taxonomy-unresolved.json',unresolved);raise ValueError('Current taxonomy mapping unresolved; see taxonomy-unresolved.json')
  serving=out/'serving';serving.mkdir();index={};chunks=[];chunk=bytearray();prefix=geo.lower()
  def flush():
   if not chunk:return
   name=f'{prefix}-{len(chunks):03}.bin';data=bytes(chunk);(serving/name).write_bytes(data);chunks.append(dict(key=name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()));chunk.clear()
  places=[]
  for number,(place,kind) in enumerate(c.execute('select place_id,kind from ebd_place order by place_id').fetchall()):
   effort={};detections={}
   for day,year in c.execute('select observation_date,observation_year from ebd_effort_day where place_id=? and observation_year between ? and ?',(place,first,last)):effort[day[5:]]=effort.get(day[5:],0)|(1<<(year-first))
   if not effort:continue
   for key,day,year in c.execute('select taxon_key,observation_date,observation_year from ebd_detection_day where place_id=? and observation_year between ? and ?',(place,first,last)):
    row=detections.setdefault(keys[key],{});row[day[5:]]=row.get(day[5:],0)|(1<<(year-first))
   raw=json.dumps(dict(e=list(effort.items()),b={str(k):list(v.items()) for k,v in detections.items()}),separators=(',',':')).encode();data=gzip.compress(raw,mtime=0)
   if len(chunk)+len(data)>4*1024*1024:flush()
   node=extract_manifest['place_names'].get(place,dict(id=place,name=place,kind='hotspot' if place.startswith('L') else 'region',parent=geo if place!=geo else None));places.append(node)
   index[place]=dict(chunk=len(chunks),offset=len(chunk),length=len(data),sha256=hashlib.sha256(data).hexdigest(),rawBytes=len(raw),kind=node['kind']);chunk.extend(data)
   tick(config,'exporting',places=number+1,species=len(birds))
  flush()
 finally:c.close()
 manifest=dict(schema=1,release=extract_manifest['release'],scope=geo,years=[first,last],places=index,chunks=chunks)
 atomic(serving/'manifest.json',manifest);atomic(serving/'places.json',dict(nodes=places))
 order={}
 for taxon in taxonomy:
  family=taxon.get('familySciName')
  if family:order[family]=min(order.get(family,1e9),taxon['taxonOrder'])
 catalog=out/'photo-catalog.json';atomic(catalog,dict(birds=birds,familyOrder=order))
 photos=out/'photos';photos.mkdir();queue=photos/'queue.sqlite';connection=seasonal.worker.connect(queue);seasonal.init(connection);seasonal.seed(connection,catalog);coverage=seasonal.export(connection,photos);connection.close()
 return dict(species=len(birds),places=len(places),serving_bytes=sum(x['bytes'] for x in chunks),photo_catalog=str(catalog),photo_queue=str(queue),photo_output=str(photos),photo_coverage=coverage)
