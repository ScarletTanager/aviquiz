#!/usr/bin/env python3
"""Durable, single-process Cornell metadata queue. Never downloads photographs."""
import argparse,datetime,fcntl,html,json,os,pathlib,re,signal,sqlite3,time,urllib.request,urllib.error
from html.parser import HTMLParser
ROOT=pathlib.Path(__file__).resolve().parents[1]
DEFAULT=ROOT.parents[1]/'outputs/photo_metadata/queue.sqlite'
HOST='ebird.org';COOLDOWN=1800
class Meta(HTMLParser):
 def __init__(self):super().__init__();self.values={}
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='meta':self.values[a.get('property',a.get('name',''))]=a.get('content','')
def normalize(text):return re.sub(r'[^a-z0-9]','',(text or '').lower())
def parse_photo(text,bird):
 # Challenge responses are never a metadata source, even if they contain OG tags.
 if challenged(text):return None
 if text.lstrip().startswith('{'):
  try:payload=json.loads(text)
  except ValueError:return None
  def records(value):
   if isinstance(value,dict):
    yield value
    for item in value.values():yield from records(item)
   elif isinstance(value,list):
    for item in value:yield from records(item)
  for record in records(payload):
   if str(record.get('mediaType','')).lower()!='photo':continue
   name=record.get('commonName','');owner=record.get('userDisplayName','');ident=str(record.get('assetId',''))
   if not ident.isdigit() or not owner or normalize(name) not in {normalize(bird.get(k,'')) for k in ('name','acceptedName')}:continue
   return dict(id=ident,source='https://macaulaylibrary.org/asset/'+ident,url='https://cdn.download.ams.birds.cornell.edu/api/v2/asset/'+ident+'/1200',alt=name+' - '+owner,photographer=owner,credit=name+' © '+owner)
  return None
 p=Meta();p.feed(text);url=p.values.get('og:image','');alt=html.unescape(p.values.get('og:image:alt',''))
 match=re.fullmatch(r'https://cdn\.download\.ams\.birds\.cornell\.edu/api/v2/asset/(\d+)/(\d+)',url)
 if not match or ' - ' not in alt:return None
 species,photographer=alt.rsplit(' - ',1)
 if not photographer.strip() or normalize(species) not in {normalize(bird.get(k,'')) for k in ('name','acceptedName')}:return None
 ident=match[1]
 return dict(id=ident,source='https://macaulaylibrary.org/asset/'+ident,url=url,alt=alt,photographer=photographer,credit=species+' © '+photographer)
def challenged(text):return bool(re.search(r'anubis|making sure you.{0,15}not a bot|captcha|challenge-platform',text,re.I))
def connect(path):
 path.parent.mkdir(parents=True,exist_ok=True)
 c=sqlite3.connect(path,timeout=30);c.row_factory=sqlite3.Row;c.execute('pragma journal_mode=WAL')
 c.executescript('''CREATE TABLE IF NOT EXISTS species(id TEXT PRIMARY KEY,bird TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',photos TEXT,updated REAL NOT NULL);
 CREATE TABLE IF NOT EXISTS hosts(host TEXT PRIMARY KEY,state TEXT NOT NULL,retry_at REAL NOT NULL DEFAULT 0,challenges INTEGER NOT NULL DEFAULT 0,last_request REAL NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS events(time REAL NOT NULL,species TEXT,host TEXT,outcome TEXT NOT NULL,http_status INTEGER);
 ''');c.execute("insert or ignore into hosts(host,state) values(?,'ready')",(HOST,));c.commit();return c
def event(c,species,outcome,status=None):
 c.execute('insert into events values(?,?,?,?,?)',(time.time(),species,HOST,outcome,status));c.commit()
def enqueue(c,files):
 for file in files:
  for b in json.loads(pathlib.Path(file).read_text())['birds']:
   if not re.fullmatch('[a-z0-9]+',b['id']):raise ValueError('Invalid species code')
   prior=c.execute('select state,photos from species where id=?',(b['id'],)).fetchone()
   refs={p['id']:p for p in json.loads(prior['photos'] or '[]')} if prior else {}
   for photo in b.get('photos',[]):refs[photo['id']]={**refs.get(photo['id'],{}),**photo}
   state='ready' if refs else prior['state'] if prior else 'pending'
   c.execute("insert into species(id,bird,state,photos,updated) values(?,?,?,?,?) on conflict(id) do update set bird=excluded.bird,photos=excluded.photos,state=excluded.state",(b['id'],json.dumps(b),state,json.dumps(list(refs.values())) if refs else None,time.time()))
 c.commit()
def export(c,path):
 value={r['id']:json.loads(r['photos']) for r in c.execute("select id,photos from species where state='ready' order by id")}
 temp=path.with_suffix('.'+str(os.getpid())+'.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');temp.replace(path)
def report(c,path):
 value=dict(updated=datetime.datetime.now(datetime.timezone.utc).isoformat(),counts=dict(c.execute('select state,count(*) from species group by state').fetchall()),hosts=[dict(r) for r in c.execute('select * from hosts')])
 tmp=path.with_suffix('.'+str(os.getpid())+'.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');tmp.replace(path)
 log=path.parent/'access-log.tsv';temp=log.with_suffix('.'+str(os.getpid())+'.tmp')
 lines=['time_utc\thost\tspecies\toutcome\thttp_status']
 for row in c.execute('select * from events order by time'):
  lines.append('\t'.join([datetime.datetime.fromtimestamp(row['time'],datetime.timezone.utc).isoformat(),row['host'],row['species'] or '',row['outcome'],str(row['http_status'] or '')]))
 temp.write_text('\n'.join(lines)+'\n');temp.replace(log);return value

def record_challenge(c,species,status=200):
 host=c.execute('select * from hosts where host=?',(HOST,)).fetchone()
 challenges=host['challenges']+1;state='blocked' if challenges>=2 else 'cooldown'
 c.execute('update species set updated=0 where id=?',(species,))
 c.execute('update hosts set state=?,challenges=?,retry_at=? where host=?',(state,challenges,time.time()+COOLDOWN,HOST));c.commit();event(c,species,'challenge_'+state,status)

def run(c,args):
 lock=open(str(args.db)+'.lock','a')
 try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:raise SystemExit('A worker already holds this queue.')
 (args.db.parent/'worker.pid').write_text(str(os.getpid())+'\n')
 stop=False
 def halt(*_):
  nonlocal stop;stop=True
 signal.signal(signal.SIGTERM,halt);signal.signal(signal.SIGINT,halt)
 deadline=time.time()+args.hours*3600;requests=0
 while not stop and time.time()<deadline:
  export(c,args.db.parent/'verified-photos.json');report(c,args.db.parent/'status.json')
  host=c.execute('select * from hosts where host=?',(HOST,)).fetchone()
  row=c.execute("select * from species where state='pending' order by updated,id limit 1").fetchone()
  if not row or host['state']=='blocked' or requests>=args.max_requests:time.sleep(5);continue
  due=max(host['retry_at'],host['last_request']+args.interval)
  if time.time()<due:time.sleep(min(5,due-time.time()));continue
  b=json.loads(row['bird']);url=('https://ebird.org/species/'+row['id']) if HOST=='ebird.org' else ('https://search.macaulaylibrary.org/catalog.json?taxonCode='+row['id']+'&mediaType=photo&count=1')
  c.execute('update hosts set last_request=? where host=?',(time.time(),HOST));c.commit();requests+=1
  status=None;text='';retry_after=COOLDOWN
  try:
   # Reject redirects rather than follow a challenge to another endpoint.
   class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_):return None
   req=urllib.request.Request(url,headers={'User-Agent':'AviQuiz metadata worker (low-rate; no media downloads)','Accept':'text/html'})
   with urllib.request.build_opener(NoRedirect).open(req,timeout=30) as response:
    if not any(t in response.headers.get('content-type','') for t in ('text/html','application/json')):raise ValueError('Expected metadata HTML')
    status=response.status;raw=response.read(2*1024*1024+1)
    if len(raw)>2*1024*1024:raise ValueError('Metadata response exceeds limit')
    text=raw.decode('utf-8',errors='replace')
  except urllib.error.HTTPError as e:
   status=e.code
   value=e.headers.get('Retry-After','')
   if value.isdigit():retry_after=max(COOLDOWN,int(value))
   elif value:
    try:
     from email.utils import parsedate_to_datetime
     retry_after=max(COOLDOWN,parsedate_to_datetime(value).timestamp()-time.time())
    except (ValueError,TypeError,OverflowError):pass
  except (OSError,ValueError) as e:
   event(c,row['id'],'network_or_size_error');c.execute('update hosts set retry_at=? where host=?',(time.time()+COOLDOWN,HOST));c.commit();continue
  if challenged(text) or status in (401,403):
   record_challenge(c,row['id'],status);continue
  if status==429 or status is None or status>=500:
   c.execute('update hosts set retry_at=? where host=?',(time.time()+retry_after,HOST));c.commit();event(c,row['id'],'rate_or_server_backoff',status);continue
  photo=parse_photo(text,b) if status==200 else None
  c.execute('update species set state=?,photos=?,updated=? where id=?',('ready' if photo else 'needs_review',json.dumps([photo]) if photo else None,time.time(),row['id']))
  c.execute("update hosts set state='ready',challenges=0,retry_at=0 where host=?",(HOST,));c.commit();event(c,row['id'],'verified' if photo else 'unresolved_metadata',status)
 export(c,args.db.parent/'verified-photos.json');print(json.dumps(report(c,args.db.parent/'status.json')),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--host',choices=['ebird.org','search.macaulaylibrary.org'],default='ebird.org');p.add_argument('--db',type=pathlib.Path,default=DEFAULT);p.add_argument('--enqueue',action='append',default=[]);p.add_argument('--run',action='store_true');p.add_argument('--status',action='store_true');p.add_argument('--fresh-attempt',action='store_true',help='Requires owner authorization; clears a persistent host block.');p.add_argument('--record-challenge',help='Record a manual authorized probe without making another request.');p.add_argument('--interval',type=int,default=90);p.add_argument('--max-requests',type=int,default=100);p.add_argument('--hours',type=float,default=24);a=p.parse_args()
 if a.interval<60 or not 0<a.max_requests<=1000 or not 0<a.hours<=168:p.error('Use interval >=60 seconds, 1..1000 requests and 0<hours<=168')
 HOST=a.host
 c=connect(a.db)
 if a.fresh_attempt:c.execute("update hosts set state='ready',challenges=0,retry_at=0 where host=?",(HOST,));c.commit();event(c,None,'owner_authorized_fresh_attempt')
 enqueue(c,a.enqueue)
 if a.record_challenge:
  c.execute('update species set updated=0 where id=?',(a.record_challenge,))
  c.execute("update hosts set state='cooldown',challenges=1,retry_at=?,last_request=? where host=?",(time.time()+COOLDOWN,time.time(),HOST));c.commit();event(c,a.record_challenge,'manual_challenge_cooldown',200)
 if a.run:run(c,a)
 else:export(c,a.db.parent/'verified-photos.json');print(json.dumps(report(c,a.db.parent/'status.json')),flush=True)
