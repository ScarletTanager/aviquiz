import {t} from '../dist/i18n.mjs';
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
   if(request.method!=='POST')return json({error:t("worker-nc-api:method_not_allowed_5765cf56")},405);
   const n=url.searchParams.get('chunk');if(!/^\d+$/.test(n||'')||[...url.searchParams.keys()].some(k=>k!=='chunk'))return json({error:t("common:badChunk")},400);
   const chunk=index.chunks[Number(n)];if(!chunk||!env.EBD_BUCKET)return json({error:t("common:noStorage")},503);
   if(await env.EBD_BUCKET.head(chunk.sha256))return json({stored:true,unchanged:true});
   const reader=request.body?.getReader();if(!reader)return json({error:t("worker-nc-api:body_required_707a0b3a")},400);
   const parts=[];let size=0;
   for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>chunk.bytes){await reader.cancel();return json({error:t("common:badSize")},400);}parts.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   if(size!==chunk.bytes||await digest(bytes)!==chunk.sha256)return json({error:t("worker-nc-api:artifact_verification_failed_f5db8ef3")},400);
   await env.EBD_BUCKET.put(chunk.sha256,bytes);return json({stored:true});
  }
  if(request.method!=='GET')return json({error:t("worker-nc-api:method_not_allowed_5765cf56")},405);
  if([...url.searchParams.keys()].some(k=>!['place','from','to','single','family'].includes(k)))return json({error:t("worker-nc-api:invalid_query_e7a90c1f")},400);
  const place=url.searchParams.get('place'),entry=index.places[place];if(!entry)return json({error:t("worker-nc-api:no_nc_seasonal_data_for_this_place_760bf011")},404);
  seasonRange(url.searchParams.get('from'),url.searchParams.get('to'));
  const chunk=index.chunks[entry.chunk];
  if(!env.EBD_BUCKET)return json({error:t("worker-nc-api:nc_seasonal_data_is_not_loaded_yet_63c2494d")},503);
  const object=await env.EBD_BUCKET.get(chunk.sha256,{range:{offset:entry.offset,length:entry.length}});if(!object)return json({error:t("worker-nc-api:nc_seasonal_data_is_not_loaded_yet_63c2494d")},503);
  const compressed=await object.arrayBuffer();if(compressed.byteLength!==entry.length||await digest(compressed)!==entry.sha256)throw Error(t("worker-nc-api:invalid_stored_artifact_7ed2b96c"));
  const raw=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).text();if(raw.length>entry.rawBytes)throw Error(t("worker-nc-api:invalid_artifact_length_4f1baab3"));
  const result=seasonalSpecies(JSON.parse(raw),url.searchParams.get('from'),url.searchParams.get('to'),url.searchParams.get('single')==='true');
  const family=url.searchParams.get('family')||'all';
  const species=result.rows.map(r=>({...catalog.birds[r.bird],reportingSeasons:r.seasons})).filter(b=>family==='all'||familyName(b.family)===family).sort((a,b)=>a.taxonOrder-b.taxonOrder);
  return json({place,years:index.years,sampledSeasons:result.seasons,species,pool:species.filter(b=>b.photos.length),notice:t("worker-nc-api:complete_eligible_checklists_grouped_into_independent_o_5c57db94")});
 }catch(error){if(error.messageKey?.startsWith('geography-core:'))return json({error:error.message},400);console.error(JSON.stringify({event:'nc_catalog_failed',type:error.name}));return json({error:t("worker-nc-api:nc_seasonal_data_could_not_load_please_retry_later_e168a2c2")},503);}
}
