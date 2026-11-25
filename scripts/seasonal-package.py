"""Portable package validation and assembly; no network access."""
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile

SCHEMA='aviquiz-seasonal-package-v1'
def load(path): return json.loads(Path(path).read_text())
def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        while chunk:=f.read(1024*1024): h.update(chunk)
    return h.hexdigest()
def save(path,value): Path(path).write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')
def seal(folder,metadata):
    files={f.name:dict(bytes=f.stat().st_size,sha256=sha(f)) for f in sorted(folder.iterdir()) if f.name!='package.json' and f.is_file()}
    revision=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()
    save(folder/'package.json',{**metadata,'schema':SCHEMA,'files':files,'revision':revision})

def validate(folder):
    folder=Path(folder).resolve();package=load(folder/'package.json')
    if package.get('schema')!=SCHEMA or not re.fullmatch(r'(?:[A-Z]{2}(?:-[A-Z0-9]{1,12}){0,2}|L\d+)',package.get('geography','')): raise ValueError('Invalid package schema or geography')
    files=package['files']
    if not {'manifest.json','places.json','species.json'}<=files.keys(): raise ValueError('Required package files missing')
    total=0
    for name,info in files.items():
        if not re.fullmatch(r'[a-zA-Z0-9_.-]+',name) or name=='package.json': raise ValueError('Invalid package filename')
        file=folder/name
        if file.is_symlink() or file.resolve().parent!=folder or not file.is_file() or file.stat().st_size!=info['bytes'] or sha(file)!=info['sha256']: raise ValueError('Package file verification failed: '+name)
        total+=info['bytes']
    if package['revision']!=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest(): raise ValueError('Revision mismatch')
    index=load(folder/'manifest.json');catalog=load(folder/'species.json');nodes=load(folder/'places.json')['nodes']
    years=index['years'];birds=catalog['birds'];ids=[b['id'] for b in birds];place_ids=[n['id'] for n in nodes]
    if index.get('schema')!='aviquiz-place-facts-v1' or index.get('year_encoding')!='hex-bitset-lsb-first' or index['scope']!=package['geography'] or years!=package['years'] or index['release']!=package['release']: raise ValueError('Inconsistent package metadata')
    if len(years)!=2 or any(type(y)!=int for y in years) or not 1800<=years[0]<=years[1]<=9999 or years[1]-years[0]>1000: raise ValueError('Invalid year range')
    if len(ids)!=len(set(ids)) or any(not re.fullmatch('[a-z0-9]+',i) for i in ids) or len(ids)!=package['species_count']: raise ValueError('Invalid species catalog')
    if len(place_ids)!=len(set(place_ids)) or set(place_ids)!=set(index['places']) or len(place_ids)!=package['place_count']: raise ValueError('Invalid place catalog')
    for bird in birds:
        for photo in bird.get('photos',[]): validate_photo(photo)
    chunks=index['chunks'];counts=dict(effort_days=0,detection_days=0)
    for chunk_number,chunk in enumerate(chunks):
        if chunk['key'] not in files or files[chunk['key']]!={k:chunk[k] for k in ('bytes','sha256')}: raise ValueError('Chunk metadata mismatch')
        entries=sorted((e for e in index['places'].values() if e['chunk']==chunk_number),key=lambda e:e['offset']);position=0
        with (folder/chunk['key']).open('rb') as f:
            for entry in entries:
                if entry['offset']!=position or not 0<entry['length']<=32*1024**2 or not 0<entry['rawBytes']<=32*1024**2: raise ValueError('Invalid record bounds')
                compressed=f.read(entry['length']);position+=len(compressed)
                if len(compressed)!=entry['length'] or hashlib.sha256(compressed).hexdigest()!=entry['sha256']: raise ValueError('Invalid record digest')
                import io
                with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as gz: raw=gz.read(entry['rawBytes']+1)
                if len(raw)!=entry['rawBytes']: raise ValueError('Invalid raw size')
                facts=json.loads(raw)
                def masks(rows):
                    result={}
                    for day,mask in rows:
                        datetime.date.fromisoformat('2000-'+day)
                        if day in result or not isinstance(mask,str) or not re.fullmatch('[0-9a-f]+',mask) or not 0<int(mask,16)<1<<(years[1]-years[0]+1): raise ValueError('Invalid day mask')
                        result[day]=int(mask,16)
                    return result
                effort=masks(facts['e']);counts['effort_days']+=sum(v.bit_count() for v in effort.values())
                for bird,rows in facts['b'].items():
                    if not bird.isdigit() or not 0<=int(bird)<len(birds): raise ValueError('Invalid bird index')
                    for day,mask in masks(rows).items():
                        if mask&~effort.get(day,0): raise ValueError('Detection without effort')
                        counts['detection_days']+=mask.bit_count()
            if position!=chunk['bytes']: raise ValueError('Unreferenced chunk bytes')
    if any(type(e['chunk'])!=int or not 0<=e['chunk']<len(chunks) for e in index['places'].values()): raise ValueError('Invalid chunk reference')
    return dict(valid=True,geography=package['geography'],revision=package['revision'],species=len(birds),places=len(place_ids),bytes=total,**counts)

def validate_photo(p):
    ident=str(p['id'])
    if not ident.isdigit() or p.get('source')!='https://macaulaylibrary.org/asset/'+ident or not re.fullmatch(r'https://cdn.download.ams.birds.cornell.edu/api/v2/asset/'+ident+r'/\d+',p.get('url','')) or not p.get('photographer') or not p.get('credit'): raise ValueError('Invalid Cornell photo reference or missing credit')
    if p.get('observationDate'): datetime.date.fromisoformat(p['observationDate'])

def assemble(source,output,photo_db,catalogs=()):
    source=Path(source).resolve();output=Path(output).resolve();validate(source)
    if output.exists(): raise ValueError('Use a new assembly output directory')
    if shutil.disk_usage(output.parent).free<60*1024**3: raise ValueError('60 GiB free reserve required')
    refs={}
    c=sqlite3.connect(Path(photo_db).resolve().as_uri()+'?mode=ro',uri=True)
    try:
        c.execute('BEGIN')
        for ident,bird,photos in c.execute('select id,bird,photos from species'):
            refs[ident]=(load_json(bird)['scientificName'],{str(p['id']):p for p in json.loads(photos or '[]')})
        for ident,raw in c.execute('select species_id,photo_json from photo_assets'):
            p=json.loads(raw)
            if ident in refs: refs[ident][1][str(p['id'])]=p
    finally: c.close()
    for file in catalogs:
        for b in load(file)['birds']:
            if b['id'] not in refs: refs[b['id']]=(b['scientificName'],{})
            if refs[b['id']][0]!=b['scientificName']: continue
            for p in b.get('photos',[]): refs[b['id']][1].setdefault(str(p['id']),p)
    output.parent.mkdir(parents=True,exist_ok=True)
    temp=Path(tempfile.mkdtemp(prefix='.assembly-',dir=output.parent))
    try:
        package=load(source/'package.json')
        for name in package['files']: shutil.copyfile(source/name,temp/name)
        catalog=load(temp/'species.json');coverage=[]
        for bird in catalog['birds']:
            entry=refs.get(bird['id']);photos={str(p['id']):p for p in bird.get('photos',[])}
            if entry and entry[0]==bird['scientificName']: photos.update(entry[1])
            for p in photos.values(): validate_photo(p)
            bird['photos']=sorted(photos.values(),key=lambda p:str(p['id']))
            counts={q:0 for q in range(1,5)}
            for p in bird['photos']:
                if p.get('observationDate'): counts[(int(p['observationDate'][5:7])-1)//3+1]+=1
            coverage.append(dict(id=bird['id'],photos=len(photos),quarters=counts))
        save(temp/'species.json',catalog);save(temp/'photo-coverage.json',{'species':coverage,'targetPerQuarter':2})
        seal(temp,package);result=validate(temp);temp.rename(output)
        return {**result,'package':str(output),'with_photos':sum(bool(b['photos']) for b in catalog['birds'])}
    except BaseException: shutil.rmtree(temp);raise

def load_json(raw): return json.loads(raw)
