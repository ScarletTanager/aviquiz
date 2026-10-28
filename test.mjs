import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eligibleBirds,gradeAnswer,shuffle,familyName,questionPool,buildQuestions} from './dist/quiz.mjs';
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
