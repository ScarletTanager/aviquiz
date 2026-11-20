import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createEbirdLocations} from './server/ebird-locations.mjs';
import {locationCache} from './server/location-cache.mjs';
import {createSqliteDatabase} from './server/database/sqlite.mjs';
import {migrateDatabase} from './server/database/migrate.mjs';
import {geographyApi} from './worker/geography-api.mjs';
import {seasonRange,monthRange,geographyPool,geographySelection} from './dist/geography-core.mjs';
const seed=JSON.parse(await fs.readFile('dist/geography-seed.json')),catalog=JSON.parse(await fs.readFile('dist/route-pilot.json')),data=JSON.parse(await fs.readFile('dist/data.json'));
assert.equal(monthRange(2028,2).end,'2028-02-29');assert.equal(monthRange(2027,2).end,'2027-02-28');
assert.deepEqual(seasonRange('2026-12-31','2027-01-02'),['12-31','01-01','01-02']);
assert.throws(()=>seasonRange('2027-02-29','2027-03-01'));assert.throws(()=>seasonRange('2027-03-01','2027-02-01'));assert.throws(()=>seasonRange('2026-01-01','2027-03-01'));
const scope=seed.nodes.find(n=>n.id==='CO-CAL');
const feb=geographyPool({scope,nodes:seed.nodes,catalog,birds:data.birds,start:'2027-02-01',end:'2027-02-28',single:true});assert.equal(feb.places.length,3);assert.ok(feb.pool.length>0);
const march=geographyPool({scope,nodes:seed.nodes,catalog,birds:data.birds,start:'2027-03-01',end:'2027-03-31',single:true});assert.equal(march.pool.length,0);
assert.equal(geographyPool({scope,nodes:seed.nodes,catalog,birds:data.birds,start:'2027-02-28',end:'2027-03-01',single:true}).pool.length,0);
assert.throws(()=>geographySelection(new URLSearchParams('geo=CO&from=2027-02-01&to=2027-02-28&questions=-1')));
export async function runLocationCacheTests(db){
 let calls=0,clock=Date.now(),fail=false,release=null,pause=false;
 const fetcher=async(url,options)=>{calls++;if(pause)await new Promise(resolve=>{release=resolve;});assert.equal(new URL(url).host,'api.ebird.org');assert.equal(options.headers['x-ebirdapitoken'],'test-key');assert.equal(options.redirect,'manual');if(fail)return new Response('',{status:429,headers:{'retry-after':'120'}});return Response.json([{code:'CO-CAL',name:'Caldas'}]);};
 const store=locationCache(db),parent={id:'CO',kind:'country'};
 let provider=createEbirdLocations({apiKey:'test-key',fetcher,store,now:()=>clock});
 const first=await provider.read('regions',parent);assert.equal(first.rows[0].id,'CO-CAL');assert.equal(calls,1);
 clock+=365*86400000;provider=createEbirdLocations({apiKey:'test-key',fetcher,store,now:()=>clock});
 assert.equal((await provider.read('regions',parent)).fromCache,true);assert.equal(calls,1); // restart and one year do not expire metadata.
 pause=true;const refreshing=provider.read('regions',parent,{refresh:true});while(!release)await new Promise(r=>setImmediate(r));
 const during=await provider.read('regions',parent);assert.equal(during.rows[0].name,'Caldas');assert.equal(calls,2);release();pause=false;await refreshing;
 fail=true;await assert.rejects(()=>provider.read('regions',parent,{refresh:true}));assert.equal(calls,3);
 assert.equal((await provider.read('regions',parent)).rows[0].name,'Caldas');assert.equal(calls,3);
 await assert.rejects(()=>provider.read('regions',parent,{refresh:true}));assert.equal(calls,3); // respect rate-limit backoff
 await assert.rejects(()=>provider.read('regions',{id:'https://evil.test',kind:'country'}));
 const serialized=(await db.prepare("SELECT body_json FROM location_metadata_cache WHERE cache_key='regions:CO'").first()).body_json;assert.ok(!serialized.includes('test-key'));
 // A redirect must neither be followed nor replace last-good metadata. This
 // mode is supported by Workers, which rejects redirect:'error' before I/O.
 let redirects=0;
 const redirectProvider=createEbirdLocations({apiKey:'test-key',store,fetcher:async(url,options)=>{redirects++;assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://untrusted.example'}});}});
 await assert.rejects(()=>redirectProvider.read('regions',parent,{refresh:true}));assert.equal(redirects,1);
 assert.equal((await redirectProvider.read('regions',parent)).rows[0].name,'Caldas');
 console.log(`Passed ${db.dialect}: persistent metadata cache across restart/age, explicit refresh, retained last-good data, 429 backoff, fixed endpoint validation and no cached key.`);
}
if(import.meta.main){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'aviquiz-geo-'));const config={DB_DRIVER:'sqlite',SQLITE_PATH:path.join(folder,'test.sqlite')};let db;
 try{
  await migrateDatabase(config);db=createSqliteDatabase(config.SQLITE_PATH);await runLocationCacheTests(db);
  const actor=crypto.randomUUID();await db.prepare('INSERT INTO app_users (id,email,created_at) VALUES (?,?,?)').bind(actor,'geo-admin@example.org',new Date().toISOString()).run();
  await db.prepare('INSERT INTO app_identities VALUES (?,?,?)').bind('https://identity.example','geo-admin',actor).run();await db.prepare("INSERT INTO app_grants VALUES (?,'system.admin')").bind(actor).run();
  let upstream=0;const env={DB:db,DB_DRIVER:'sqlite',LOCATION_DIRECTORY:{async read(kind,parent){upstream++;return {rows:kind==='countries'?[{id:'CO',name:'Colombia',kind:'country'}]:[{id:'CO-ANT',name:'Antioquia',parent:'CO',kind:'subnational1'}],fetchedAt:'2026-11-20T00:00:00Z'};}}};
  const request=(parent='CO',refresh=false,origin='https://quiz.example')=>new Request('https://quiz.example/api/geography'+(refresh?'/refresh':'')+'?'+new URLSearchParams({parent}),{method:refresh?'POST':'GET',headers:refresh?{origin,'content-type':'application/json'}:{},...(refresh?{body:'{}'}:{})});
  assert.equal((await geographyApi(request('https://evil.test'),env)).status,400);assert.equal(upstream,0);
  assert.equal((await geographyApi(request('CO',true),env,{verifyIdentity:async()=>null})).status,403);assert.equal(upstream,0);
  const verifyIdentity=async()=>({issuer:'https://identity.example',subject:'geo-admin'});
  assert.equal((await geographyApi(request('CO',true,'https://evil.test'),env,{verifyIdentity})).status,403);
  const refreshed=await geographyApi(request('CO',true),env,{verifyIdentity});assert.equal(refreshed.status,200);assert.equal(upstream,1);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='geography.refresh'").first()).n,1);
  assert.equal((await geographyApi(request('CO-ANT'),env)).status,200);
  // Cloudflare/D1 startup has no Node-injected provider. It must use the same
  // persistent cache without fetching or exposing its runtime key.
  const d1={...db,dialect:undefined};const d1Env={DB:d1,EBIRD_API_KEY:'private-test-key'};
  const d1Response=await geographyApi(request('CO'),d1Env);assert.equal(d1Response.status,200);const cachedBody=await d1Response.json();assert.equal(cachedBody.source,'ebird-cache');assert.ok(!JSON.stringify(cachedBody).includes('private-test-key'));
 }finally{await db?.close();await fs.rm(folder,{recursive:true,force:true});}
 console.log('Passed geography seasons/leap years/range coverage, media pool, bounded inputs, public browsing, admin-only refresh and audit. No live eBird or AWS calls.');
}

// Exercise the actual launcher module with a minimal DOM and local metadata.
if(import.meta.main){
 const {default:vm}=await import('node:vm');
 class Element{
  constructor(){this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.children=[];this.listeners={};this.attributes={};this.textContent='';}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
  addEventListener(name,fn){this.listeners[name]=fn;}setAttribute(k,v){this.attributes[k]=v;}
 }
 const ids=[...((await fs.readFile('dist/explore.html','utf8')).matchAll(/id="([^"]+)"/g))].map(m=>m[1]),elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
 elements['geo-family'].value='all';elements['geo-count'].value='20';
 let assigned='';const location={search:'?from=2027-02-01&to=2027-02-28',assign(url){assigned=url;}};
 const browserNodes=[...seed.nodes,{id:'EC-P',name:'Pichincha',kind:'subnational1',parent:'EC'},{id:'L9999999999',name:'Ecuador test hotspot',kind:'hotspot',parent:'EC-P'}];
 const apiRequest=[];let holdParent=null;const releaseHeld=[];
 const fetcher=async url=>{
  if(url==='/geography-seed.json')return {ok:true,json:async()=>seed};if(url==='/route-pilot.json')return {ok:true,json:async()=>catalog};if(url==='/data.json')return {ok:true,json:async()=>data};
  if(url==='/api/account')return {ok:true,json:async()=>({kind:'guest'})};
  const u=new URL(url,'https://quiz.example'),id=u.searchParams.get('parent'),type=u.searchParams.get('type'),parent=browserNodes.find(n=>n.id===id);apiRequest.push(id+':'+type);
  if(id===holdParent)await new Promise(resolve=>releaseHeld.push(resolve));
  const ancestors=[];let n=parent;while(n){ancestors.unshift(n);n=browserNodes.find(x=>x.id===n.parent);}
  return {ok:true,json:async()=>({parent,ancestors,children:browserNodes.filter(n=>n.parent===id&&(type==='hotspots'?['hotspot','site'].includes(n.kind):!['hotspot','site'].includes(n.kind))),notice:'Pilot directory',fetchedAt:null})};
 };
 const document={getElementById:id=>elements[id],createElement:()=>new Element(),createDocumentFragment:()=>new Element(),createTextNode:text=>({textContent:text})};
 const history={pushState(a,b,url){location.search=new URL(url,'https://quiz.example').search;}};
 const windowEvents={};
 const context=vm.createContext({document,location,history,fetch:fetcher,accountFetch:fetcher,URLSearchParams,Intl,Date,console,window:{addEventListener(name,fn){windowEvents[name]=fn;}},familyName:(await import('./dist/quiz.mjs')).familyName,geographyPool,monthRange,seasonRange});
 const source=(await fs.readFile('dist/geography-ui.mjs','utf8')).replace(/^import .*;\n/gm,'');
 await vm.runInContext('(async()=>{'+source+'})()',context);
 const leaves=e=>e.children.flatMap(n=>n instanceof Element?[n,...leaves(n)]:[]);
 const lists=()=>leaves(elements['geo-children']).filter(e=>e.listeners.change);
 async function choose(name){const select=lists().find(e=>leaves(e).some(o=>o.textContent===name));assert.ok(select,name);select.value=leaves(select).find(o=>o.textContent===name).value;await select.listeners.change();}
 assert.equal(lists().length,1);assert.equal(lists()[0].size,seed.nodes.filter(n=>n.parent==='world').length);
 await choose('South America');assert.equal(lists().length,2);assert.equal(lists()[1].size,20);
 await choose('Colombia');assert.equal(lists().length,3);assert.ok(!apiRequest.includes('CO:hotspots'));await choose('Caldas');assert.ok(apiRequest.includes('CO-CAL:hotspots'));assert.equal(lists().length,4);
 assert.equal(lists()[0].value,'continent:South America');assert.equal(lists()[1].value,'CO');assert.equal(lists()[2].value,'CO-CAL');
 assert.ok(lists().slice(1).every(e=>e.size===20));
 // Caldas has no further administrative level, but still reveals its sites.
 assert.ok(leaves(lists()[3]).some(e=>e.label==='Hotspots / pilot sites'));
 const firstSite=seed.nodes.find(n=>n.parent==='CO-CAL'&&['hotspot','site'].includes(n.kind));
 await choose(firstSite.name);assert.equal(lists().length,4); // no empty leaf column
 await choose('Caldas');
 assert.equal(elements['geo-start-quiz'].disabled,true);
 elements['geo-sample'].checked=true;elements['geo-sample'].listeners.change();assert.equal(elements['geo-start-quiz'].disabled,false);
 elements['geo-start-quiz'].listeners.click();assert.match(assigned,/geo=CO-CAL/);assert.match(assigned,/from=2027-02-01/);
 elements['geo-start'].value='2027-06-01';elements['geo-end'].value='2027-06-30';elements['geo-end'].listeners.change();assert.equal(elements['geo-start-quiz'].disabled,true);
 elements['geo-year'].value='2028';elements['geo-month'].value='2';elements['geo-apply-month'].listeners.click();assert.equal(elements['geo-end'].value,'2028-02-29');
 await choose('North America');assert.equal(lists().length,2);assert.equal(lists()[1].value,'');assert.equal(elements['geo-configuration'].hidden,true);
 assert.ok(leaves(lists()[0]).some(e=>e.textContent==='South America')); // continents always available
 const search=leaves(elements['geo-children']).find(e=>e.type==='search');search.value='united';search.listeners.input();assert.ok(leaves(lists()[1]).some(e=>e.value==='US'));
 // Countries with provinces reveal only provinces, with no country-wide
 // hotspot request; the lowest region then reveals its hotspots.
 await choose('South America');await choose('Ecuador');
 assert.equal(lists().length,3);assert.ok(leaves(lists()[2]).some(e=>e.value==='EC-P'));
 assert.ok(!apiRequest.includes('EC:hotspots'));
 assert.ok(!leaves(lists()[2]).some(e=>e.label==='Hotspots / pilot sites'));
 await choose('Pichincha');assert.equal(lists().length,4);assert.ok(apiRequest.includes('EC-P:hotspots'));
 assert.ok(leaves(lists()[3]).some(e=>e.value==='L9999999999'));
 // Restore a deep linked leaf, rebuilding all its ancestor lists.
 location.search='?geo='+firstSite.id+'&from=2027-02-01&to=2027-02-28&trail='+encodeURIComponent('world,continent:South America,CO,CO-CAL,'+firstSite.id);
 await windowEvents.popstate();assert.equal(lists().length,4);assert.equal(lists()[3].value,firstSite.id);assert.equal(lists()[0].value,'continent:South America');
 // A slow response from the previous branch cannot append a stale column.
 holdParent='CO';const oldSelection=choose('Colombia');await new Promise(resolve=>setImmediate(resolve));
 await choose('North America');holdParent=null;releaseHeld.forEach(resolve=>resolve());await oldSelection;
 assert.equal(lists().length,2);assert.equal(lists()[0].value,'continent:North America');assert.equal(elements['geo-configuration'].hidden,true);
 assert.equal(elements['geo-refresh'].hidden,true);assert.equal(elements['account-trip-options'].hidden,true);
 console.log('Passed actual launcher UI: World/continent/country/department drilldown, sample consent, date handoff, unsupported-season disable, leap-month shortcut, and guest/admin control visibility.');
}
