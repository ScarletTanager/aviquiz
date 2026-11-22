#!/usr/bin/env python3
"""Export public seasonal occurrence masks; no checklist or observer records."""
import argparse,gzip,hashlib,json,pathlib,sqlite3,subprocess,sys
p=argparse.ArgumentParser();p.add_argument('--database',required=True);p.add_argument('--taxonomy',required=True);p.add_argument('--output',required=True);p.add_argument('--regions',required=True);p.add_argument('--hotspots',required=True);a=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
c=sqlite3.connect('file:'+a.database+'?mode=ro',uri=True)
tax=json.load(open(a.taxonomy));by_sci={t['sciName']:t for t in tax};by_sci['Troglodytes hiemalis']=by_sci['Nannus hiemalis']
# Only references and credits travel to the serving catalog, never media files.
verified_path=root.parents[1]/'outputs/photo_metadata/verified-photos.json'
verified=json.load(open(verified_path)) if verified_path.exists() else {}
for file in verified_path.parent.glob('*/verified-photos.json'):verified.update(json.loads(file.read_text()))
legacy=json.load(open(root/'dist/data.json'))['birds'];photos={b['scientificName']:b['photos'] for b in legacy}
for references in photos.values():
 for photo in references:
  assert str(photo['id']).isdigit() and photo['source']=='https://macaulaylibrary.org/asset/'+str(photo['id'])
  assert photo['url'].startswith('https://cdn.download.ams.birds.cornell.edu/api/v2/asset/'+str(photo['id'])+'/')
  assert photo.get('credit')
source=c.execute('select distinct t.taxon_key,t.scientific_name,t.common_name from ebd_taxon t join ebd_detection_day d using(taxon_key,taxonomy_version) where d.observation_year between 2017 and 2025 order by t.scientific_name').fetchall()
birds=[];keys={}
for key,sci,name in source:
 t=by_sci[sci];keys[key]=len(birds);birds.append(dict(id=t['speciesCode'],name=t['comName'],acceptedName=name,scientificName=sci,family=t['familySciName'],taxonOrder=t['taxonOrder'],photos=photos.get(sci,[]) or verified.get(t['speciesCode'],[]),sites=[],worldLifer=False,colombiaLifer=False))
# Each pair is [MM-DD, bitmask of complete historical years 2017..2025].
index={};chunk=bytearray();chunks=[]
def flush():
 global chunk
 if not chunk:return
 name=f'nc-{len(chunks):03}.bin';data=bytes(chunk);(out/name).write_bytes(data);chunks.append(dict(key=name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest()));chunk=bytearray()
for number,(place,kind,source_key) in enumerate(c.execute('select place_id,kind,source_key from ebd_place order by place_id')):
 effort={};detections={}
 for date,year in c.execute('select observation_date,observation_year from ebd_effort_day where place_id=? and observation_year between 2017 and 2025',(place,)):
  md=date[5:];effort[md]=effort.get(md,0)|(1<<(year-2017))
 if not effort:continue
 for key,date,year in c.execute('select taxon_key,observation_date,observation_year from ebd_detection_day where place_id=? and observation_year between 2017 and 2025',(place,)):
  k=keys[key];md=date[5:];row=detections.setdefault(k,{});row[md]=row.get(md,0)|(1<<(year-2017))
 obj=dict(e=list(effort.items()),b={str(k):list(v.items()) for k,v in detections.items()})
 raw=json.dumps(obj,separators=(',',':')).encode();data=gzip.compress(raw,mtime=0)
 if len(chunk)+len(data)>4*1024*1024:flush()
 index[place]=dict(chunk=len(chunks),offset=len(chunk),length=len(data),sha256=hashlib.sha256(data).hexdigest(),rawBytes=len(raw),kind='hotspot' if kind=='hotspot' else ('subnational1' if place=='US-NC' else 'subnational2'))
 chunk.extend(data)
 if number%500==0:print('Exported',number,'places',flush=True)
flush()
manifest=dict(schema=1,release='relSep2026',years=[2017,2025],places=index,chunks=chunks)
(root/'worker/nc-index.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
family_order={}
for t in tax:family_order[t['familySciName']]=min(family_order.get(t['familySciName'],1e9),t['taxonOrder'])
(root/'dist/nc-birds.json').write_text(json.dumps(dict(birds=birds,familyOrder=family_order),separators=(',',':'))+'\n')
coverage=dict(species=len(birds),withPhotos=sum(bool(b['photos']) for b in birds),pending=[b['id'] for b in birds if not b['photos']],policy='Preserve verified Macaulay references. Unresolved species remain queued; persistent automated-access challenges prohibit further retries without resolution.')
(out/'photo-coverage.json').write_text(json.dumps(coverage,indent=2)+'\n');(out/'manifest.json').write_text(json.dumps(manifest)+'\n')
print(json.dumps(dict(places=len(index),species=len(birds),withPhotos=coverage['withPhotos'],bytes=sum(x['bytes'] for x in chunks))))

nodes=[dict(id='US-NC',name='North Carolina',kind='subnational1',parent='US')]
for file in [a.regions,a.hotspots]:
 for n in json.load(open(file))['children']:
  if n['kind']=='hotspot':n['parent']=n.get('subnational2') or 'US-NC'
  nodes.append(n)
(root/'dist/nc-locations.json').write_text(json.dumps(dict(nodes=nodes),separators=(',',':'))+'\n')

# Feed the durable worker on every export; this never resets a host block.
subprocess.run([sys.executable,str(root/'scripts/photo-metadata-worker.py'),'--enqueue',str(root/'dist/nc-birds.json')],check=True)
subprocess.run([sys.executable,str(root/'scripts/photo-metadata-worker.py'),'--host','search.macaulaylibrary.org','--db',str(verified_path.parent/'macaulay/queue.sqlite'),'--enqueue',str(root/'dist/nc-birds.json')],check=True)
