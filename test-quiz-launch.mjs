import assert from 'node:assert/strict';
import {parse} from 'parse5';
import application from './dist/server/index.js';
const all=n=>[n,...(n.childNodes||[]).flatMap(all)],attr=(n,k)=>n.attrs?.find(a=>a.name===k)?.value;
for(const language of ['en','es-CO'])for(const path of ['/play?geo=CO','/play/','/quiz?geo=US-NC-037']){
 const r=await application.fetch(new Request('https://quiz.test'+path,{headers:{cookie:'aviquiz-language='+language}}),{});assert.equal(r.status,200);
 const text=await r.text(),nodes=all(parse(text)),byId=id=>nodes.find(n=>attr(n,'id')===id),hidden=id=>byId(id).attrs.some(a=>a.name==='hidden');
 assert.equal(hidden('landing'),true,'no home page at first paint');assert.equal(hidden('setup'),true,'no legacy setup at first paint');assert.equal(hidden('session'),true);assert.equal(hidden('quiz-loading'),false);
 assert.equal(attr(byId('nav-explore'),'aria-current'),'page');assert.equal(attr(byId('nav-practice'),'aria-current'),undefined);
 assert.ok(text.includes(language==='en'?'Preparing your quiz':'Preparando su cuestionario'));
 assert.equal(attr(byId('quiz-launch-back'),'href'),'/explore');
 const head=await application.fetch(new Request('https://quiz.test'+path,{method:'HEAD',headers:{cookie:'aviquiz-language='+language}}),{});assert.equal(await head.text(),'');assert.equal(head.headers.get('content-language'),language);
}
const legacy=await(await application.fetch(new Request('https://quiz.test/quiz'),{})).text();assert.ok(legacy.includes('<section id="landing" aria-labelledby='));assert.ok(legacy.includes('<section id="quiz-loading" hidden'));
console.log('Passed dedicated geography launch HTML: no initial home/setup flash, translated loading and recovery controls, Take a quiz navigation, HEAD/locale parity and legacy deep-link compatibility.');
