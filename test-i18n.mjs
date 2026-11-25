import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {locale,t,messageError,messageExists,messages} from './dist/i18n.mjs';
assert.equal(locale,'en');
assert.equal(t('common:locationCount',{count:0}),'0 locations');
assert.equal(t('common:locationCount',{count:1}),'1 location');
assert.equal(t('common:locationCount',{count:2}),'2 locations');
assert.equal(t('common:questionNoun',{count:1}),'question');
assert.equal(t('common:questionNoun',{count:20}),'questions');
assert.equal(t('common:eligibleOutings',{count:1}),'1 eligible outing');
assert.equal(t('common:eligibleOutings',{count:3}),'3 eligible outings');
assert.equal(t('common:dateRange',{start:'2026-01-01',end:'2026-03-31'}),'2026-01-01 to 2026-03-31');
assert.equal(t('common:recordingFor',{species:'<img onerror="evil()"> $& {{v0}} $t(common:identified)'}),'<img onerror="evil()"> $& {{v0}} $t(common:identified) recording');
// t is plain text, not HTML: textContent and JSON keep literal user input.
// Existing rich renderers must escape external text before interpolation.
const {annotationSvg}=await import('./dist/id-tips.mjs');
const svg=annotationSvg({width:1400,height:800,features:[],tips:[]},{id:'123'},'<img onerror="evil()">');
assert.ok(!svg.includes('<img'));assert.ok(svg.includes('&lt;img'));
assert.throws(()=>t('common:doesNotExist'),/Missing message key/);
assert.ok(messageExists('common:identified'));
const error=messageError('geography-core:choose_a_valid_year_and_month_9dbc8897');
assert.equal(error.messageKey,'geography-core:choose_a_valid_year_and_month_9dbc8897');
assert.equal(error.message,'Choose a valid year and month.');
for(const status of ['unreviewed','draft','approved','skipped','blocked'])assert.ok(t('common:reviewStatus_'+status));
for(const [ns,values]of Object.entries(messages))for(const value of Object.values(values)){
 assert.ok(!/<script\b|\bon\w+\s*=|javascript:/i.test(value),`Unsafe language markup in ${ns}`);
}
// Rebuilding is deterministic and canonical static templates preserve IDs and page text.
const files=[...(await fs.readdir('dist')).filter(n=>/\.html$/.test(n)), 'messages-en.mjs','i18next.mjs'];
const before=await Promise.all(files.map(n=>fs.readFile('dist/'+n)));
const build=spawnSync(process.execPath,['scripts/build-i18n.mjs'],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
for(let i=0;i<files.length;i++)assert.deepEqual(await fs.readFile('dist/'+files[i]),before[i],'Nondeterministic generated asset '+files[i]);
const check=spawnSync(process.execPath,['scripts/check-i18n.mjs'],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);console.log(check.stdout.trim());
console.log('Passed English-only initialization, strict keys, counts/plurals, interpolation isolation, annotation escaping, stable validation codes, safe bundles, and deterministic generation.');

// Exercise Spanish in an isolated instance: the live application stays English.
const {default:i18next}=await import('./dist/i18next.mjs');
const {readLocale,validateLocale}=await import('./scripts/locale-parity.mjs');
const spanish=await readLocale(new URL('./locales/',import.meta.url).pathname,'es-CO');
assert.equal(validateLocale(messages,spanish,'es-CO'),Object.values(messages).reduce((n,bundle)=>n+Object.keys(bundle).length,0));
const es=i18next.createInstance();
await es.init({lng:'es-CO',fallbackLng:false,resources:{'es-CO':spanish},ns:Object.keys(spanish),defaultNS:'common',keySeparator:false,initAsync:false,interpolation:{escapeValue:false}});
assert.equal(es.t('common:locationCount',{count:1}),'1 lugar');
assert.equal(es.t('common:locationCount',{count:0}),'0 lugares');
assert.equal(es.t('common:locationCount',{count:2}),'2 lugares');
assert.equal(es.t('common:locationCount',{count:1000000}),'1000000 lugares');
assert.equal(es.t('common:eligibleOutings',{count:1}),'1 salida disponible');
assert.equal(es.t('common:eligibleOutings',{count:3}),'3 salidas disponibles');
assert.equal(es.t('common:sampledMonths',{count:2,month:'febrero'}),'2 temporadas de febrero muestreadas');
assert.equal(es.t('common:recordingFor',{species:'Plain Xenops'}),'Grabación de Plain Xenops');
assert.equal(es.t('common:signedInAs',{email:'test@example.org'}),' como test@example.org');
assert.equal(es.t('families:Furnariidae'),'Horneros, chamiceros y trepatroncos');
for(const [ns,values]of Object.entries(spanish))for(const [key,value]of Object.entries(values)){
 const params=Object.fromEntries([...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m=>[m[1],m[1]==='count'?2:'PRUEBA']));
 const rendered=es.t(ns+':'+key,params);assert.ok(!/\{\{\s*\w+\s*\}\}/.test(rendered),'Unresolved Spanish interpolation '+ns+':'+key);
}
const invalid=structuredClone(spanish);delete invalid.common.recordingFor;
assert.throws(()=>validateLocale(messages,invalid,'missing'),/keys/);
const slotError=structuredClone(spanish);slotError.common.recordingFor='Grabación de {{bird}}';
assert.throws(()=>validateLocale(messages,slotError,'slots'),/interpolation/);
const htmlKey=Object.keys(spanish.app).find(k=>spanish.app[k].includes('href='));
const changedLink=structuredClone(spanish);changedLink.app[htmlKey]=changedLink.app[htmlKey].replace('href=','data-url=');
assert.throws(()=>validateLocale(messages,changedLink,'link'),/protected attributes/);
assert.equal(locale,'en');assert.equal(t('common:locationCount',{count:2}),'2 locations');
console.log('Passed isolated Colombian Spanish rendering for every message, plural forms, unchanged proper names, and rejection of missing keys, altered placeholders, and changed links. Live language remains English.');
