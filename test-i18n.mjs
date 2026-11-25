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
