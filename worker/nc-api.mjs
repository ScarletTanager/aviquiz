import index from './nc-index.json' with {type:'json'};
import catalog from '../dist/nc-birds.json' with {type:'json'};
import {seasonRange} from '../dist/geography-core.mjs';
import {seasonalSpecies} from '../dist/nc-core.mjs';
import {familyName} from '../dist/quiz.mjs';
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export const ncPlaces=index.places;
export async function ncApi(request,env){
 const url=new URL(request.url);
 try{
  if(url.pathname==='/api/nc/import'){
   // Content-addressed publication accepts only exact reviewed, compiled artifacts.
   // There is no arbitrary object key, content, overwrite, or remote fetch capability.
   if(request.method!=='POST')return json({error:'Method not allowed.'},405);
   const n=url.searchParams.get('chunk');if(!/^\d+$/.test(n||'')||[...url.searchParams.keys()].some(k=>k!=='chunk'))return json({error:'Invalid chunk.'},400);
   const chunk=index.chunks[Number(n)];if(!chunk||!env.EBD_BUCKET)return json({error:'Storage unavailable.'},503);
   if(await env.EBD_BUCKET.head(chunk.sha256))return json({stored:true,unchanged:true});
   const reader=request.body?.getReader();if(!reader)return json({error:'Body required.'},400);
   const parts=[];let size=0;
   for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>chunk.bytes){await reader.cancel();return json({error:'Size mismatch.'},400);}parts.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   if(size!==chunk.bytes||await digest(bytes)!==chunk.sha256)return json({error:'Artifact verification failed.'},400);
   await env.EBD_BUCKET.put(chunk.sha256,bytes);return json({stored:true});
  }
  if(request.method!=='GET')return json({error:'Method not allowed.'},405);
  if([...url.searchParams.keys()].some(k=>!['place','from','to','single','family'].includes(k)))return json({error:'Invalid query.'},400);
  const place=url.searchParams.get('place'),entry=index.places[place];if(!entry)return json({error:'No NC seasonal data for this place.'},404);
  seasonRange(url.searchParams.get('from'),url.searchParams.get('to'));
  const chunk=index.chunks[entry.chunk];
  if(!env.EBD_BUCKET)return json({error:'NC seasonal data is not loaded yet.'},503);
  const object=await env.EBD_BUCKET.get(chunk.sha256,{range:{offset:entry.offset,length:entry.length}});if(!object)return json({error:'NC seasonal data is not loaded yet.'},503);
  const compressed=await object.arrayBuffer();if(compressed.byteLength!==entry.length||await digest(compressed)!==entry.sha256)throw Error('Invalid stored artifact');
  const raw=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();if(raw.length>entry.rawBytes)throw Error('Invalid artifact length');
  const result=seasonalSpecies(JSON.parse(raw),url.searchParams.get('from'),url.searchParams.get('to'),url.searchParams.get('single')==='true');
  const family=url.searchParams.get('family')||'all';
  const species=result.rows.map(r=>({...catalog.birds[r.bird],reportingSeasons:r.seasons})).filter(b=>family==='all'||familyName(b.family)===family).sort((a,b)=>a.taxonOrder-b.taxonOrder);
  return json({place,years:index.years,sampledSeasons:result.seasons,species,pool:species.filter(b=>b.photos.length),notice:'Complete eligible checklists, grouped into independent outings; 2017–2025. Species reported in only one sampled season are excluded by default when at least two seasons were sampled. This reduces one-time rarities but is not a guarantee of occurrence. Photo coverage is still being expanded. Geography quizzes do not change saved statistics.'});
 }catch(error){if(/Choose/.test(error.message))return json({error:error.message},400);console.error(JSON.stringify({event:'nc_catalog_failed',type:error.name}));return json({error:'NC seasonal data could not load. Please retry later.'},503);}
}
