import assert from 'node:assert/strict';
import {emptyProgress,parseProgress,recordAttempt,recordQuizResult,recentMistakeIds} from './dist/progress.mjs';
import {accuracyStatistics,speciesAccuracy,sortAccuracy} from './dist/statistics.mjs';
import {chooseSiteClue,offersSiteClue} from './dist/site-clue.mjs';

const sites=[{code:'Gu',name:'Guajira'},{code:'Ch',name:'Chicaque'}];
const birds=[{id:'shared',name:'Shared species',scientificName:'Species shared',family:'Family',sites:['Gu','Ch','Gu']},
 {id:'guonly',name:'Guajira only',scientificName:'Species guajira',family:'Family',sites:['Gu']},
 {id:'nosite',name:'No site',scientificName:'Species none',family:'Other',sites:[]}];
const legacy=recordAttempt(emptyProgress(),'shared',true);
assert.deepEqual(parseProgress(JSON.stringify(legacy)),legacy);
assert.deepEqual(accuracyStatistics(birds,sites,legacy,{siteOnly:true}).sites.map(s=>s.rate),[null,null]);
const snapshot=JSON.stringify(legacy);
const gu={mode:'regular',site:'Gu',family:'all'};
let history=recordAttempt(legacy,'shared',false,gu);
assert.equal(JSON.stringify(legacy),snapshot);
let all=accuracyStatistics(birds,sites,history),only=accuracyStatistics(birds,sites,history,{siteOnly:true});
assert.deepEqual(all.sites.map(s=>s.rate),[.5,.5]);
assert.deepEqual(only.sites.map(s=>s.rate),[0,null]);
assert.deepEqual(only.families,all.families);
assert.ok(recentMistakeIds(history).includes('shared'));
const scopedSnapshot=JSON.stringify(history.siteSpecies);
for(const context of [{...gu,family:'Family'},{...gu,site:'all'},{mode:'review',site:'all',family:'all'}])history=recordAttempt(history,'shared',true,context);
assert.equal(JSON.stringify(history.siteSpecies),scopedSnapshot);
history=recordAttempt(history,'shared',true,{mode:'review',site:'Ch',family:'all'});
history=recordAttempt(history,'guonly',true,gu);
only=accuracyStatistics(birds,sites,history,{siteOnly:true});
assert.equal(only.sites[0].rate,.5);assert.equal(only.sites[1].rate,1);
assert.equal(only.sites[0].total,2); // Duplicate X/site codes never double count.
for(const site of sites){
 const rows=speciesAccuracy(birds,history,'site',site.code,{siteOnly:true});
 assert.equal(rows.reduce((n,r)=>n+r.total,0),only.sites.find(s=>s.id===site.code).total);
 for(const direction of ['asc','desc'])for(const by of ['taxonomy','name','rate'])assert.equal(sortAccuracy(rows,by,direction).length,rows.length);
}
assert.deepEqual(speciesAccuracy(birds,history,'family','Family',{siteOnly:true}),speciesAccuracy(birds,history,'family','Family'));
assert.deepEqual(parseProgress(JSON.stringify(history)),history);
for(const context of [{...gu,experimentalTips:true},{...gu,mode:'annotations'}])assert.equal(recordAttempt(history,'shared',false,context),history);
const bucketBefore=JSON.stringify(history.siteSpecies.Gu);
for(let n=0;n<25;n++)history=recordAttempt(history,'shared',false,{site:'Ch',family:'Family',mode:'regular'});
assert.equal(JSON.stringify(history.siteSpecies.Gu),bucketBefore); // Global eviction cannot erase site-only attempts.
for(let n=0;n<25;n++)history=recordAttempt(history,'shared',true,{...gu,site:'Ch'});
assert.equal(history.siteSpecies.Ch.shared.attempts.length,20);
assert.equal(history.siteSpecies.Gu.shared.attempts.length,1);
const bad=parseProgress(JSON.stringify({version:1,species:{shared:{attempts:[true,'bad',false]}},siteSpecies:{all:{},Gu:{shared:{attempts:[true,1,false]}}}}));
assert.deepEqual(bad.species.shared.attempts,[true,false]);assert.deepEqual(bad.siteSpecies.Gu.shared.attempts,[true,false]);assert.equal(bad.siteSpecies.all,undefined);

const siteQuiz=recordQuizResult(history,gu,[{bird:birds[0],correct:true}],2);
const familyQuiz={...gu,family:'Family',filter:'world'};
const latest=recordQuizResult(siteQuiz,familyQuiz,[
  {bird:birds[0],correct:false},{bird:birds[0],correct:true},{bird:birds[1],unavailable:true}
],2);
const expected={site:'Gu',family:'Family',mode:'regular',filter:'world',questions:3,scored:2,correct:1,species:2,eligibleSpecies:2};
assert.deepEqual(latest.latestQuizzes.sites.Gu,expected);
assert.deepEqual(latest.latestQuizzes.families.Family,expected);
assert.deepEqual(latest.latestQuizzes.siteOnly,siteQuiz.latestQuizzes.siteOnly);
assert.equal(latest.latestQuizzes.sites.Ch,undefined);
assert.deepEqual(parseProgress(JSON.stringify(latest)),latest);
assert.deepEqual(latest.species,history.species);
for(const context of [{...familyQuiz,experimentalTips:true},{...familyQuiz,route:{}},{...familyQuiz,mode:'annotations'},{...gu,site:'all'}]){
  assert.equal(recordQuizResult(latest,context,[{bird:birds[0],correct:false}],1),latest);
}
const zeroScored=recordQuizResult(latest,{...gu,mode:'review'},[{bird:birds[1],unavailable:true}],1);
assert.deepEqual(zeroScored.latestQuizzes.sites.Gu,{...expected,family:'all',mode:'review',filter:'none',questions:1,scored:0,correct:0,species:1,eligibleSpecies:1});
assert.deepEqual(zeroScored.latestQuizzes.families,latest.latestQuizzes.families);

for(const medium of ['photo','audio']){
 assert.equal(offersSiteClue({medium,site:'all',family:'all',mode:'regular'}),true);
 assert.equal(offersSiteClue({medium,site:'all',family:'all',mode:'review'}),true);
 assert.equal(offersSiteClue({medium,site:'Gu',family:'Family',mode:'regular'}),true);
 assert.equal(offersSiteClue({medium,site:'Gu',family:'Family',mode:'review'}),true);
 assert.equal(offersSiteClue({medium,site:'Gu',family:'all',mode:'regular'}),false);
 assert.equal(offersSiteClue({medium,site:'all',family:'all',mode:'annotations'}),false);
}
assert.equal(chooseSiteClue(birds[0],sites,()=>0).code,'Gu');
assert.equal(chooseSiteClue(birds[0],sites,()=>.999).code,'Ch');
assert.equal(chooseSiteClue(birds[2],sites),null);
assert.equal(chooseSiteClue({sites:['unmapped']},sites),null);
const before=JSON.stringify(birds);chooseSiteClue(birds[0],sites);assert.equal(JSON.stringify(birds),before);
console.log('Passed context: legacy preservation; independent rolling site/species windows; Guajira/Chicaque isolation; family/all-sites exclusions; scoped reviews; linked totals/sorts; experimental exclusion; clue eligibility, random endpoints and unmapped sites.');
