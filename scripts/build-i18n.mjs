import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {releaseMarkup} from './release-notes.mjs';
const root=path.resolve(import.meta.dirname,'..'),read=async name=>fs.readFile(path.join(root,name),'utf8');
const languages=['en','es-CO'],bundles={};
for(const language of languages){
 const resources={};
 for(const name of (await fs.readdir(path.join(root,'locales',language))).filter(n=>n.endsWith('.json')).sort()){
  const value=JSON.parse(await read('locales/'+language+'/'+name));
  if(!value||typeof value!=='object'||Object.values(value).some(v=>typeof v!=='string'))throw Error('Invalid language bundle: '+name);
  resources[name.slice(0,-5)]=value;
 }
 bundles[language]=resources;
 await fs.writeFile(path.join(root,'dist/messages-'+language+'.mjs'),'// Generated from locales/'+language+'/*.json. Edit the source bundles.\nexport default '+JSON.stringify(resources)+';\n');
}
const vendor=await build({stdin:{contents:'export {default} from "i18next";',resolveDir:root},bundle:true,format:'esm',platform:'browser',minify:true,write:false,target:'es2022'});
await fs.writeFile(path.join(root,'dist/i18next.mjs'),'// Generated from pinned i18next. See i18next-LICENSE.txt.\n'+vendor.outputFiles[0].text);
await fs.copyFile(path.join(root,'node_modules/i18next/LICENSE'),path.join(root,'dist/i18next-LICENSE.txt'));
const references=await read('data/route-photo-references.json');
JSON.parse(references);
await fs.writeFile(path.join(root,'dist/route-photo-references-data.mjs'),'// Generated from data/route-photo-references.json; see route-photo-references.mjs for attribution.\nexport default '+references.trim()+';\n');
for(const name of ['audio-areas','route-extra-data']){
 const text=await read('data/'+name+'.json');JSON.parse(text);
 await fs.writeFile(path.join(root,'dist',name+'.mjs'),'// Generated from data/'+name+'.json. These identities are not translated.\nexport default '+text.trim()+';\n');
}
const releaseManifest=JSON.parse(await read('data/releases.json'));
const escapeAttribute=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const name of (await fs.readdir(path.join(root,'pages'))).filter(n=>n.endsWith('.html'))){
 for(const language of languages){
 let source=(await read('pages/'+name)).replace('<html lang="en">','<html lang="'+language+'">');
 source=source.replace('<option value="'+language+'">','<option value="'+language+'" selected>');
 const activePage={'explore.html':'/explore','invite.html':'/invite'}[name];
 let navigation=await read('pages/partials/main-navigation.html');
 if(activePage)navigation=navigation.replace('href="'+activePage+'"','href="'+activePage+'" aria-current="page"');
 source=source.replace('<!--main-navigation-->',navigation.trim());
 const resources=bundles[language];
 const notes=releaseMarkup(releaseManifest,language,resources);
 source=source.replaceAll('<!--release-footer-->',notes.footer).replaceAll('<!--release-sections-->',notes.sections);
 const lookup=key=>{const split=key.indexOf(':'),value=resources[key.slice(0,split)]?.[key.slice(split+1)];if(typeof value!=='string')throw Error('Missing page message: '+key);return value;};
 source=source.replace(/<!--msg ([a-z0-9_-]+:[a-zA-Z0-9_.-]+)-->/g,(_,key)=>lookup(key));
 source=source.replace(/@@msg:([a-z0-9_-]+:[a-zA-Z0-9_.-]+)@@/g,(_,key)=>escapeAttribute(lookup(key)));
 if(/<!--msg |@@msg:/.test(source))throw Error('Unresolved page message');
 const output=language==='en'?name:name.replace('.html','.'+language+'.html');
 await fs.writeFile(path.join(root,'dist',output),source);
 if(name==='index.html'){
  const play=source.replace('<section id="landing"','<section id="landing" hidden').replace('<section id="quiz-loading" hidden','<section id="quiz-loading"').replace('id="nav-explore" href="/explore"','id="nav-explore" href="/explore" aria-current="page"').replace(/<title>[\s\S]*?<\/title>/,'<title>'+escapeAttribute(resources['page-index'].quizLoadingTitle)+' · AviQuiz</title>');
  await fs.writeFile(path.join(root,'dist',language==='en'?'play.html':'play.'+language+'.html'),play);
 }

 }
}
console.log('Built English and Colombian Spanish message bundles and pages.');
