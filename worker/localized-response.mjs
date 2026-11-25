import {resourcesFor} from '../dist/i18n.mjs';
const english=resourcesFor('en'),spanish=resourcesFor('es-CO');
const exact=new Map(),patterns=[];
const escapeRegExp=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Presentation adapter for the legacy English API message contract. Match only
// application-owned top-level display fields; never translate domain data,
// nested review documents, identifiers, audit records, or branch on this text.
for(const [namespace,bundle]of Object.entries(english)){
 if(!/^(worker-|server-|geography-core$|review-core$|statistics-history$|routes$|common$)/.test(namespace))continue;
 for(const [key,text]of Object.entries(bundle)){
  if(namespace==='common'&&!['noStorage','badSize','badRecord','badLength','otherAreas','badChunk'].includes(key))continue;
  const translated=spanish[namespace]?.[key];if(!translated)continue;
  const slots=[...text.matchAll(/\{\{(\w+)\}\}/g)];
  if(!slots.length){exact.set(text,translated);continue;}
  const names=[];let expression='^',offset=0;
  for(const slot of slots){expression+=escapeRegExp(text.slice(offset,slot.index))+'([\\s\\S]*?)';names.push(slot[1]);offset=slot.index+slot[0].length;}
  expression+=escapeRegExp(text.slice(offset))+'$';patterns.push({regex:new RegExp(expression),names,translated});
 }
}
export function localizedServerText(text,locale){
 if(locale!=='es-CO'||typeof text!=='string'||text.length>20000)return text;
 if(exact.has(text))return exact.get(text);
 for(const {regex,names,translated}of patterns){const match=regex.exec(text);if(!match)continue;const params=Object.fromEntries(names.map((name,i)=>[name,match[i+1]]));return translated.replace(/\{\{(\w+)\}\}/g,(_,name)=>params[name]);}
 return text;
}
export async function localizeApiResponse(response,locale){
 if(!response.headers.get('content-type')?.includes('application/json'))return response;
 const headers=new Headers(response.headers);headers.set('content-language',locale);headers.set('vary',headers.get('vary')?headers.get('vary')+', Cookie':'Cookie');
 if(locale==='en')return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 const data=await response.json();
 if(data&&typeof data==='object'&&!Array.isArray(data))for(const key of ['error','notice','message'])if(typeof data[key]==='string')data[key]=localizedServerText(data[key],locale);
 headers.delete('content-length');
 return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
}
