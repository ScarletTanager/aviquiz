import assert from 'node:assert/strict';
import fs from 'node:fs';
import {recordingMatch,audioBirds,validateAudioCatalog,SITE_AUDIO_AREAS} from './dist/audio.mjs';
import {PROGRESS_KEY,AUDIO_PROGRESS_KEY,progressKey,emptyProgress,recordAttempt,recentMistakeIds,reviewBirds,withFreshPhotos} from './dist/progress.mjs';
import {accuracyStatistics,speciesAccuracy,sortAccuracy} from './dist/statistics.mjs';
import {eligibleBirds,questionPool,buildQuestions} from './dist/quiz.mjs';
const data=JSON.parse(fs.readFileSync('dist/data.json')),catalog=JSON.parse(fs.readFileSync('dist/audio.json'));
assert.ok(validateAudioCatalog(catalog,data.birds));
assert.ok(Object.keys(catalog.recordings).length>=150);
assert.notEqual(PROGRESS_KEY,AUDIO_PROGRESS_KEY);assert.equal(progressKey('photo'),PROGRESS_KEY);assert.equal(progressKey('audio'),AUDIO_PROGRESS_KEY);
const first=data.birds.find(b=>catalog.recordings[b.id]);
const visual=recordAttempt(emptyProgress(),first.id,true),audio=recordAttempt(emptyProgress(),first.id,false);
assert.deepEqual(recentMistakeIds(visual),[]);assert.deepEqual(recentMistakeIds(audio),[first.id]);
assert.equal(speciesAccuracy(data.birds,visual,'family',first.family).find(r=>r.id===first.id).rate,1);
assert.equal(speciesAccuracy(data.birds,audio,'family',first.family).find(r=>r.id===first.id).rate,0);
assert.equal(reviewBirds(data.birds,visual).length,0);assert.equal(reviewBirds(data.birds,audio).length,1);
const sameSite={location:'SFF Otún Quimbaya--Lodge, Risaralda, Colombia',department:'Risaralda',country:'Colombia'};
assert.equal(recordingMatch(sameSite,'OQ').rank,1);assert.equal(recordingMatch(sameSite,'Ma').rank,2);assert.equal(recordingMatch(sameSite,'Ch').rank,3);assert.equal(recordingMatch(sameSite,'all').rank,3);
assert.equal(recordingMatch({...sameSite,confirmedSiteCodes:['OQ']},'OQ').rank,0);
assert.equal(recordingMatch({country:'Ecuador'},'Ch').rank,4);assert.equal(recordingMatch({country:'United States'},'Ch').rank,5);
assert.equal(recordingMatch({...sameSite,country:'United States'},'OQ').rank,5);
assert.ok(recordingMatch(sameSite,'B').detail.includes('not yet resolved'));
assert.ok(recordingMatch(sameSite,'all').detail.includes('several regions'));
assert.ok(recordingMatch({...sameSite,location:'Camino Montezuma, Risaralda, Colombia'},'Ma').detail.includes('elevation'));
const fixture={version:1,recordings:{[first.id]:[
  {...sameSite,id:'1'}, {...sameSite,id:'2',location:'Elsewhere, Cundinamarca, Colombia',department:'Cundinamarca'},
  {...sameSite,id:'3',location:'Elsewhere, Risaralda, Colombia'}, {...sameSite,id:'4',location:'SFF Otún Quimbaya, Risaralda, Colombia'}
]}};
assert.deepEqual(new Set(audioBirds([first],fixture,'OQ')[0].photos.map(r=>r.id)),new Set(['1','4']));
assert.deepEqual(audioBirds([first],fixture,'Ch')[0].photos.map(r=>r.id),['2']);
for(const site of ['all',...data.sites.map(s=>s.code)])for(const family of ['all',...new Set(data.birds.map(b=>b.family))])for(const lifer of ['none','world','colombia']){
 const scoped=eligibleBirds(data.birds,site,lifer,family),prepared=audioBirds(scoped,catalog,site,()=>.5);
 assert.equal(prepared.length,scoped.length);
 for(const b of prepared){
  const candidates=catalog.recordings[b.id]||[];
  if(candidates.length){const best=Math.min(...candidates.map(r=>recordingMatch(r,site).rank));assert.ok(b.photos.length>0&&b.photos.every(r=>r.match.rank===best));}
 }
 const speciesQuestions=buildQuestions(prepared,20,false),recordingQuestions=buildQuestions(prepared,10000,true);
 assert.equal(new Set(speciesQuestions.map(b=>b.id)).size,speciesQuestions.length);
 assert.equal(new Set(recordingQuestions.map(b=>b.photos[0].id)).size,recordingQuestions.length);
 assert.equal(recordingQuestions.length,questionPool(prepared,true).length);
}
const ranked=audioBirds([first],fixture,'OQ');assert.equal(withFreshPhotos(ranked,['1'])[0].photos.length,1);
assert.deepEqual(Object.keys(SITE_AUDIO_AREAS).sort(),data.sites.map(s=>s.code).sort());
assert.throws(()=>validateAudioCatalog({version:1,recordings:{invalid:[]}},data.birds));
const invalid=structuredClone(catalog);Object.values(invalid.recordings)[0][0].url='https://other.example/audio.mp3';assert.throws(()=>validateAudioCatalog(invalid,data.birds));
const totals=accuracyStatistics(data.birds,data.sites,audio);assert.ok(sortAccuracy(totals.families,'rate','desc').some(r=>r.total===1&&r.correct===0));
console.log(`Passed: ${Object.keys(catalog.recordings).length} audio species, provenance, separate histories/review/statistics, every site/family/lifer scope, geographic ordering, no distant displacement, distinct-recording family questions, fresh recordings and empty pools.`);
