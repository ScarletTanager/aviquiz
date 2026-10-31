"""Read public Cornell metadata; no audio is downloaded or bundled.

Usage: python3 scripts/prepare-audio-catalog.py /path/to/metadata-cache
The cache contains cornell-tracks.html, source-*.txt (accessible catalog search
results), and asset-<id>.html / headers-<id>.txt from public Macaulay pages.
Unknown identities, non-vocal tracks, and invalid MIME checks are excluded.
"""
import json,re,sys,html
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlparse,parse_qs
root=Path(__file__).resolve().parents[1]
cache=Path(sys.argv[1])
birds=json.loads((root/'dist/data.json').read_text())['birds']
by_sci={b['scientificName']:b for b in birds};by_id={b['id']:b for b in birds}
class Tables(HTMLParser):
 def __init__(self):super().__init__();self.rows=[];self.row=[];self.cell=None
 def handle_starttag(self,t,a):
  if t=='tr':self.row=[]
  if t in ('td','th'):self.cell=[]
 def handle_data(self,d):
  if self.cell is not None:self.cell.append(d)
 def handle_endtag(self,t):
  if t in ('td','th') and self.cell is not None:self.row.append(' '.join(''.join(self.cell).split()));self.cell=None
  if t=='tr' and self.row:self.rows.append(self.row)
class Meta(HTMLParser):
 def __init__(self):super().__init__();self.meta={}
 def handle_starttag(self,t,a):
  d=dict(a)
  if t=='meta':self.meta[d.get('property') or d.get('name')]=d.get('content','')
def norm(s):return re.sub('[^a-z0-9]','',s.lower())
def identity(title,bird):return any(norm(title).startswith(norm(n)) for n in [bird['name'],bird['acceptedName']])
candidates={}
def add(r):
 if r['speciesId'] not in by_id:return
 old=candidates.get(r['id'])
 if not old or (r.get('country')=='Colombia' and old.get('country')!='Colombia'):candidates[r['id']]=r
for filename in sorted(cache.glob('source-*.txt')):
 for section in filename.read_text().split('--------------------------------------------------------------------------------'):
  m=re.search(r'\((https://(?:search\.macaulaylibrary\.org|media\.ebird\.org)/[^)]+)\)',section)
  if not m:continue
  source=m[1];query=parse_qs(urlparse(source).query)
  if query.get('mediaType')!=['audio']:continue
  taxon=query.get('taxonCode',[None])[0]
  for block in re.split(r'\n\s*\d+\.\s+',section)[1:]:
   mark=re.search(r'ML(\d+)',block)
   if not mark:continue
   bird=by_id.get(taxon) if taxon else next((b for sci,b in by_sci.items() if sci in block),None)
   if not bird:continue
   if re.search(r'mechanical|m[eé]can|mec[aáâ]n|drumming|wing sound|bill rattle',block,re.I):continue
   locations=[l.strip() for l in block.splitlines() if re.search(r', (Colombia|Ecuador|Peru|Venezuela|Panama)\s*$',l.strip())]
   if not locations:continue
   location=locations[-1];parts=location.split(', ');country=parts[-1];department=parts[-2]
   tags=re.search(r'(?:Sounds|Sonidos|Sons)\s+([^\n]+)',block)
   sound=[]
   if tags:
    if re.search(r'call|llamado|vocaliza',tags[1],re.I):sound.append('Call')
    if re.search(r'song|canto|chant',tags[1],re.I):sound.append('Song')
   dates=re.findall(r'^\s*(\d{1,2}\s+[^\d\n]+\s+\d{4})\s*$',block,re.M)
   # Catalog snippets occasionally omit the species/credit block. Asset-page
   # metadata is required later to confirm both identity and contributor.
   add({'id':mark[1],'speciesId':bird['id'],'location':location,'department':department,'country':country,'recordist':'','date':dates[-1].strip() if dates else None,'soundType':'; '.join(sound) or None,'subspecies':None,'provenance':source})
tracks=cache/'cornell-tracks.html'
if tracks.exists():
 table=Tables();table.feed(tracks.read_text())
 for row in table.rows:
  if len(row)<7 or row[2] not in by_sci:continue
  _,title,sci,recordist,location,date,asset=row[:7]
  if not re.search(r'\b(Song|Calls?)\b',title,re.I) or re.search(r'wing|bill|drum',title,re.I):continue
  ident=re.search(r'ML(\d+)',asset)
  if not ident:continue
  parts=location.split(', ');country=parts[-1]
  if country not in ['Colombia','Ecuador','Peru','Venezuela','Panama','Costa Rica','Mexico','Belize','Guatemala','Honduras','Nicaragua','El Salvador','Brazil','Argentina','Chile','Bolivia','Uruguay','Paraguay','United States','Canada','Puerto Rico','Dominican Republic','Cuba','Jamaica']:continue
  add({'id':ident[1],'speciesId':by_sci[sci]['id'],'recordist':recordist,'location':location,'department':parts[-2] if len(parts)>1 else None,'country':country,'date':date,'soundType':'Song' if re.search('song',title,re.I) else 'Call','subspecies':None,'provenance':'https://www.macaulaylibrary.org/guide-to-bird-sounds/track-list/'})
# Prefer multiple Colombian localities over a deep pile of overseas examples.
priority={'Colombia':0,'Ecuador':1,'Peru':1,'Venezuela':1,'Panama':1,'Costa Rica':2,'Nicaragua':2,'Mexico':3,'Belize':3,'Guatemala':3,'Brazil':3,'United States':4,'Canada':4}
chosen=[]
for bird in birds:
 records=sorted((r for r in candidates.values() if r['speciesId']==bird['id']),key=lambda r:(priority.get(r['country'],5),r['id']))
 per_area={}
 for r in records:
  area=(r['country'],r['department']);per_area[area]=per_area.get(area,0)+1
  if per_area[area]>2:continue
  chosen.append(r)
  if sum(x['speciesId']==bird['id'] for x in chosen)>=8:break
(cache/'candidates.json').write_text(json.dumps(chosen,ensure_ascii=False,indent=2))
verified=[];issues=[]
for r in chosen:
 meta_file=cache/f"asset-{r['id']}.html";head_file=cache/f"headers-{r['id']}.txt"
 if not head_file.exists():continue
 headers=head_file.read_text()
 if not re.search(r'content-type:\s*audio/',headers,re.I):issues.append([r['id'],'No audio MIME type']);continue
 if meta_file.exists():
  parser=Meta();parser.feed(meta_file.read_text());title=parser.meta.get('og:title','');desc=parser.meta.get('og:description','')
  title=re.sub(r'^ML\d+ - ','',title).removesuffix(' - Macaulay Library')
  if not identity(title,by_id[r['speciesId']]):
   actual=next((b for b in birds if identity(title,b)),None)
   if not actual:issues.append([r['id'],'Species not on checklist: '+title]);continue
   r={**r,'speciesId':actual['id']}
  credit=re.search(r'©\s*(.+?);',desc)
  if credit:r['recordist']=credit[1].strip()
  region=desc.rsplit(';',1)[-1].strip()
  if region and not norm(r['location']).endswith(norm(region)):
   # Never carry a neighboring result's locality through an abbreviated snippet.
   r['location']=region;parts=region.split(', ');r['country']=parts[-1];r['department']=parts[-2] if len(parts)>1 else None
 if not r['recordist']:continue
 species=r['speciesId']
 r={k:v for k,v in r.items() if k!='speciesId'}|{'source':f"https://macaulaylibrary.org/asset/{r['id']}",'url':f"https://cdn.download.ams.birds.cornell.edu/api/v2/asset/{r['id']}/mp3",'verifiedAt':'2026-10-31'}
 verified.append((species,r))
result={'version':1,'updatedAt':'2026-10-31','recordings':{}}
for species,r in verified:result['recordings'].setdefault(species,[]).append(r)
(root/'dist/audio.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
(cache/'report.json').write_text(json.dumps({'candidates':len(chosen),'verified':len(verified),'species':len(result['recordings']),'issues':issues},indent=2))
print(json.dumps({'candidates':len(chosen),'candidateSpecies':len(set(r['speciesId'] for r in chosen)),'verified':len(verified),'species':len(result['recordings']),'issues':len(issues)}))
