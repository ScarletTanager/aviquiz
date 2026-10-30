import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eligibleBirds,gradeAnswer,shuffle,familyName,questionPool,buildQuestions} from './dist/quiz.mjs';
import {emptyProgress,parseProgress,recordAttempt,mistakeRate,recentMistakeIds,sessionMistakeIds,reviewBirds,withFreshPhotos} from './dist/progress.mjs';
import {accuracyStatistics,sortAccuracy} from './dist/statistics.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./dist/data.json',import.meta.url)));
assert.equal(data.birds.length,849);
assert.equal(new Set(data.birds.map(b=>b.id)).size,849);
assert.equal(data.birds.filter(b=>b.worldLifer).length,283);
assert.equal(data.birds.filter(b=>b.colombiaLifer).length,519);
assert.ok(data.birds.every(b=>!b.worldLifer||b.colombiaLifer));
for(const site of data.sites){
  for(const filter of ['none','world','colombia']){
    const selected=eligibleBirds(data.birds,site.code,filter);
    assert.ok(selected.every(b=>b.sites.includes(site.code)));
    assert.ok(selected.every(b=>filter==='none'||(filter==='world'?b.worldLifer:b.colombiaLifer)));
    assert.ok(selected.length>0);
  }
}
const bird=data.birds.find(b=>b.name==='Tawny-breasted Tinamou');
for(const input of ['tawny breasted tinamou','TAWNYBREASTEDTINAMOU','Nothocercus julius','Tawny-breasted Tinmaou'])assert.ok(gradeAnswer(input,bird,data.birds).correct,input);
for(const input of ['Highland Tinamou','tinamou','','great tinamou'])assert.ok(!gradeAnswer(input,bird,data.birds).correct,input);
for(const b of data.birds){assert.ok(gradeAnswer(b.name,b,data.birds).correct);for(const p of b.photos){assert.ok(p.source.startsWith('https://macaulaylibrary.org/asset/'));assert.ok(p.url.startsWith('https://cdn.download.ams.birds.cornell.edu/'));assert.ok(p.photographer);}}
const shuffled=shuffle(data.birds);assert.equal(new Set(shuffled).size,849);assert.equal(shuffled.length,849);
const families=[...new Set(data.birds.map(b=>familyName(b.family)))];
assert.equal(familyName('Tyrannidae (99)'),'Tyrannidae');
for(const site of ['all',...data.sites.map(s=>s.code)]){
  for(const filter of ['none','world','colombia']){
    const base=eligibleBirds(data.birds,site,filter);
    const partitions=families.flatMap(family=>{
      const selected=eligibleBirds(data.birds,site,filter,family);
      assert.deepEqual(selected,base.filter(b=>familyName(b.family)===family));
      return selected;
    });
    assert.equal(partitions.length,base.length);
    assert.equal(new Set(partitions.map(b=>b.id)).size,base.length);
  }
}
const chicaque=eligibleBirds(data.birds,'Ch','none','Furnariidae');
assert.equal(chicaque.length,26);
const photos=buildQuestions(chicaque,200,true,()=>0.4);
assert.equal(photos.length,104);
assert.equal(new Set(photos.map(q=>q.photos[0].id)).size,104);
assert.equal(new Set(photos.map(q=>q.id)).size,26);
assert.ok(photos.every(q=>q.photos.length===1&&q.sites.includes('Ch')&&q.family==='Furnariidae'));
const selected=buildQuestions(chicaque,30,true,()=>0.4);
assert.equal(selected.length,30);assert.ok(new Set(selected.map(b=>b.id)).size<30);
const regular=buildQuestions(chicaque,100,false,()=>0.4);
assert.equal(regular.length,26);assert.equal(new Set(regular.map(b=>b.id)).size,26);
const single=buildQuestions([chicaque[0]],20,true);assert.equal(single.length,4);assert.equal(new Set(single.map(b=>b.photos[0].id)).size,4);
assert.deepEqual(buildQuestions([],20,true),[]);
assert.equal(questionPool([{...chicaque[0],photos:[]}],true).length,0);
const duplicate={...chicaque[0],photos:[chicaque[0].photos[0],chicaque[0].photos[0]]};assert.equal(questionPool([duplicate],true).length,1);
console.log('Passed: existing quiz checks; every family/site/lifer intersection; Chicaque Furnariidae (26 species, 104 unique photos); family species repeats, question caps, single-species and empty pools, duplicate photo IDs; default distinct-species behavior.');
let progress=emptyProgress();
const target=chicaque[0],other=data.birds.find(b=>!b.sites.includes('Ch'));
progress=recordAttempt(progress,target.id,false);
assert.deepEqual(recentMistakeIds(progress),[target.id]);
for(let n=0;n<3;n++)progress=recordAttempt(progress,target.id,true);
assert.equal(mistakeRate(progress.species[target.id]),0.25);
assert.deepEqual(recentMistakeIds(progress),[],'Exactly 25% must not qualify');
progress=recordAttempt(progress,target.id,false);
assert.equal(mistakeRate(progress.species[target.id]),0.4);
assert.deepEqual(recentMistakeIds(progress),[target.id]);
assert.deepEqual(parseProgress(JSON.stringify(progress)),progress,'History survives save/reload');
const serialized=JSON.stringify(progress);const advanced=recordAttempt(progress,target.id,true);assert.equal(JSON.stringify(progress),serialized,'Recording does not mutate prior history');
assert.equal(advanced.species[target.id].attempts.length,6);
for(let n=0;n<20;n++)progress=recordAttempt(progress,target.id,true);
assert.equal(progress.species[target.id].attempts.length,20);
assert.equal(mistakeRate(progress.species[target.id]),0);
assert.deepEqual(recentMistakeIds(progress),[],'Old misses leave the rolling window');
assert.deepEqual(parseProgress(null),emptyProgress());
assert.deepEqual(parseProgress('{"version":9,"species":{}}'),emptyProgress());
assert.throws(()=>parseProgress('corrupted history'));
assert.deepEqual(parseProgress('{"version":1,"species":{"abc":{"attempts":[false,"bad",true]}}}').species.abc.attempts,[false,true]);
progress=recordAttempt(progress,target.id,false);
progress=recordAttempt(progress,other.id,false);
assert.deepEqual(reviewBirds(data.birds,progress,'Ch','Furnariidae'),[],'Target below threshold must not be included');
const quizAnswers=[{bird:target,correct:false,photo:target.photos[0]},{bird:target,correct:true,photo:target.photos[1]},{bird:other,correct:false,unavailable:true,photo:other.photos[0]}];
assert.deepEqual(sessionMistakeIds(quizAnswers),[target.id],'One species entry; unavailable excluded; later correct answer does not erase a quiz miss');
assert.deepEqual(reviewBirds(data.birds,progress,'Ch','Furnariidae',sessionMistakeIds(quizAnswers)).map(b=>b.id),[target.id],'Immediate quiz review bypasses global rate threshold');
assert.deepEqual(reviewBirds(data.birds,progress,'all','all').map(b=>b.id),[other.id]);
assert.deepEqual(reviewBirds(data.birds,progress,'Ch','all',[]),[],'Explicit empty review must stay empty');
let allMissed=emptyProgress();for(const b of data.birds)allMissed=recordAttempt(allMissed,b.id,false);
for(const site of ['all',...data.sites.map(s=>s.code)])for(const family of ['all',...families]){
  assert.deepEqual(reviewBirds(data.birds,allMissed,site,family),eligibleBirds(data.birds,site,'none',family),'Review site and family intersection, without lifer filtering');
}
const refreshed=withFreshPhotos([target],[target.photos[0].id]);assert.equal(refreshed[0].photos.length,3);assert.ok(!refreshed[0].photos.some(p=>p.id===target.photos[0].id));
assert.equal(withFreshPhotos([target],target.photos.map(p=>p.id))[0].photos.length,4,'All used photos fall back to species photo pool');
assert.equal(target.photos.length,4,'Fresh photo selection preserves original photos');
console.log('Passed: persistent species history round-trip; strict >25% boundary; rolling 20 attempts; recovery through correct answers; all review site/family intersections; immediate quiz-only mistakes below threshold; deduplication; unavailable exclusion; fresh-photo selection.');
const statsBirds=[
  {id:'a',family:'Firstidae (2)',sites:['A','B','B']},
  {id:'b',family:'Firstidae (2)',sites:['A']},
  {id:'c',family:'Secondidae',sites:['B']},
  {id:'d',family:'Thirdidae',sites:[]}
];
const statsSites=[{code:'A',name:'Zulu'},{code:'B',name:'Alpha'},{code:'C',name:'No history'}];
const statsHistory={version:1,species:{a:{attempts:[true,false]},b:{attempts:[true]},d:{attempts:[false]}}};
const accuracy=accuracyStatistics(statsBirds,statsSites,statsHistory);
assert.deepEqual(accuracy.sites.map(r=>[r.correct,r.total,r.rate]),[[2,3,2/3],[1,2,0.5],[0,0,null]]);
assert.deepEqual(accuracy.families.map(r=>[r.name,r.correct,r.total,r.rate]),[['Firstidae',2,3,2/3],['Secondidae',0,0,null],['Thirdidae',0,1,0]]);
assert.equal(accuracy.sites[0].rate,2/3,'Weight answers rather than averaging species rates');
assert.equal(accuracy.sites[1].total,2,'An overlapping site receives history once, without duplicate site flags');
for(const rows of [accuracy.sites,accuracy.families]){
  const original=JSON.stringify(rows);
  assert.deepEqual(sortAccuracy(rows,'taxonomy','asc').map(r=>r.id),rows.map(r=>r.id));
  assert.deepEqual(sortAccuracy(rows,'taxonomy','desc').map(r=>r.id),rows.map(r=>r.id).reverse());
  assert.deepEqual(sortAccuracy(rows,'name','desc').map(r=>r.id),sortAccuracy(rows,'name','asc').map(r=>r.id).reverse());
  for(const direction of ['asc','desc'])assert.equal(sortAccuracy(rows,'rate',direction).at(-1).rate,null,'Missing history stays last for accuracy sorting');
  assert.equal(JSON.stringify(rows),original,'Sort does not mutate data or taxonomic order');
}
assert.deepEqual(sortAccuracy(accuracy.families,'rate','asc').map(r=>r.id),['Thirdidae','Firstidae','Secondidae']);
assert.deepEqual(sortAccuracy(accuracy.families,'rate','desc').map(r=>r.id),['Firstidae','Thirdidae','Secondidae']);
assert.deepEqual(sortAccuracy(accuracy.sites,'name','asc').map(r=>r.id),['B','C','A']);
assert.ok(accuracyStatistics(data.birds,data.sites,emptyProgress()).families.every(r=>r.rate===null));
const beforeStats=JSON.stringify(statsHistory);accuracyStatistics(statsBirds,statsSites,statsHistory);assert.equal(JSON.stringify(statsHistory),beforeStats);
console.log('Passed: weighted site/family accuracy; shared-site membership; no-history vs zero scores; species without site flags; taxonomy/alphabetic/rate sorts both ways; missing history placement; unchanged progress.');
