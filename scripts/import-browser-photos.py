#!/usr/bin/env python3
"""Validate saved visible browser metadata and merge into an existing queue. No HTTP."""
import argparse,html,importlib.util,json,pathlib,re,time
spec=importlib.util.spec_from_file_location('photo_worker',pathlib.Path(__file__).with_name('photo-metadata-worker.py'));worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
def ingest(c,records):
 prepared=[]
 for record in records:
  match=re.fullmatch(r'https://ebird\.org/species/([a-z0-9]+)(?:\?continue)?',record.get('page',''))
  if not match:raise ValueError('Unexpected species page')
  ident=match[1];row=c.execute('select bird,photos from species where id=?',(ident,)).fetchone()
  if row is None:raise ValueError('Species must first be enqueued')
  bird=json.loads(row['bird'])
  scientific=bird.get('scientificName')
  # Explicit genus rename verified against the eBird taxonomy used by the NC export.
  names={scientific,{'Troglodytes hiemalis':'Nannus hiemalis'}.get(scientific)}-{None}
  if not names or record.get('heading') not in {bird['name']+' '+name for name in names} or record.get('title')!=bird['name']+' - eBird':raise ValueError('Species page identity mismatch')
  text='<meta property="og:image" content="'+html.escape(record.get('url',''),quote=True)+'"><meta property="og:image:alt" content="'+html.escape(record.get('alt',''),quote=True)+'">'
  photo=worker.parse_photo(text,bird)
  if photo is None:raise ValueError('Missing or inconsistent image metadata')
  photos=json.loads(row['photos']) if row['photos'] else []
  if not any(p['id']==photo['id'] for p in photos):photos.append(photo)
  prepared.append((ident,photos))
 # Validate the whole batch before updating any species; leave host blocks intact.
 with c:
  for ident,photos in prepared:
   c.execute("update species set state='ready',photos=?,updated=? where id=?",(json.dumps(photos),time.time(),ident))
   c.execute('insert into events values(?,?,?,?,?)',(time.time(),ident,'ebird.org','browser_metadata_verified',None))
 return len(prepared)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--db',type=pathlib.Path,required=True);p.add_argument('--input',type=pathlib.Path,required=True);args=p.parse_args()
 c=worker.connect(args.db);count=ingest(c,json.loads(args.input.read_text()));worker.export(c,args.db.parent/'verified-photos.json');worker.report(c,args.db.parent/'status.json');print(json.dumps(dict(imported=count)))
