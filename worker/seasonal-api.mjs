import {t} from '../dist/i18n.mjs';
import registry from './seasonal-packages.json' with {type:'json'};
import {seasonalSpecies,seasonalPhotos} from '../dist/seasonal-core.mjs';
import {seasonRange} from '../dist/geography-core.mjs';
import {familyName} from '../dist/quiz.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export const seasonalPackages=registry.packages;
export async function seasonalApi(request,env){
 const url=new URL(request.url),packages=env.SEASONAL_PACKAGES||seasonalPackages;
 if(url.pathname==='/api/geography/import'){
  if(request.method!=='POST')return json({error:t("worker-seasonal-api:method_not_allowed_5765cf56")},405);
  const chunk=packages.flatMap(p=>p.index.chunks).find(c=>c.sha256===url.searchParams.get('sha'));
  if(!chunk||[...url.searchParams.keys()].some(k=>k!=='sha'))return json({error:t("worker-seasonal-api:unknown_artifact_d95fea41")},400);
  if(!env.EBD_BUCKET?.put)return json({error:t("worker-seasonal-api:storage_unavailable_ef97fa10")},503);
  if(await env.EBD_BUCKET.head(chunk.sha256))return json({stored:true,unchanged:true});
  const reader=request.body?.getReader();if(!reader)return json({error:t("worker-seasonal-api:body_required_707a0b3a")},400);
  let size=0;const parts=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>chunk.bytes){await reader.cancel();return json({error:t("common:badSize")},400);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  if(size!==chunk.bytes||await digest(bytes)!==chunk.sha256)return json({error:t("worker-seasonal-api:artifact_verification_failed_f5db8ef3")},400);
  try{await env.EBD_BUCKET.put(chunk.sha256,bytes);return json({stored:true});}catch{return json({error:t("worker-seasonal-api:storage_is_read_only_or_unavailable_48555b36")},503);}
 }
 if(request.method!=='GET')return json({error:t("worker-seasonal-api:method_not_allowed_5765cf56")},405);
 if(url.pathname==='/api/geography/catalog'){
  const families=new Map();for(const p of packages)for(const b of p.catalog.birds){const name=familyName(b.family),order=Math.min(families.get(name)?.order??Infinity,b.taxonOrder);families.set(name,{name,order});}
  return json({families:[...families.values()].sort((a,b)=>a.order-b.order),geographies:packages.map(p=>({id:p.package.geography,years:p.index.years,revision:p.package.revision}))});
 }
 if([...url.searchParams.keys()].some(k=>!['place','from','to','single','family'].includes(k)))return json({error:t("worker-seasonal-api:invalid_query_e7a90c1f")},400);
 const place=url.searchParams.get('place'),pkg=packages.filter(p=>Object.hasOwn(p.index.places,place)).sort((a,b)=>b.package.geography.length-a.package.geography.length||a.package.geography.localeCompare(b.package.geography))[0];
 if(!pkg)return json({error:t("worker-seasonal-api:no_seasonal_data_for_this_place_f90fef5f")},404);
 try{
  const start=url.searchParams.get('from'),end=url.searchParams.get('to');seasonRange(start,end);
  const entry=pkg.index.places[place],chunk=pkg.index.chunks[entry.chunk];
  if(!env.EBD_BUCKET)return json({error:t("worker-seasonal-api:seasonal_data_is_not_loaded_yet_676c7f11")},503);
  const object=await env.EBD_BUCKET.get(chunk.sha256,{range:{offset:entry.offset,length:entry.length}});if(!object)throw Error(t("worker-seasonal-api:missing_package_object_3d598e01"));
  const bytes=await object.arrayBuffer();if(bytes.byteLength!==entry.length||await digest(bytes)!==entry.sha256)throw Error(t("common:badRecord"));
  if(!Number.isSafeInteger(entry.rawBytes)||entry.rawBytes<1||entry.rawBytes>32*1024*1024)throw Error(t("common:badLength"));
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();let size=0;const parts=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>entry.rawBytes){await reader.cancel();throw Error(t("worker-seasonal-api:oversized_record_105ecfe8"));}parts.push(value);}
  if(size!==entry.rawBytes)throw Error(t("worker-seasonal-api:incomplete_record_66b0f2b7"));const raw=new Uint8Array(size);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.length;}
  const result=seasonalSpecies(JSON.parse(new TextDecoder().decode(raw)),start,end,url.searchParams.get('single')==='true',pkg.index.years),family=url.searchParams.get('family')||'all';
  const species=result.rows.map(r=>{const bird=pkg.catalog.birds[r.bird];if(!bird)throw Error(t("worker-seasonal-api:invalid_species_reference_e9944eed"));return {...bird,...seasonalPhotos(bird.photos,start,end),reportingSeasons:r.seasons};}).filter(b=>family==='all'||familyName(b.family)===family).sort((a,b)=>a.taxonOrder-b.taxonOrder);
  return json({place,placeName:pkg.nodes.find(n=>n.id===place)?.name||place,years:pkg.index.years,revision:pkg.package.revision,sampledSeasons:result.seasons,species,pool:species.filter(b=>b.photos.length),notice:t("worker-seasonal-api:complete_eligible_checklists_grouped_into_independent_o_bd1af591", {v0:(pkg.index.years.join('–'))})});
 }catch(error){if(error.messageKey?.startsWith('geography-core:'))return json({error:error.message},400);console.error(JSON.stringify({event:'seasonal_package_failed',type:error.name}));return json({error:t("worker-seasonal-api:seasonal_data_could_not_load_please_retry_later_903f6286")},503);}
}
