import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseFragment} from 'parse5';
const slots=value=>[...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m=>m[1]).sort();
function structure(value){
 const result=[];
 function visit(node){
  if(node.tagName){
   // Text may be translated, but links, controls, SVG geometry and other
   // application-owned attributes must survive unchanged in these bundles.
   result.push({tag:node.tagName,attrs:(node.attrs||[]).map(a=>[a.name,a.value]).sort(([a],[b])=>a.localeCompare(b))});
  }
  for(const child of node.childNodes||[])visit(child);
 }
 visit(parseFragment(value));return result;
}
export function validateLocale(reference,candidate,label){
 assert.deepEqual(Object.keys(candidate).sort(),Object.keys(reference).sort(),label+': bundle namespaces');
 let count=0;
 for(const [namespace,bundle]of Object.entries(reference)){
  const translated=candidate[namespace];assert.deepEqual(Object.keys(translated).sort(),Object.keys(bundle).sort(),label+': keys in '+namespace);
  for(const [key,value]of Object.entries(bundle)){
   const text=translated[key],location=label+':'+namespace+':'+key;
   assert.equal(typeof text,'string',location+': expected string');assert.ok(text.trim(),location+': empty translation');
   assert.deepEqual(slots(text),slots(value),location+': interpolation occurrences');
   assert.ok(!/<script\b|\bon\w+\s*=|javascript:/i.test(text),location+': unsafe markup');
   assert.deepEqual(structure(text),structure(value),location+': markup structure or protected attributes');
   count++;
  }
 }
 return count;
}
export async function readLocale(root,locale){
 const bundles={};
 for(const file of (await fs.readdir(path.join(root,locale))).filter(f=>f.endsWith('.json')).sort())bundles[file.slice(0,-5)]=JSON.parse(await fs.readFile(path.join(root,locale,file),'utf8'));
 return bundles;
}
export async function checkLocales(root){
 const reference=await readLocale(root,'en'),counts={};
 for(const directory of await fs.readdir(root,{withFileTypes:true}))if(directory.isDirectory()&&directory.name!=='en')counts[directory.name]=validateLocale(reference,await readLocale(root,directory.name),directory.name);
 return counts;
}
