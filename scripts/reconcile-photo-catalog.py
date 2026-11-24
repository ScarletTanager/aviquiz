#!/usr/bin/env python3
"""Attach verified reference-only metadata without rebuilding analytical facts."""
import argparse,datetime,hashlib,json,pathlib,re

def norm(value):return re.sub('[^a-z0-9]','',value.lower())
def reconcile(catalog,verified,merge=False):
 added=0;pending=[]
 for bird in catalog['birds']:
  was_empty=not bird['photos']
  if merge:
   refs={p['id']:p for p in bird['photos']}
   for photo in verified.get(bird['id'],[]):refs[photo['id']]={**refs.get(photo['id'],{}),**photo}
   bird['photos']=list(refs.values())
  elif was_empty and verified.get(bird['id']):bird['photos']=verified[bird['id']]
  if was_empty and bird['photos']:added+=1
  if not bird['photos']:pending.append(bird['id'])
  for photo in bird['photos']:
   if photo.get('observationDate'):
    date=datetime.date.fromisoformat(photo['observationDate'])
    if photo.get('quarter')!=(date.month-1)//3+1:raise ValueError('Invalid photo quarter for '+bird['id'])
   ident=str(photo.get('id',''));alt=photo.get('alt','');credit=photo.get('credit','')
   actual=alt.split(' - ',1)[0] if ' - ' in alt else credit.split('©')[0].strip()
   names={norm(bird[k]) for k in ('name','acceptedName') if bird.get(k)}
   if not ident.isdigit() or photo.get('source')!='https://macaulaylibrary.org/asset/'+ident:raise ValueError('Invalid source for '+bird['id'])
   if not re.fullmatch('https://cdn.download.ams.birds.cornell.edu/api/v2/asset/'+ident+r'/\d+',photo.get('url','')):raise ValueError('Invalid image URL for '+bird['id'])
   # Cornell may qualify a species with a parenthesized subspecies/form label.
   identity=re.sub(r' \([^()]+\)$','',actual)
   if not credit or norm(identity) not in names:raise ValueError('Invalid identity or credit for '+bird['id'])
 return dict(species=len(catalog['birds']),covered=sum(bool(b['photos']) for b in catalog['birds']),added=added,pending=pending,photos=sum(len(b['photos']) for b in catalog['birds']))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--catalog',type=pathlib.Path,required=True);p.add_argument('--verified',type=pathlib.Path,required=True);p.add_argument('--report',type=pathlib.Path,required=True);p.add_argument('--require-complete',action='store_true');p.add_argument('--merge',action='store_true',help='Merge verified dated metadata into existing photo references.');a=p.parse_args()
 catalog=json.loads(a.catalog.read_text());verified=json.loads(a.verified.read_text());report=reconcile(catalog,verified,a.merge)
 if a.require_complete and report['pending']:raise SystemExit('Photo coverage is incomplete; catalog was not written.')
 encoded=json.dumps(catalog,separators=(',',':'))+'\n';temp=a.catalog.with_suffix('.tmp');temp.write_text(encoded);temp.replace(a.catalog)
 report['catalogSha256']=hashlib.sha256(encoded.encode()).hexdigest();a.report.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
