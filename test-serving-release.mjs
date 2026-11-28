import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {syntheticServing} from './scripts/serving-test-fixtures.mjs';
import {compileServingRelease,servingObjects} from './scripts/serving-release.mjs';
import {readMetadata,navigationRecord,speciesRecords,placePackage} from './worker/serving-reader.mjs';
import {seasonalApi} from './worker/seasonal-api.mjs';
import {geographyApi} from './worker/geography-api.mjs';
const fixture=await syntheticServing(),{registry,bucket,objects,originals}=fixture,env={EBD_BUCKET:bucket,SEASONAL_RELEASE:registry};
try{
 assert.equal(registry.schema,'aviquiz-serving-release-v1');assert.deepEqual(registry.coverage,{species:1,geographies:2,sites:2});
 assert.ok(!JSON.stringify(registry).includes('photographer'));assert.ok(!JSON.stringify(registry).includes('Colombia'));
 const birds=Object.values(registry.species);assert.equal(birds.length,1,'identical bird metadata shared across geographies');
 const again=await compileServingRelease([...originals].reverse(),{objects,navigation:(await import('./dist/geography-seed.json',{with:{type:'json'}})).default.nodes});assert.deepEqual(again,registry,'deterministic irrespective of input order');
 for(const place of ['CO','CO-CAL','L6248331','US-NC','US-NC-037','L651593']){
  const response=await seasonalApi(new Request('https://quiz.example/api/geography/quiz?'+new URLSearchParams({place,from:'2000-09-01',to:'2000-09-30'})),env);assert.equal(response.status,200);const result=await response.json();assert.equal(result.pool.length,1);assert.equal(result.pool[0].photos[0].credit,'Test photographer / Macaulay Library');assert.equal(result.sampledSeasons,2);
 }
 const nav=await (await geographyApi(new Request('https://quiz.example/api/geography?parent=CO'),env)).json();assert.equal(nav.children[0].id,'CO-CAL');assert.equal(nav.children[0].supported,true);assert.equal(nav.children[0].quizSupported,true);
 const south=await(await geographyApi(new Request('https://quiz.example/api/geography?parent=continent:South%20America'),env)).json();assert.equal(south.children.find(n=>n.id==='CO').supported,true);assert.equal(south.children.find(n=>n.id==='EC').supported,false);
 assert.equal((await seasonalApi(new Request('https://quiz.example/api/geography/quiz?place=XX&from=2000-09-01&to=2000-09-30'),env)).status,404);
 assert.equal((await seasonalApi(new Request('https://quiz.example/api/geography/quiz?place=CO&from=bad&to=2000-09-30'),env)).status,400);
 let calls=0;const counting={get(...a){calls++;return bucket.get(...a);}};
 await navigationRecord({...env,EBD_BUCKET:counting},'CO');const previous=calls;await navigationRecord({...env,EBD_BUCKET:counting},'CO');assert.equal(calls,previous,'verified cache reuse');
 let concurrent=0,peak=0,reads=0;
 const delayed={async get(...args){reads++;concurrent++;peak=Math.max(peak,concurrent);await new Promise(resolve=>setTimeout(resolve,2));try{return await bucket.get(...args);}finally{concurrent--;}}};
 await Promise.all(Array.from({length:20},()=>navigationRecord({...env,EBD_BUCKET:delayed},'CO')));assert.equal(reads,1,'concurrent identical loads coalesce');
 const fresh={...delayed};await Promise.all(Object.values(registry.navigation).map(ref=>readMetadata(fresh,ref,'aviquiz-navigation-shard-v1')));assert.ok(peak<=4,'global metadata concurrency bound');
 const bad={get:async()=>({arrayBuffer:async()=>new Uint8Array([1]).buffer})};await assert.rejects(()=>readMetadata(bad,registry.packages[0].birds,'aviquiz-bird-index-v1'),/Corrupt/);
 await assert.rejects(()=>readMetadata(bucket,{...registry.packages[0].birds,rawBytes:2**30},'aviquiz-bird-index-v1'));
 await assert.rejects(()=>readMetadata(bucket,registry.packages[0].birds,'unknown'),/schema/);
 const noPhotos={...env,EBD_BUCKET:{async get(key,options){return key===Object.values(registry.species)[0].sha256?null:bucket.get(key,options);}}};
 assert.equal((await seasonalApi(new Request('https://quiz.example/api/geography/quiz?place=CO&from=2000-09-01&to=2000-09-30'),noPhotos)).status,503);
 assert.equal((await seasonalApi(new Request('https://quiz.example/api/geography/catalog'),{})).status,200,'summary needs no object IO');
 const scoped=await placePackage(env,'CO');const species=await speciesRecords(env,scoped.pkg,[0]);assert.equal(species.size,1);
 const refs=servingObjects(registry);assert.equal(refs.length,new Set(refs.map(r=>r.sha256)).size);
 for(const ref of refs)assert.equal((await fs.stat(path.join(objects,ref.sha256))).size,ref.bytes);
 const invalid={...env,SEASONAL_RELEASE:{...registry,schema:'future-format'}};await assert.rejects(()=>navigationRecord(invalid,'CO'),/Unsupported/);
 console.log('Passed portable serving release: deterministic objects, cross-country metadata deduplication, country/subregion/hotspot quizzes, supported navigation, digest/schema/size checks, missing-object failure, metadata cache, object inventory, and summary without object IO.');
}finally{await fs.rm(objects,{recursive:true,force:true});}
