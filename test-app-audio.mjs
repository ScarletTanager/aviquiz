// DOM/media-event integration harness, without a browser or screen capture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {PROGRESS_KEY,AUDIO_PROGRESS_KEY,emptyProgress,recordAttempt} from './dist/progress.mjs';
const data=JSON.parse(fs.readFileSync('dist/data.json')),audio=JSON.parse(fs.readFileSync('dist/audio.json'));
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
  append(option){this.options.push(option);}
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
for(const id of ['count','species-count'])$(id).value='20';
$('settings').reset=()=>{$('medium').value='photo';$('site').value='all';$('family').value='all';$('count').value='20';$('experimental-tips').checked=false;radio('mode','regular').checked=true;radio('filter','none').checked=true;};
const radio=(name,value)=>radios.find(r=>r.name===name&&r.value===value);
const documentEvents={},windowEvents={};
globalThis.document={getElementById:id=>{assert.ok(elements.has(id),'Missing DOM ID '+id);return elements.get(id);},createElement:tag=>new Element('',tag.toUpperCase()),
 querySelector:q=>{const name=q.match(/name="([^"]+)"/)?.[1],value=q.match(/value="([^"]+)"/)?.[1];return radios.find(r=>r.name===name&&(value?r.value===value:r.checked));},
 querySelectorAll:q=>q.includes('input[name="filter"]')?radios.filter(r=>r.name==='filter'):q==='#review audio'?[]:q==='audio'?[$('question-audio')]:[],
 addEventListener:(name,fn)=>(documentEvents[name]??=[]).push(fn)};
globalThis.window={scrollTo(){},addEventListener:(name,fn)=>(windowEvents[name]??=[]).push(fn)};
globalThis.location={hash:'',pathname:'/',search:''};globalThis.history={replaceState(){location.hash='';}};
const existing=recordAttempt(emptyProgress(),data.birds[0].id,true),visualInitial=JSON.stringify(existing),store=new Map([[PROGRESS_KEY,visualInitial]]);
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
globalThis.fetch=async url=>({ok:!(process.env.AUDIO_CATALOG_FAIL==='1'&&url==='audio.json'),json:async()=>url==='data.json'?data:url==='audio.json'?audio:{annotations:[],coverage:{covered:23,approved:26}}});
async function settle(){await tick();await tick();}
assert.ok($('site').options[0],'Site option fixture');
await import('./dist/app.mjs');await settle();
if(process.env.AUDIO_CATALOG_FAIL==='1'){
 assert.equal($('medium').querySelector('option[value=audio]').disabled,true);
 assert.match($('audio-coverage').textContent,/could not load/);
 $('count').value='1';await $('settings').fire('submit');assert.equal($('photo-question').hidden,false);await $('exit').fire('click');
 assert.equal(store.get(PROGRESS_KEY),visualInitial);
 console.log('Passed: failed audio catalog disables audio while visual quizzes and existing history remain usable.');process.exit(0);
}
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
location.hash=`#species/audio/family/${encodeURIComponent(first.family)}`;for(const fn of windowEvents.hashchange)fn();await settle();
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
const emptyFamily=[...new Set(data.birds.map(b=>b.family))].find(f=>!data.birds.some(b=>b.family===f&&audio.recordings[b.id]));
if(emptyFamily){$('medium').value='audio';await $('medium').fire('change');$('family').value=emptyFamily;await $('family').fire('change');assert.equal($('start').disabled,true);assert.match($('pool').textContent,/No verified recordings/);}
console.log('Passed app integration: legacy visual history, audio playback gating, hidden answer metadata, miss/correct scoring, separate statistics, results, repeat, review, unscored failures, linked audio scopes, reset, visual regression and empty audio scopes. No browser/screen capture used.');
