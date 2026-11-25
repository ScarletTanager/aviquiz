import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import {parse as parseHTML} from 'parse5';
import {messages} from '../dist/i18n.mjs';
import {checkLocales} from './locale-parity.mjs';
const root=path.resolve(import.meta.dirname,'..');
const placeholders=value=>[...new Set([...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m=>m[1]))].sort();
let uses=0;
function lookup(key){const colon=key.indexOf(':'),ns=key.slice(0,colon),id=key.slice(colon+1);return messages[ns]?.[id]??messages[ns]?.[id+'_other'];}
const excluded=new Set(['i18n.mjs','i18next.mjs','messages-en.mjs','messages-es-CO.mjs','oidc-client-ts.mjs','jwt-decode.mjs','audio-areas.mjs','route-extra-data.mjs','route-photo-references-data.mjs']);
for(const dir of ['dist','worker','server'])for(const file of await fs.readdir(path.join(root,dir))){
 if(!file.endsWith('.mjs')||excluded.has(file))continue;
 const source=await fs.readFile(path.join(root,dir,file),'utf8'),ast=parse(source,{sourceType:'module'});
 function visit(node){
  if(!node||typeof node!=='object')return;
  // Literal text assigned directly to a user-visible DOM property must use a bundle.
  if(node.type==='AssignmentExpression'&&['textContent','innerHTML','title','placeholder','alt'].includes(node.left?.property?.name)&&node.right?.type==='StringLiteral')assert.ok(!/[a-zA-Z]/.test(node.right.value),`${dir}/${file}:${node.loc.start.line}: hardcoded display text`);
  if(node.type==='CallExpression'&&['t','messageError'].includes(node.callee?.name)){
   const key=node.arguments[0];
   // Review status suffixes are intentionally machine-code mappings; all variants are tested below.
   if(key?.type!=='StringLiteral'){
    const allowed=new Set(['"common:reviewStatus_"+(row?.status||"unreviewed")','"common:reviewStatus_"+(rowFor(p.id)?.status||"unreviewed")']);
    assert.ok(file==='review-app.mjs'&&allowed.has(source.slice(key.start,key.end)),'Unexpected dynamic message key in '+file);
   }
   else{
    const value=lookup(key.value);assert.equal(typeof value,'string',`${dir}/${file}:${node.loc.start.line}: missing ${key.value}`);
    const params=node.arguments[1];assert.ok(!params||params.type==='ObjectExpression','Message parameters must be explicit');
    const supplied=(params?.properties||[]).map(p=>p.key.name??p.key.value).sort();
    const expected=placeholders(value);if(supplied.includes("count")&&!expected.includes("count"))expected.push("count");
    assert.deepEqual(supplied,expected.sort(),`${dir}/${file}:${node.loc.start.line}: parameters for ${key.value}`);uses++;
   }
  }
  for(const [key,value]of Object.entries(node)){if(key==='loc')continue;if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}
 }
 visit(ast);
}
for(const file of (await fs.readdir(path.join(root,'pages'))).filter(n=>n.endsWith('.html'))){
 const source=await fs.readFile(path.join(root,'pages',file),'utf8');
 for(const match of source.matchAll(/(?:<!--msg |@@msg:)([\w-]+:[\w.-]+?)(?:-->|@@)/g)){assert.equal(typeof lookup(match[1]),'string',file+': missing '+match[1]);uses++;}
 function visit(node){
  if(['script','style'].includes(node.tagName))return;
  if(node.nodeName==='#text')assert.ok(!/[a-zA-Z]/.test(node.value.replace(/<!--msg [\w-]+:[\w.-]+-->/g,"")),file+': untranslated text '+node.value.trim());
  for(const attr of node.attrs||[])if(['title','alt','placeholder','aria-label','aria-description'].includes(attr.name)&&/[a-zA-Z]/.test(attr.value))assert.match(attr.value,/^@@msg:[\w-]+:[\w.-]+@@$/,file+': untranslated '+attr.name);
  for(const child of node.childNodes||[])visit(child);
 }
 visit(parseHTML(source));
}
for(const [ns,bundle]of Object.entries(messages))for(const [key,value]of Object.entries(bundle)){
 assert.equal(typeof value,'string',ns+':'+key);
 assert.ok(!/\{\{[^}]*$/.test(value),'Unclosed interpolation '+key);
 if(key.endsWith('_one')){const other=bundle[key.slice(0,-4)+'_other'];assert.equal(typeof other,'string','Missing plural counterpart '+key);assert.deepEqual(placeholders(value),placeholders(other),'Plural parameters '+key);}
}
for(const status of ['unreviewed','draft','approved','skipped','blocked'])assert.ok(lookup('common:reviewStatus_'+status),'Missing review status '+status);
console.log(`Checked ${uses} message references, interpolation parameters, plural pairs, and canonical page text.`);

for(const [locale,count]of Object.entries(await checkLocales(path.join(root,'locales'))))console.log(`Checked ${locale}: ${count} translations, exact key/placeholder parity, and protected markup.`);
