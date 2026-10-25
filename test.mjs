import assert from 'node:assert/strict';
import fs from 'node:fs';
import {eligibleBirds,gradeAnswer,shuffle} from './dist/quiz.mjs';
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
console.log('Passed: species reconciliation, all 39 site/filter combinations, lifer subset, names, punctuation, typos, rejection of other species, photo provenance, unique question selection.');
