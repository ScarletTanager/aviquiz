// Independently compare the common quiz API with private daily SQL facts.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {seasonalApi,seasonalPackages} from '../worker/seasonal-api.mjs';
import {fileEbdBucket} from '../server/ebd-files.mjs';
const bucket=await fileEbdBucket(process.env.EBD_COMMON_OBJECTS_DIR||'../../outputs/ebd_common/objects');
const python=process.env.AVIQUIZ_PYTHON||'python3';
const source=String.raw`
import sqlite3,datetime,json,sys
db,place,start,end,first,last=sys.argv[1:];first,last=int(first),int(last)
start,end=datetime.date.fromisoformat(start),datetime.date.fromisoformat(end)
span=end.year-start.year;roles={};day=start
while day<=end:
 roles.setdefault(day.isoformat()[5:],set()).add(day.year-start.year);day+=datetime.timedelta(days=1)
def anchors(date,year):
 return {year-offset for offset in roles.get(date[5:],[]) if first<=year-offset<=last-span}
c=sqlite3.connect('file:'+db+'?mode=ro',uri=True);effort=set()
for day,year in c.execute('select observation_date,observation_year from ebd_effort_day where place_id=? and observation_year between ? and ?',(place,first,last)):effort.update(anchors(day,year))
birds={}
names=dict(c.execute('select taxon_key,scientific_name from ebd_taxon'))
for key,day,year in c.execute('select taxon_key,observation_date,observation_year from ebd_detection_day where place_id=? and observation_year between ? and ?',(place,first,last)):
 years=anchors(day,year)
 if years:birds.setdefault(names[key],set()).update(years)
print(json.dumps({'seasons':len(effort),'species':{('Nannus hiemalis' if name=='Troglodytes hiemalis' else name):len(years&effort) for name,years in birds.items() if years&effort}}))
`;
const base='../../outputs/ebd_aggregation/';
for(const [geography,folder,places] of [
 ['US-NC','nc-20261121-r2',['US-NC-037','L651593']],
 ['CO','co-20261122T070336',['CO','CO-MET']]
]){
 const pkg=seasonalPackages.find(p=>p.package.geography===geography);
 for(const place of places)for(const [from,to] of [['2026-09-20','2026-10-10'],['2026-12-20','2027-01-10'],['2028-02-29','2028-02-29']]){
  const query=new URLSearchParams({place,from,to,single:'true'}),response=await seasonalApi(new Request('https://test/api/geography/quiz?'+query),{EBD_BUCKET:bucket});assert.equal(response.status,200);const actual=await response.json();
  const check=spawnSync(python,['-c',source,base+folder+'/daily.sqlite',place,from,to,...pkg.index.years.map(String)],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000});assert.equal(check.status,0,check.stderr);
  const expected=JSON.parse(check.stdout);assert.equal(actual.sampledSeasons,expected.seasons);
  assert.deepEqual(Object.fromEntries(actual.species.map(b=>[b.scientificName,b.reportingSeasons])),expected.species);
  console.log('Daily database comparison passed:',place,from,to,actual.species.length,'species');
 }
}
