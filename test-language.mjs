import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {parse} from 'parse5';
import application from './dist/server/index.js';
import {cookieLocale,normalizeLocale,requestLocale} from './dist/locale-preference.mjs';
import {t,locale,resourcesFor} from './dist/i18n.mjs';
import {localizedServerText,localizeApiResponse} from './worker/localized-response.mjs';
assert.equal(locale,'en');
assert.equal(cookieLocale(''),'en');assert.equal(cookieLocale('aviquiz-language=es-CO'),'es-CO');
assert.equal(cookieLocale('a=1; aviquiz-language=es-CO; b=2'),'es-CO');
for(const bad of ['es','fr','ES-CO','../es-CO','es-CO%0d%0a'])assert.equal(normalizeLocale(bad),'en');
assert.equal(requestLocale(new Request('https://quiz.example',{headers:{'accept-language':'es-CO'}})),'en');
const request=(path,language,options={})=>new Request('https://quiz.example'+path,{...options,headers:{...(language?{cookie:'aviquiz-language='+language}:{}),...options.headers}});
for(const path of ['/','/quiz','/trips','/statistics','/explore','/invite','/review','/releases','/auth/callback']){
 const [en,es]=await Promise.all([application.fetch(request(path),{}),application.fetch(request(path,'es-CO'),{})]);
 assert.equal(en.status,200);assert.equal(es.status,200);
 assert.equal(en.headers.get('content-language'),'en');assert.equal(es.headers.get('content-language'),'es-CO');assert.match(es.headers.get('vary'),/Cookie/);
 const english=await en.text(),spanish=await es.text();assert.match(english,/<html lang="en">/);assert.match(spanish,/<html lang="es-CO">/);
 assert.ok(spanish.includes('Idioma'));assert.ok(spanish.includes('Español (Colombia)'));
 assert.ok(spanish.includes('src="/language.mjs"'));assert.ok(!spanish.includes('<!--msg '));
 const ids=html=>{const result=[];function visit(n){for(const a of n.attrs||[])if(a.name==='id')result.push(a.value);for(const c of n.childNodes||[])visit(c);}visit(parse(html));return result;};
 assert.deepEqual(ids(spanish),ids(english),path+': translated page preserves all controls');
}
const [enError,esError]=await Promise.all([application.fetch(request('/api/account'),{}),application.fetch(request('/api/account','es-CO'),{})]);
assert.equal(enError.status,esError.status);assert.notEqual((await enError.json()).error,(await esError.json()).error);
for(const lang of ['en','es-CO']){
 const response=await application.fetch(request('/explore',lang,{method:'HEAD'}),{});assert.equal(await response.text(),'');assert.equal(response.headers.get('content-language'),lang);
}
// Only display fields are translated. IDs, source data, nested user content,
// status codes and headers survive the presentation adapter.
const source=resourcesFor('en')['worker-index'],key=Object.keys(source).find(k=>k.startsWith('breadth_first'));
const original=source[key].replace('{{v0}}','7'),translated=resourcesFor('es-CO')['worker-index'][key].replace('{{v0}}','7');
assert.equal(localizedServerText(original,'es-CO'),translated);
const response=await localizeApiResponse(new Response(JSON.stringify({error:original,requestId:'stable-id',document:{message:original},name:original}),{status:409,headers:{'content-type':'application/json','cache-control':'no-store'}}),'es-CO');
const data=await response.json();assert.equal(data.error,translated);assert.equal(data.document.message,original);assert.equal(data.name,original);assert.equal(data.requestId,'stable-id');assert.equal(response.status,409);assert.equal(response.headers.get('cache-control'),'no-store');
assert.equal(localizedServerText('Unrecognized provider diagnostic','es-CO'),'Unrecognized provider diagnostic');
assert.equal(localizedServerText('Unknown request sent to provider','es-CO'),'Unknown request sent to provider');
// Execute the actual selector module without screen capture or a live browser.
const selectorSource=(await fs.readFile('dist/language.mjs','utf8')).replace(/^import .*;\n/gm,'').replace('export function','function');
function selector({initial='en',edited=false,inQuiz=false,allow=true,protocol='https:'}={}){
 const handlers={},docHandlers={};let cookie='',reloads=0,prompts=0;
 const select={dataset:{},value:'',addEventListener(type,fn){handlers[type]=fn;}};
 const document={getElementById:id=>id==='interface-language'?select:id==='session'?{hidden:!inQuiz}:null,addEventListener(type,fn){docHandlers[type]=fn;},get cookie(){return cookie;},set cookie(value){cookie=value;}};
 const context=vm.createContext({document,location:{protocol,reload(){reloads++;}},window:{confirm(){prompts++;return allow;}},locale:initial,t,LANGUAGE_COOKIE:'aviquiz-language',normalizeLocale});
 vm.runInContext(selectorSource,context);
 if(edited)docHandlers.input({target:{}});
 return {select,change(value){select.value=value;handlers.change();return {cookie,reloads,prompts,value:select.value};}};
}
assert.equal(selector().select.value,'en');assert.equal(selector({initial:'es-CO'}).select.value,'es-CO');
let result=selector().change('es-CO');assert.equal(result.reloads,1);assert.equal(result.prompts,0);assert.match(result.cookie,/aviquiz-language=es-CO; Path=\/; Max-Age=31536000; SameSite=Lax; Secure/);
result=selector({edited:true,allow:false}).change('es-CO');assert.equal(result.reloads,0);assert.equal(result.cookie,'');assert.equal(result.value,'en');
assert.equal(selector({inQuiz:true,allow:false}).change('es-CO').reloads,0);
assert.equal(selector({initial:'es-CO'}).change('en').reloads,1);
assert.equal(selector().change('en').reloads,0);
assert.ok(!selector({protocol:'http:'}).change('es-CO').cookie.includes('Secure'));
console.log('Passed default English, cookie allowlist, both languages on every page, concurrent request isolation, API display translation, HEAD/Vary, stable IDs/data, selector persistence, and unfinished-work cancellation.');

const spanishRuntime=spawnSync(process.execPath,['--input-type=module','-e',`
 globalThis.document={documentElement:{lang:'es-CO'}};
 const {locale,t}=await import('./dist/i18n.mjs');
 const {familyLabel}=await import('./dist/quiz.mjs');
 if(locale!=='es-CO'||t('common:locationCount',{count:2})!=='2 lugares'||familyLabel('Furnariidae')!=='Horneros, chamiceros y trepatroncos (Furnariidae)')process.exit(1);
 if(new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(new Date('2026-02-01'))!=='febrero')process.exit(1);
`],{encoding:'utf8'});
assert.equal(spanishRuntime.status,0,spanishRuntime.stderr);
console.log('Passed actual Spanish runtime initialization, translated family labels, and Spanish month formatting.');
