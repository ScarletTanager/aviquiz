import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parse} from 'parse5';
import application from './dist/server/index.js';
import {validateReleases,releaseMarkup,releaseAnchor} from './scripts/release-notes.mjs';
import {resourcesFor} from './dist/i18n.mjs';
const manifest=JSON.parse(await fs.readFile('data/releases.json','utf8'));
const current=manifest.releases.find(r=>r.tag===manifest.currentTag);
const preview=current.releaseDate===null;
assert.equal(manifest.releases.find(r=>r.tag==='v0.1.0-alpha.1').releaseDate,'2026-11-24');
function elements(html){const nodes=[];function visit(n){if(n.tagName)nodes.push(n);for(const c of n.childNodes||[])visit(c);}visit(parse(html));return nodes;}
const attr=(node,name)=>node.attrs.find(a=>a.name===name)?.value;
for(const language of ['en','es-CO']){
 const headers={cookie:'aviquiz-language='+language};
 for(const path of ['/','/quiz','/explore','/invite','/review','/releases']){
  const response=await application.fetch(new Request('https://quiz.example'+path,{headers}),{});assert.equal(response.status,200);
  const html=await response.text(),nodes=elements(html),links=nodes.filter(n=>n.tagName==='a');
  assert.ok(links.some(n=>attr(n,'href')==='/releases'),path+': notes link');
  assert.ok(links.some(n=>attr(n,'href')==='/releases#'+releaseAnchor(manifest.currentTag)),path+': exact version link');
  if(preview)assert.ok(html.includes(language==='en'?'Development':'En desarrollo'));assert.ok(!html.includes('<!--release-'));
  if(path==='/releases'){
   const sections=nodes.filter(n=>n.tagName==='section');assert.deepEqual(sections.map(n=>attr(n,'id')),validateReleases(manifest).map(r=>releaseAnchor(r.tag)));
   assert.ok(nodes.some(n=>n.tagName==='time'&&attr(n,'datetime')==='2026-11-24'));
   if(manifest.releases.some(r=>r.releaseDate===null))assert.ok(html.includes(language==='en'?'Not yet packaged and tagged':'Aún no empaquetada ni etiquetada'));
   for(const section of sections){assert.ok(section.childNodes.some(n=>n.tagName==='p'));assert.ok(section.childNodes.some(n=>n.tagName==='ul'));}
   assert.ok(!html.includes('datetime="null"'));
   for(const internal of ['command-line workflow','collector queue','paquetes comunes','línea de comandos'])assert.ok(!html.includes(internal),'No internal workflow details in public notes');
   assert.ok(!html.includes(language==='en'?'Not yet deployed to production':'Aún no publicada en producción'));
   assert.ok(html.includes(language==='en'?'Includes all features and improvements from v0.2.0-alpha.1':'Incluye todas las funciones y mejoras de v0.2.0-alpha.1'));
   assert.ok(links.some(n=>attr(n,'href')==='#release-v0.2.0-alpha.2'));

  }
 }
 const response=await application.fetch(new Request('https://quiz.example/releases',{method:'HEAD',headers}),{});assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(response.headers.get('content-language'),language);
}
const bad=structuredClone(manifest);bad.releases[0].releaseDate='2026-02-30';assert.throws(()=>validateReleases(bad),/date/);
const duplicate=structuredClone(manifest);duplicate.releases.push(duplicate.releases[0]);assert.throws(()=>validateReleases(duplicate),/Duplicate/);
const missing=structuredClone(manifest);missing.currentTag='v9.0.0';assert.throws(()=>validateReleases(missing),/no notes/);
const noMessage=structuredClone(manifest);noMessage.releases[0].intro='missing';assert.throws(()=>releaseMarkup(noMessage,'en',resourcesFor('en')),/Missing release message/);
const backport={currentTag:'v0.1.1',releases:[{...current,tag:'v0.2.0',releaseDate:'2026-11-25'},{...current,tag:'v0.1.1',releaseDate:'2026-11-26'}]};assert.equal(validateReleases(backport)[0].tag,'v0.2.0');
const draft=structuredClone(manifest);draft.releases.find(r=>r.tag===draft.currentTag).releaseDate=null;assert.ok(releaseMarkup(draft,'en',resourcesFor('en')).footer.includes('release-preview'));
const published=structuredClone(manifest);published.releases.find(r=>r.tag===published.currentTag).releaseDate='2026-11-27';assert.ok(!releaseMarkup(published,'en',resourcesFor('en')).footer.includes('release-preview'));
const ordered=validateReleases(manifest).map(r=>r.tag);assert.ok(ordered.indexOf('v0.2.0-alpha.2')<ordered.indexOf('v0.2.0-alpha.1'));assert.ok(ordered.indexOf('v0.2.0-alpha.1')<ordered.indexOf('v0.1.0-alpha.1'));
const olderPending=structuredClone(manifest);olderPending.releases.find(r=>r.tag==='v0.2.0-alpha.1').releaseDate=null;assert.ok(validateReleases(olderPending).findIndex(r=>r.tag==='v0.2.0-alpha.2')<validateReleases(olderPending).findIndex(r=>r.tag==='v0.2.0-alpha.1'));
const included=structuredClone(manifest);included.releases.find(r=>r.includedIn).includedIn='v0.1.0-alpha.1';assert.throws(()=>validateReleases(included),/newer existing/);
assert.equal(manifest.releases.find(r=>r.tag==='v0.2.0-alpha.2').releaseDate,'2026-11-28');
assert.ok(!manifest.releases.some(r=>r.items.includes('alpha02Workflow')));
console.log('Passed bilingual release page/footer/version anchors, packaging/tagging dates, development status, descending semantic-version ordering and superseded-candidate attribution, HEAD, and invalid metadata rejection.');
