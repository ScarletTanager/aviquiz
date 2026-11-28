import assert from 'node:assert/strict';
import {parse} from 'parse5';
import application from './dist/server/index.js';
function elements(node){return [node,...(node.childNodes||[]).flatMap(elements)];}
const attr=(n,key)=>n.attrs?.find(a=>a.name===key)?.value;
const expected=['/explore','/quiz','/trips','/statistics','/invite'];
for(const language of ['en','es-CO'])for(const path of ['/','/explore','/quiz','/trips','/statistics','/invite','/review','/releases']){
 const response=await application.fetch(new Request('https://quiz.example'+path,{headers:{cookie:'aviquiz-language='+language}}),{});assert.equal(response.status,200);
 const html=await response.text(),nodes=elements(parse(html)),header=nodes.find(n=>n.tagName==='header');assert.ok(header,path);
 const headerNodes=elements(header),nav=headerNodes.find(n=>n.tagName==='nav'&&attr(n,'class')==='site-nav');assert.ok(nav,path+' main navigation');
 const links=elements(nav).filter(n=>n.tagName==='a');assert.deepEqual(links.map(n=>attr(n,'href')),expected,path+' header destinations');
 assert.ok(headerNodes.some(n=>n.tagName==='a'&&attr(n,'href')==='/'),path+' home link');
 const invite=links.find(n=>attr(n,'id')==='invite-link');assert.ok(invite.attrs.some(a=>a.name==='hidden'),'Invitations remain hidden until permission is checked');
 assert.ok(headerNodes.some(n=>attr(n,'id')==='account-action'));assert.ok(nodes.some(n=>attr(n,'id')==='account-status'));
 assert.ok(headerNodes.some(n=>attr(n,'id')==='interface-language'));assert.ok(html.includes('src="/auth.mjs"'));
 if(['/explore','/invite'].includes(path))assert.equal(attr(links.find(n=>attr(n,'href')===path),'aria-current'),'page');
 const ids=nodes.flatMap(n=>attr(n,'id')?[attr(n,'id')]:[]);assert.equal(new Set(ids).size,ids.length,path+' duplicate IDs');
}
console.log('Passed consistent navigation on all English/Spanish page routes, home access, active-page markers, auth controls, permission-hidden invitations, and unique IDs.');
