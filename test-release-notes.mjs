import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parse} from 'parse5';
import application from './dist/server/index.js';
import {validateReleases,releaseMarkup,releaseAnchor} from './scripts/release-notes.mjs';
import {resourcesFor} from './dist/i18n.mjs';
const manifest=JSON.parse(await fs.readFile('data/releases.json','utf8'));
const current=manifest.releases.find(r=>r.tag===manifest.currentTag);
const preview=current.productionDeployedAt===null;
assert.equal(manifest.releases.find(r=>r.tag==='v0.1.0-alpha.1').productionDeployedAt,'2026-11-24');
function elements(html){const nodes=[];function visit(n){if(n.tagName)nodes.push(n);for(const c of n.childNodes||[])visit(c);}visit(parse(html));return nodes;}
const attr=(node,name)=>node.attrs.find(a=>a.name===name)?.value;
for(const language of ['en','es-CO']){
 const headers={cookie:'aviquiz-language='+language};
 for(const path of ['/','/quiz','/explore','/invite','/review','/releases']){
  const response=await application.fetch(new Request('https://quiz.example'+path,{headers}),{});assert.equal(response.status,200);
  const html=await response.text(),nodes=elements(html),links=nodes.filter(n=>n.tagName==='a');
  assert.ok(links.some(n=>attr(n,'href')==='/releases'),path+': notes link');
  assert.ok(links.some(n=>attr(n,'href')==='/releases#'+releaseAnchor(manifest.currentTag)),path+': exact version link');
  if(preview)assert.ok(html.includes(language==='en'?'Preview':'Versión de prueba'));assert.ok(!html.includes('<!--release-'));
  if(path==='/releases'){
   const sections=nodes.filter(n=>n.tagName==='section');assert.deepEqual(sections.map(n=>attr(n,'id')),validateReleases(manifest).map(r=>releaseAnchor(r.tag)));
   assert.ok(nodes.some(n=>n.tagName==='time'&&attr(n,'datetime')==='2026-11-24'));
   if(manifest.releases.some(r=>r.productionDeployedAt===null))assert.ok(html.includes(language==='en'?'Not yet deployed to production':'Aún no publicada en producción'));
   for(const section of sections){assert.ok(section.childNodes.some(n=>n.tagName==='p'));assert.ok(section.childNodes.some(n=>n.tagName==='ul'));}
   assert.ok(!html.includes('datetime="null"'));
  }
 }
 const response=await application.fetch(new Request('https://quiz.example/releases',{method:'HEAD',headers}),{});assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(response.headers.get('content-language'),language);
}
const bad=structuredClone(manifest);bad.releases[0].productionDeployedAt='2026-02-30';assert.throws(()=>validateReleases(bad),/date/);
const duplicate=structuredClone(manifest);duplicate.releases.push(duplicate.releases[0]);assert.throws(()=>validateReleases(duplicate),/Duplicate/);
const missing=structuredClone(manifest);missing.currentTag='v9.0.0';assert.throws(()=>validateReleases(missing),/no notes/);
const noMessage=structuredClone(manifest);noMessage.releases[0].intro='missing';assert.throws(()=>releaseMarkup(noMessage,'en',resourcesFor('en')),/Missing release message/);
const backport={currentTag:'v0.1.1',releases:[{...current,tag:'v0.2.0',productionDeployedAt:'2026-11-25'},{...current,tag:'v0.1.1',productionDeployedAt:'2026-11-26'}]};assert.equal(validateReleases(backport)[0].tag,'v0.1.1');
const draft=structuredClone(manifest);draft.releases.find(r=>r.tag===draft.currentTag).productionDeployedAt=null;assert.ok(releaseMarkup(draft,'en',resourcesFor('en')).footer.includes('release-preview'));
const published=structuredClone(manifest);published.releases.find(r=>r.tag===published.currentTag).productionDeployedAt='2026-11-27';assert.ok(!releaseMarkup(published,'en',resourcesFor('en')).footer.includes('release-preview'));
console.log('Passed bilingual release page/footer/version anchors, deployment dates, preview honesty, release ordering, HEAD, and invalid metadata rejection.');
