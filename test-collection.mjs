import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {packageCoverage} from './dist/coverage-core.mjs';
import {calendarWindow,calendarWindowLabel,seasonRange} from './dist/geography-core.mjs';
import {seasonalApi,seasonalPackages} from './worker/seasonal-api.mjs';
import {geographyApi} from './worker/geography-api.mjs';
const seed=JSON.parse(await fs.readFile('dist/geography-seed.json','utf8'));
const calendar=(a,b)=>{const range=calendarWindow(a,b);return seasonRange(range.start,range.end);};
assert.deepEqual(calendar('12-31','01-02'),['12-31','01-01','01-02']);
assert.equal(calendar('01-01','12-31').length,366);
assert.equal(calendar('03-01','02-29').length,366);
assert.equal(calendar('02-29','02-28').length,366);
assert.deepEqual(calendar('02-29','02-29'),['02-29']);
assert.ok(calendar('12-01','03-01').includes('02-29'));
assert.deepEqual(calendarWindow('2027-12-31','2027-01-02'),calendarWindow('12-31','01-02'));
for(const bad of ['02-30','04-31','00-01','13-01','1-01','not-a-date'])assert.throws(()=>calendarWindow(bad,'01-01'));
assert.ok(!/1999|2000|2001/.test(calendarWindowLabel('12-31','01-02')));
const coverage=packageCoverage(seasonalPackages,seed.nodes);
const independentSpecies=new Set(seasonalPackages.flatMap(p=>p.catalog.birds.map(b=>b.id)));
assert.equal(coverage.stats.species,independentSpecies.size);
const geographyIds=new Set(),siteIds=new Set();
for(const p of seasonalPackages)for(const n of p.nodes)if(Object.hasOwn(p.index.places,n.id)){
 if(n.kind==='subnational1')geographyIds.add(n.id);
 if(n.kind==='hotspot'||n.kind==='site')siteIds.add(n.id);
}
assert.equal(coverage.stats.geographies,geographyIds.size);assert.equal(coverage.stats.sites,siteIds.size);
assert.ok(coverage.stats.species>2000);assert.ok(coverage.navigable.has('US'));assert.equal(coverage.places.has('US'),false);
assert.equal(coverage.navigable.has('EC'),false);
const catalog=await (await seasonalApi(new Request('https://quiz.example/api/geography/catalog'),{})).json();assert.deepEqual(catalog.coverage,coverage.stats);
const read=async(parent,extra={})=>(await geographyApi(new Request('https://quiz.example/api/geography?parent='+encodeURIComponent(parent)),extra)).json();
const world=await read('world');assert.deepEqual(world.children.filter(n=>n.supported).map(n=>n.id).sort(),['continent:North America','continent:South America']);
const south=await read('continent:South America');assert.equal(south.children.find(n=>n.id==='CO').supported,true);assert.equal(south.children.find(n=>n.id==='EC').supported,false);
const us=await read('US',{LOCATION_DIRECTORY:{async read(){return {rows:[{id:'US-VA',name:'Virginia',kind:'subnational1',parent:'US'}]};}}});
assert.equal(us.parent.supported,true);assert.equal(us.parent.quizSupported,false);assert.equal(us.children.find(n=>n.id==='US-NC').supported,true);assert.equal(us.children.find(n=>n.id==='US-VA').supported,false);
// A newly installed package enables ancestors automatically. Duplicate species,
// missing photos, counties, and metadata-only sites do not distort the counts.
const extra={catalog:{birds:[{id:seasonalPackages[0].catalog.birds[0].id,photos:[]},{id:'new-test-species',photos:[]}]},index:{places:{'ZA-TEST':{},'LTEST':{}}},nodes:[{id:'ZA-TEST',parent:'ZA',kind:'subnational1'},{id:'LTEST',parent:'ZA-TEST',kind:'hotspot'},{id:'UNPROCESSED',parent:'ZA-TEST',kind:'hotspot'}]};
const grown=packageCoverage([...seasonalPackages,extra],seed.nodes);
assert.equal(grown.stats.species,coverage.stats.species+1);assert.equal(grown.stats.geographies,coverage.stats.geographies+1);assert.equal(grown.stats.sites,coverage.stats.sites+1);
assert.ok(grown.navigable.has('ZA'));assert.ok(grown.navigable.has('continent:Africa'));assert.equal(grown.navigable.has('UNPROCESSED'),false);
const html=await fs.readFile('dist/index.html','utf8'),explore=await fs.readFile('dist/explore.html','utf8');
assert.ok(!html.includes('id="landing-practice"'));for(const name of ['landing-sight','landing-audio'])assert.match(html,new RegExp('id="'+name+'"[^>]*href="/explore"'));
assert.match(html,/id="nav-practice" href="\/quiz"/);assert.ok(!explore.includes('geo-year'));assert.ok(!explore.includes('type="date"'));
for(const kind of ['start','end'])for(const part of ['month','day'])assert.ok(explore.includes('id="geo-'+kind+'-'+part+'"'));
console.log('Passed year-free windows/New Year/leap day, independent collection totals, current coverage flags, automatic future package activation, and homepage/launcher links.');
console.log('Installed collection:',coverage.stats);

const countyOnly=packageCoverage([{catalog:{birds:[]},index:{places:{'US-VA-001':{}}},nodes:[{id:'US-VA',kind:'subnational1',parent:'US'},{id:'US-VA-001',kind:'subnational2',parent:'US-VA'}]}],seed.nodes);
assert.equal(countyOnly.stats.geographies,1);assert.equal(countyOnly.stats.sites,0);assert.ok(countyOnly.navigable.has('US-VA'));assert.equal(countyOnly.places.has('US-VA'),false);
