import assert from 'node:assert/strict';
import {seasonalSpecies,seasonalPhotos} from './dist/seasonal-core.mjs';
import {seasonalApi,seasonalPackages} from './worker/seasonal-api.mjs';
import {fileEbdBucket} from './server/ebd-files.mjs';
import {geographyApi} from './worker/geography-api.mjs';
import {buildQuestionRounds,gradeAnswer} from './dist/quiz.mjs';
const high=(1n<<57n).toString(16);
assert.deepEqual(seasonalSpecies({e:[['09-01',high]],b:{0:[['09-01',high]]}},'2026-09-01','2026-09-01',false,[1969,2026]),{seasons:1,rows:[{bird:0,seasons:1}]});
const wrap={e:[['12-31','3'],['01-01','6']],b:{0:[['12-31','1'],['01-01','2']],1:[['12-31','2'],['01-01','4']]}};
assert.deepEqual(seasonalSpecies(wrap,'2026-12-31','2027-01-01',true,[2020,2022]),{seasons:2,rows:[{bird:0,seasons:1},{bird:1,seasons:1}]});
assert.equal(seasonalSpecies(wrap,'2026-12-31','2027-01-01',false,[2020,2022]).rows.length,0);
const leap={e:[['02-29','10']],b:{0:[['02-29','10']]}};
assert.equal(seasonalSpecies(leap,'2028-02-01','2028-02-29',true,[2020,2024]).seasons,1);
assert.equal(seasonalSpecies(leap,'2027-02-01','2027-02-28',true,[2020,2024]).seasons,0);
assert.throws(()=>seasonalSpecies({e:[['01-01',511]],b:{}},'2026-01-01','2026-01-01',true,[2017,2025]));
const photos=[{id:'1',observationDate:'2020-02-01',credit:'Credit'},{id:'2',observationDate:'2020-08-01',credit:'Other'}];
assert.deepEqual(seasonalPhotos(photos,'2026-01-01','2026-01-31').photos,[photos[0]]);
assert.equal(seasonalPhotos(photos,'2026-04-01','2026-04-30').photoSeasonFallback,true);
const {testServingEnvironment}=await import('./scripts/serving-test-fixtures.mjs');
const fixture=await testServingEnvironment(),bucket=fixture.bucket;
const get=(place,extra='',env=fixture.env)=>seasonalApi(new Request('https://test/api/geography/quiz?place='+place+'&from=2026-09-01&to=2026-09-30'+extra),env);
for(const id of ['US-NC','CO']){
 const pkg=seasonalPackages.find(p=>p.package.geography===id);assert.ok(pkg);
 const response=await get(id);assert.equal(response.status,200);const result=await response.json();assert.ok(result.species.length>0);assert.ok(result.pool.length>0);assert.ok(result.pool.every(b=>b.photos.length&&b.photos.every(p=>p.credit&&p.photographer)));
 const questions=buildQuestionRounds(result.pool,20);assert.equal(questions.length,20);assert.ok(questions.every(b=>b.photos[0]?.url));assert.ok(gradeAnswer(questions[0].name,questions[0],result.pool).correct);
 const family=result.pool[0].family,filtered=await (await get(id,'&family='+encodeURIComponent(family))).json();assert.ok(filtered.pool.length);assert.ok(filtered.pool.every(b=>b.family===family));
 assert.equal((await get(id,'',{})).status,503);
 const corrupt={...bucket,async get(){return {arrayBuffer:async()=>new ArrayBuffer(1)};}};assert.equal((await get(id,'',{...fixture.env,EBD_BUCKET:corrupt})).status,503);
 const directory=await geographyApi(new Request('https://test/api/geography?parent='+id+'&type=regions'),fixture.env);assert.equal(directory.status,200);assert.ok((await directory.json()).children.length>0);
 console.log('Shared reader quiz',id,result.species.length,'species',result.pool.length,'photo eligible');
}
assert.equal((await get('unknown')).status,404);
assert.equal((await get('CO','&invalid=true')).status,400);
assert.equal((await seasonalApi(new Request('https://test/api/geography/import?sha=bad',{method:'POST',body:'x'}),{EBD_BUCKET:bucket})).status,400);
const {default:app}=await import('./dist/server/index.js');
for(const place of ['CO','US-NC']){
 const result=await app.fetch(new Request('https://test/api/geography/quiz?'+new URLSearchParams({place,from:'2026-09-01',to:'2026-09-30'})),fixture.env);assert.equal(result.status,200);assert.ok((await result.json()).pool.length>0);
}
const launch=await app.fetch(new Request('https://test/explore'),{});assert.equal(launch.status,200);
const code=await app.fetch(new Request('https://test/geography-ui.mjs'),{});assert.ok((await code.text()).includes('/api/geography/quiz?'));
console.log('Passed common package API, range digest, failure, family, photo dates, credits, navigation, historical masks, leap day, and New Year checks.');
