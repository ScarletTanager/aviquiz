// DOM/media-event integration harness, without a browser or screen capture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {PROGRESS_KEY,AUDIO_PROGRESS_KEY,emptyProgress,recordAttempt} from './dist/progress.mjs';
import {ID_TIPS,SPECIES_TIPS} from './dist/id-tips.mjs';
import {ANNOTATION_REVIEW_KEY,parseReviewedPhotos,unreviewedPhotos} from './dist/annotation-review.mjs';
const sharedAnnotations=Object.entries(ID_TIPS).map(([photoId,doc])=>({...doc,photoId,tips:SPECIES_TIPS[doc.speciesId].tips}));
const data=JSON.parse(fs.readFileSync('dist/data.json')),audio=JSON.parse(fs.readFileSync('dist/audio.json'));
const routeCatalog=JSON.parse(fs.readFileSync('dist/route-pilot.json'));
const html=fs.readFileSync('dist/index.html','utf8');
const elements=new Map(),radios=[];
class Element{
  constructor(id='',tag='DIV'){this.id=id;this.tagName=tag;this.listeners={};this.options=[];this.value='';this.hidden=false;this.disabled=false;this.style={};this.attrs={};this._html='';this._text='';this._checked=false;this.paused=true;}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  async fire(name,event={}){for(const fn of this.listeners[name]||[])await fn({target:this,preventDefault(){},...event});await settle();}
  set checked(v){if(v&&this.name)radios.filter(r=>r!==this&&r.name===this.name).forEach(r=>r._checked=false);this._checked=v;}
  get checked(){return this._checked;}
  set innerHTML(v){this._html=v;this._text=v.replace(/<[^>]*>/g,'');}
  get innerHTML(){return this._html;}
  set textContent(v){this._text=String(v);this._html=String(v);}
  get textContent(){return this._text;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  removeAttribute(k){delete this.attrs[k];if(k==='src')this.src='';}
  append(...children){this.options.push(...children);}
  replaceChildren(...children){this.options=children;}
  get lastChild(){return this.options.at(-1);}
  select(){}
  focus(){} scrollIntoView(){} pause(){this.paused=true;} load(){}
  querySelector(q){const value=q.match(/value=['"]?([^'"\]]+)/)?.[1];return this.options.find(o=>o.value===value);}
}
for(const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
 const e=new Element(match[2],match[1].toUpperCase());e.hidden=/\bhidden\b/.test(match[0]);e.disabled=/\bdisabled\b/.test(match[0]);elements.set(e.id,e);
}
for(const match of html.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*>/g)){
 const e=new Element('','INPUT');e.name=match[1];e.value=match[0].match(/value="([^"]*)"/)?.[1]||'';radios.push(e);e.checked=/\bchecked\b/.test(match[0]);
}
for(const match of html.matchAll(/<select\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
 const e=elements.get(match[1]);for(const option of match[2].matchAll(/<option(?: value="([^"]*)")?[^>]*>([^<]*)<\/option>/g)){const o=new Element('','OPTION');o.value=option[1]??option[2];o.textContent=option[2];e.options.push(o);}e.value=e.options[0]?.value||'';
}
const $=id=>{assert.ok(elements.has(id),id);return elements.get(id);};
for(const id of ['count','species-count','route-questions'])$(id).value='20';
$('settings').reset=()=>{$('all-species').checked=false;$('medium').value='photo';$('site').value='all';$('family').value='all';$('count').value='20';$('experimental-tips').checked=false;radio('mode','regular').checked=true;radio('filter','none').checked=true;};
const radio=(name,value)=>radios.find(r=>r.name===name&&r.value===value);
const documentEvents={},windowEvents={};
globalThis.document={getElementById:id=>{assert.ok(elements.has(id),'Missing DOM ID '+id);return elements.get(id);},createElement:tag=>new Element('',tag.toUpperCase()),createDocumentFragment:()=>new Element('', 'FRAGMENT'),
 querySelector:q=>{const name=q.match(/name="([^"]+)"/)?.[1],value=q.match(/value="([^"]+)"/)?.[1];return radios.find(r=>r.name===name&&(value?r.value===value:r.checked));},
 querySelectorAll:q=>q.includes('input[name="filter"]')?radios.filter(r=>r.name==='filter'):q==='#review audio'?[]:q==='audio'?[$('question-audio')]:[],
 addEventListener:(name,fn)=>(documentEvents[name]??=[]).push(fn)};
globalThis.window={scrollTo(){},addEventListener:(name,fn)=>(windowEvents[name]??=[]).push(fn)};
globalThis.location={origin:'https://aviquiz.test',hash:'',pathname:'/',search:''};globalThis.history={pushState(_s,_t,url){const u=new URL(url,'https://aviquiz.test');Object.assign(location,{pathname:u.pathname,search:u.search,hash:u.hash});},replaceState(s,t,url){this.pushState(s,t,url);}};
const existing=recordAttempt(emptyProgress(),data.birds[0].id,true),visualInitial=JSON.stringify(existing),store=new Map([[PROGRESS_KEY,visualInitial]]);
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
globalThis.fetch=async url=>{url=url.replace(/^\//,'');return {ok:!(process.env.AUDIO_CATALOG_FAIL==='1'&&url==='audio.json'),json:async()=>url==='data.json'?data:url==='audio.json'?audio:url==='route-pilot.json'?routeCatalog:{annotations:sharedAnnotations,coverage:{covered:3,approved:6}}};};
async function settle(){await tick();await tick();}
assert.ok($('site').options[0],'Site option fixture');
await import('./dist/app.mjs');await settle();
assert.equal($('landing').hidden,false);assert.equal($('setup').hidden,true);assert.equal($('statistics').hidden,true);
assert.match(document.title,/AviQuiz/);
await $('nav-practice').fire('click');assert.equal(location.pathname,'/quiz');assert.equal($('setup').hidden,false);assert.equal($('statistics').hidden,true);
$('count').value='7';await $('nav-statistics').fire('click');assert.equal(location.pathname,'/statistics');assert.equal($('statistics').hidden,false);assert.equal($('setup').hidden,true);assert.equal($('nav-statistics').attrs['aria-current'],'page');
await $('nav-home').fire('click');assert.equal($('landing').hidden,false);assert.equal($('count').value,'7');assert.equal(store.get(PROGRESS_KEY),visualInitial);
for(const [pathname,view] of [['/quiz/','setup'],['/statistics/','statistics'],['/','landing']]){location.pathname=pathname;for(const fn of windowEvents.popstate)fn();assert.equal($(view).hidden,false);}
await $('landing-practice').fire('click');$('count').value='20';
if(process.env.AUDIO_CATALOG_FAIL==='1'){
 assert.equal($('medium').querySelector('option[value=audio]').disabled,true);
 assert.match($('audio-coverage').textContent,/could not load/);
 $('count').value='1';await $('settings').fire('submit');assert.equal($('photo-question').hidden,false);await $('exit').fire('click');
 assert.equal(store.get(PROGRESS_KEY),visualInitial);
 console.log('Passed: failed audio catalog disables audio while visual quizzes and existing history remain usable.');process.exit(0);
}
await $('landing-audio').fire('click');assert.equal(location.search,'?medium=audio');assert.equal($('medium').value,'audio');assert.equal($('setup').hidden,false);
await $('nav-home').fire('click');await $('landing-sight').fire('click');assert.equal(location.search,'?medium=photo');assert.equal($('medium').value,'photo');assert.equal($('setup').hidden,false);
await $('medium').fire('change');await $('nav-practice').fire('click');
const normalFetch=globalThis.fetch;let releaseTips;
globalThis.fetch=url=>url==='/api/annotations'?new Promise(resolve=>{releaseTips=()=>resolve({ok:true,json:async()=>({annotations:sharedAnnotations,coverage:{covered:3,approved:6}})});}):normalFetch(url);
await $('settings').fire('submit');assert.ok(releaseTips);await $('nav-home').fire('click');releaseTips();await settle();assert.equal($('landing').hidden,false);assert.equal($('session').hidden,true);globalThis.fetch=normalFetch;
await $('nav-practice').fire('click');
assert.equal($('settings-error').textContent,'');assert.match($('accuracy-title').textContent,/visual/);assert.equal(store.has(AUDIO_PROGRESS_KEY),false);
await $('medium').fire('change',{$unused:1,target:Object.assign($('medium'),{value:'audio'})});
assert.match($('accuracy-title').textContent,/audio/);assert.equal($('photo-tip-options').hidden,true);assert.match($('family-accuracy-list').innerHTML,/No answers yet/);
$('count').value='2';await $('settings').fire('submit');
assert.equal($('session').hidden,false);assert.equal($('audio-question').hidden,false);assert.equal($('photo-question').hidden,true);assert.match($('question-status').textContent,/VOCALIZATION/);
const lookup=()=>{const id=$('question-audio').src.match(/asset\/(\d+)/)[1];return data.birds.find(b=>audio.recordings[b.id]?.some(r=>r.id===id));};
const first=lookup();assert.ok(first);assert.equal($('check').disabled,true);assert.ok(!$('audio-credit').innerHTML.includes(first.name));
await $('reveal').fire('click');assert.equal(store.has(AUDIO_PROGRESS_KEY),false);
$('question-audio').oncanplay();assert.equal($('check').disabled,true);
$('question-audio').onplaying();assert.equal($('check').disabled,false);
await $('reveal').fire('click');
assert.deepEqual(JSON.parse(store.get(AUDIO_PROGRESS_KEY)).species[first.id].attempts,[false]);assert.equal(store.get(PROGRESS_KEY),visualInitial);
assert.ok($('audio-credit').innerHTML.includes('Macaulay Library'));assert.ok($('audio-credit').innerHTML.includes('Location:'));assert.equal($('show-id-features').hidden,true);
await $('next').fire('click');assert.equal($('question-audio').attrs['aria-label'],'Bird vocalization to identify');
const second=lookup();$('question-audio').onplaying();$('answer').value=second.name;await $('answer-form').fire('submit');await $('next').fire('click');
assert.equal($('results').hidden,false);assert.match($('result-summary').textContent,/audio practice · 50%/);assert.match($('review').innerHTML,/<audio controls/);assert.equal(store.get(PROGRESS_KEY),visualInitial);
const audioAfter=store.get(AUDIO_PROGRESS_KEY);await $('again').fire('click');assert.match($('session-label').textContent,/AUDIO/);await $('exit').fire('click');assert.equal($('question-audio').src,'');
radio('mode','review').checked=true;await $('settings').fire('change',{target:radio('mode','review')});$('count').value='20';await $('settings').fire('submit');assert.equal(lookup().id,first.id);
// All failed recordings can be continued without adding an audio miss.
for(let n=0;n<100&&$('audio-error').hidden;n++)$('question-audio').onerror();
assert.equal($('audio-error').hidden,false);
assert.equal($('unavailable').hidden,false);await $('unavailable').fire('click');assert.equal(store.get(AUDIO_PROGRESS_KEY),audioAfter);assert.match($('result-summary').textContent,/No questions could be scored/);
await $('new-quiz').fire('click');assert.equal($('medium').value,'photo');assert.equal(store.get(PROGRESS_KEY),visualInitial);
location.hash=`#species/audio/family/${encodeURIComponent(first.family.replace(/\s*\(\d+\)\s*$/,''))}`;for(const fn of windowEvents.hashchange)fn();await settle();
assert.equal($('species-page').hidden,false);assert.match($('species-subtitle').textContent,/audio statistics/);$('species-count').value='1';await $('species-quiz').fire('submit');assert.equal($('audio-question').hidden,false);await $('exit').fire('click');
// Visual practice still updates only the original key.
$('medium').value='photo';await $('medium').fire('change');radio('mode','regular').checked=true;$('site').value='all';$('family').value='all';$('count').value='1';await $('settings').fire('submit');
assert.equal($('photo-question').hidden,false);assert.equal($('audio-question').hidden,true);
const photoId=$('question-image').src.match(/asset\/(\d+)/)[1],photoBird=data.birds.find(b=>b.photos.some(p=>p.id===photoId));$('question-image').onload();$('answer').value=photoBird.name;await $('answer-form').fire('submit');await $('next').fire('click');
assert.match($('result-summary').textContent,/visual practice · 100%/);assert.equal(store.get(AUDIO_PROGRESS_KEY),audioAfter);assert.notEqual(store.get(PROGRESS_KEY),visualInitial);
await $('new-quiz').fire('click');
// Experimental photo sessions retain session feedback without changing either history.
const visualBeforeExperiment=store.get(PROGRESS_KEY);
const statsBeforeExperiment=$('family-accuracy-list').innerHTML;
$('experimental-tips').checked=true;$('count').value='3';await $('settings').fire('submit');
assert.match($('session-label').textContent,/history not recorded/);
for(let n=0;n<3;n++){
 const id=$('question-image').src.match(/asset\/(\d+)/)[1],bird=data.birds.find(b=>b.photos.some(p=>p.id===id));
 $('question-image').onload();
 if(n===2)await $('reveal').fire('click');
 else{$('answer').value=n===0?bird.name:'intentionally wrong';await $('answer-form').fire('submit');}
 assert.equal(store.get(PROGRESS_KEY),visualBeforeExperiment);
 assert.equal(store.get(AUDIO_PROGRESS_KEY),audioAfter);
 assert.equal($('family-accuracy-list').innerHTML,statsBeforeExperiment);
 await $('next').fire('click');
}
assert.match($('result-title').textContent,/1 \/ 3/);
assert.match($('result-summary').textContent,/not added to statistics/);
assert.equal($('review-quiz').disabled,false);
await $('again').fire('click');$('question-image').onload();await $('reveal').fire('click');
assert.equal(store.get(PROGRESS_KEY),visualBeforeExperiment);
await $('exit').fire('click');$('experimental-tips').checked=false;
// Personal annotation review is by photo, explicit, persistent and independent of scores.
assert.equal(parseReviewedPhotos('bad json').size,0);
assert.equal(parseReviewedPhotos('["123",null,"bad",123]').size,1);
assert.deepEqual(unreviewedPhotos([{photos:[{id:'1'},{id:'2'}]}],new Set(['1']))[0].photos,[{id:'2'}]);
$('count').value='2';radio('mode','annotations').checked=true;await $('settings').fire('change',{target:radio('mode','annotations')});
await $('settings').fire('submit');
const reviewedId=$('question-image').src.match(/asset\/(\d+)/)[1];$('question-image').onload();
assert.equal($('id-features').hidden,false);assert.equal($('mark-photo-reviewed').hidden,false);assert.equal($('answer-form').hidden,true);
await $('mark-photo-reviewed').fire('click');
assert.ok(parseReviewedPhotos(store.get(ANNOTATION_REVIEW_KEY)).has(reviewedId));
const skippedId=$('question-image').src.match(/asset\/(\d+)/)[1];$('question-image').onload();await $('next').fire('click');
assert.equal(parseReviewedPhotos(store.get(ANNOTATION_REVIEW_KEY)).has(skippedId),false);
assert.match($('result-title').textContent,/1 \/ 2 photos marked reviewed/);
assert.equal(store.get(PROGRESS_KEY),visualBeforeExperiment);assert.equal(store.get(AUDIO_PROGRESS_KEY),audioAfter);
$('count').value='20';await $('again').fire('click');
for(let n=0;n<2;n++){
 assert.notEqual($('question-image').src.match(/asset\/(\d+)/)[1],reviewedId);$('question-image').onload();await $('next').fire('click');
}
await $('exit').fire('click');await $('mark-original-reviewed').fire('click');
assert.equal(parseReviewedPhotos(store.get(ANNOTATION_REVIEW_KEY)).size,26);assert.equal($('start').disabled,true);
$('medium').value='audio';await $('medium').fire('change');assert.equal(radio('mode','annotations').disabled,true);assert.equal(radio('mode','regular').checked,true);
// Question site clues persist, do not reroll when toggled, and apply to both media.
$('medium').value='photo';await $('medium').fire('change');$('experimental-tips').checked=false;
const familyScope=data.birds.find(b=>b.sites.length&&b.photos.length).family.replace(/\s*\(\d+\)\s*$/,'');
$('site').value='all';$('family').value=familyScope;$('count').value='2';await $('settings').fire('submit');
assert.equal($('site-clue-control').hidden,false);assert.equal($('site-clue-toggle').checked,false);assert.equal($('site-clue').hidden,true);
$('site-clue-toggle').checked=true;await $('site-clue-toggle').fire('change');assert.equal($('site-clue').hidden,false);
const initialClue=$('site-clue').textContent;
$('site-clue-toggle').checked=false;await $('site-clue-toggle').fire('change');assert.equal($('site-clue').hidden,true);
$('site-clue-toggle').checked=true;await $('site-clue-toggle').fire('change');assert.equal($('site-clue').textContent,initialClue);
$('question-image').onload();await $('reveal').fire('click');await $('next').fire('click');assert.equal($('site-clue-toggle').checked,true);assert.equal($('site-clue').hidden,false);
await $('exit').fire('click');
// The display switch changes no history, preserves family summaries and linked scope.
$('medium').value='photo';await $('medium').fire('change');$('site').value=data.sites[0].code;$('family').value='all';$('count').value='1';await $('settings').fire('submit');
assert.equal($('site-clue-control').hidden,true);assert.equal($('site-clue').hidden,true);
$('question-image').onload();const scopedPhoto=$('question-image').src.match(/asset\/(\d+)/)[1],scopedBird=data.birds.find(b=>b.photos.some(p=>p.id===scopedPhoto));
await $('reveal').fire('click');await $('next').fire('click');await $('exit').fire('click');
const scopedHistory=store.get(PROGRESS_KEY),siteCode=data.sites[0].code;
assert.deepEqual(JSON.parse(scopedHistory).siteSpecies[siteCode][scopedBird.id].attempts,[false]);
const familySummary=$('family-accuracy-list').innerHTML;
$('site-only-stats').checked=true;await $('site-only-stats').fire('change');
assert.equal(store.get(PROGRESS_KEY),scopedHistory);assert.equal($('family-accuracy-list').innerHTML,familySummary);
assert.match($('site-accuracy-list').innerHTML,/\/site-only/);
location.hash=`#species/photo/site/${siteCode}/site-only`;for(const fn of windowEvents.hashchange)fn();await settle();
assert.equal($('species-page').hidden,false);assert.match($('species-subtitle').textContent,/Site-only quizzes/);assert.match($('species-explanation').textContent,/older history/);
await $('exit').fire('click');
// A family quiz at the same site changes general history, not the site-only bucket.
$('family').value=scopedBird.family.replace(/\s*\(\d+\)\s*$/,'');$('count').value='1';await $('settings').fire('submit');
assert.equal($('site-clue-control').hidden,false);assert.equal($('site-clue-toggle').checked,true);
$('question-image').onload();await $('reveal').fire('click');await $('next').fire('click');
assert.deepEqual(JSON.parse(store.get(PROGRESS_KEY)).siteSpecies,JSON.parse(scopedHistory).siteSpecies);
await $('exit').fire('click');
// Audio gets its own scoped history and retains the clue preference.
$('medium').value='audio';await $('medium').fire('change');$('site').value='all';$('family').value='all';$('count').value='1';await $('settings').fire('submit');
assert.equal($('site-clue-control').hidden,false);assert.equal($('site-clue-toggle').checked,true);assert.equal($('site-clue').hidden,false);
$('site-clue-toggle').checked=false;await $('site-clue-toggle').fire('change');await $('exit').fire('click');
$('site').value=data.sites.find(s=>data.birds.some(b=>b.sites.includes(s.code)&&audio.recordings[b.id]?.length)).code;
await $('settings').fire('submit');const scopedAudioBird=lookup();$('question-audio').onplaying();await $('reveal').fire('click');await $('next').fire('click');
assert.deepEqual(JSON.parse(store.get(AUDIO_PROGRESS_KEY)).siteSpecies[$('site').value][scopedAudioBird.id].attempts,[false]);
assert.deepEqual(JSON.parse(store.get(PROGRESS_KEY)).siteSpecies,JSON.parse(scopedHistory).siteSpecies);
await $('exit').fire('click');
const emptyFamily=[...new Set(data.birds.map(b=>b.family))].find(f=>!data.birds.some(b=>b.family===f&&audio.recordings[b.id]));
if(emptyFamily){$('medium').value='audio';await $('medium').fire('change');$('family').value=emptyFamily;await $('family').fire('change');assert.equal($('start').disabled,true);assert.match($('pool').textContent,/No verified recordings/);}
console.log('Passed app integration: legacy visual history, audio playback gating, hidden answer metadata, miss/correct scoring, separate statistics, results, repeat, review, unscored failures, linked audio scopes, reset, visual regression and empty audio scopes. No browser/screen capture used.');

// All-species counts track intersecting filters and suppress family repeats.
await $('new-quiz').fire('click');$('all-species').checked=true;await $('all-species').fire('change');
const scoped=()=>data.birds.filter(b=>($('site').value==='all'||b.sites.includes($('site').value))&&($('family').value==='all'||b.family.replace(/\s*\(\d+\)\s*$/,'').trim()===$('family').value)&&(radio('filter','world').checked?b.worldLifer:radio('filter','colombia').checked?b.colombiaLifer:true));
const guajira=data.sites.find(s=>s.name.includes('Guajira'));assert.ok(guajira);$('site').value=guajira.code;await $('site').fire('change');assert.equal(Number($('count').value),scoped().filter(b=>b.photos.length).length);assert.equal($('count').readOnly,true);
$('site').value='all';$('family').value='Furnariidae';await $('family').fire('change');
radio('filter','world').checked=true;await radio('filter','world').fire('change');assert.equal(Number($('count').value),scoped().filter(b=>b.photos.length).length);
radio('filter','none').checked=true;await radio('filter','none').fire('change');
const expected=scoped().filter(b=>b.photos.length),seen=new Set();$('experimental-tips').checked=true;await $('settings').fire('submit');
for(let i=0;i<expected.length;i++){
 const id=$('question-image').src.match(/asset\/(\d+)/)[1],bird=data.birds.find(b=>b.photos.some(p=>p.id===id));assert.ok(bird);assert.ok(!seen.has(bird.id));seen.add(bird.id);$('question-image').onload();await $('reveal').fire('click');await $('next').fire('click');
}
assert.equal($('results').hidden,false);assert.equal(seen.size,expected.length);
await $('exit').fire('click');$('medium').value='audio';await $('medium').fire('change');assert.equal(Number($('count').value),scoped().filter(b=>audio.recordings[b.id]?.length).length);
$('all-species').checked=false;await $('all-species').fire('change');assert.equal($('count').readOnly,false);$('count').value='3';await $('count').fire('input');assert.equal($('count').value,'3');
console.log('Passed all-species sizing: Guajira, family/lifer intersections, unique family session, audio coverage, custom count.');

// The route link opens a read-only itinerary; the copy can be edited and quizzed.
const {decodeRoute,nextVisitDate,routeCandidates}=await import('./dist/routes.mjs');
const progressBeforeRoute=store.get(PROGRESS_KEY),siteBeforeRoute=$('site').value,mediumBeforeRoute=$('medium').value;
await $('nav-routes').fire('click');
for(let i=0;i<10&&$('route-content').hidden;i++)await settle();
assert.equal($('routes').hidden,false);assert.equal($('route-content').hidden,false);
assert.match($('route-preview-status').textContent,/species.*Macaulay/);
await $('route-add-stop').fire('click');$('route-single').checked=true;await $('route-single').fire('change');
await $('route-share').fire('click');const routeLink=new URL($('route-link-value').value);
const sharedRoute=decodeRoute(routeLink.hash,routeCatalog);
assert.equal(sharedRoute.stops.length,2);assert.equal(sharedRoute.single,true);
assert.equal(sharedRoute.stops[1].date,'2027-09-28');
assert.equal(nextVisitDate('2027-12-31'),'2028-01-01');
assert.equal(nextVisitDate('2028-02-28'),'2028-02-29');
assert.ok(routeCandidates(sharedRoute,routeCatalog,data.birds).some(r=>r.bird?.id==='kirwar'));
assert.ok(!routeCandidates({...sharedRoute,single:false},routeCatalog,data.birds).some(r=>r.bird?.id==='kirwar'));
assert.throws(()=>decodeRoute('#route='+encodeURIComponent(JSON.stringify({...sharedRoute,extras:['unknown species']})),routeCatalog));
history.pushState(null,'',routeLink.href);for(const fn of windowEvents.popstate)fn();await settle();
assert.equal($('route-editor').hidden,true);assert.equal($('route-shared').hidden,false);
$('route-questions').value='1';await $('route-quiz-form').fire('submit');
assert.equal($('session').hidden,false);assert.match($('session-label').textContent,/Route prototype/);
$('question-image').onload();await $('reveal').fire('click');await $('next').fire('click');
assert.equal($('results').hidden,false);assert.equal(store.get(PROGRESS_KEY),progressBeforeRoute);
await $('new-quiz').fire('click');await settle();assert.equal(location.hash,routeLink.hash);
await $('route-copy-edit').fire('click');assert.equal(location.hash,'');assert.equal($('route-editor').hidden,false);
await $('nav-practice').fire('click');assert.equal($('site').value,siteBeforeRoute);assert.equal($('medium').value,mediumBeforeRoute);
console.log('Passed public route draft, link, quiz, copy, rarity toggle, and itinerary isolation.');
