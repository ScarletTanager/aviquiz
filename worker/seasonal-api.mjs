import {t} from '../dist/i18n.mjs';
import {servingRelease,servingRegistry,placePackage,factRecord,speciesRecords,digest} from './serving-reader.mjs';
import {seasonalSpecies,seasonalPhotos} from '../dist/seasonal-core.mjs';
import {seasonRange} from '../dist/geography-core.mjs';
import {familyName} from '../dist/quiz.mjs';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export const seasonalPackages=servingRelease.packages;
export async function seasonalApi(request,env){
 const url=new URL(request.url),registry=servingRegistry(env),packages=registry.packages;
 if(url.pathname==='/api/geography/import'){
  if(request.method!=='POST')return json({error:t("worker-seasonal-api:method_not_allowed_5765cf56")},405);
  const chunk=[...packages.flatMap(p=>p.index.chunks),...packages.map(p=>p.birds),...Object.values(registry.navigation),...Object.values(registry.species)].find(c=>c.sha256===url.searchParams.get('sha'));
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
  return json({coverage:registry.coverage,families:registry.families,geographies:packages.map(p=>({id:p.package.geography,years:p.index.years,revision:p.package.revision}))});
 }
 if([...url.searchParams.keys()].some(k=>!['place','from','to','single','family'].includes(k)))return json({error:t("worker-seasonal-api:invalid_query_e7a90c1f")},400);
 const place=url.searchParams.get('place');
 try{
  const start=url.searchParams.get('from'),end=url.searchParams.get('to');seasonRange(start,end);
  if(!env.EBD_BUCKET)return json({error:t("worker-seasonal-api:seasonal_data_is_not_loaded_yet_676c7f11")},503);
  const selected=await placePackage(env,place);if(!selected)return json({error:t("worker-seasonal-api:no_seasonal_data_for_this_place_f90fef5f")},404);
  const {pkg,entry,node}=selected;
  const result=seasonalSpecies(await factRecord(env.EBD_BUCKET,pkg,entry),start,end,url.searchParams.get('single')==='true',pkg.index.years),family=url.searchParams.get('family')||'all';
  const birds=await speciesRecords(env,pkg,result.rows.map(r=>r.bird));
  const species=result.rows.map(r=>{const bird=birds.get(r.bird);return {...bird,...seasonalPhotos(bird.photos,start,end),reportingSeasons:r.seasons};}).filter(b=>family==='all'||familyName(b.family)===family).sort((a,b)=>a.taxonOrder-b.taxonOrder);
  return json({place,placeName:node.name||place,years:pkg.index.years,revision:pkg.package.revision,sampledSeasons:result.seasons,species,pool:species.filter(b=>b.photos.length),notice:t("worker-seasonal-api:complete_eligible_checklists_grouped_into_independent_o_bd1af591", {v0:(pkg.index.years.join('–'))})});
 }catch(error){if(error.messageKey?.startsWith('geography-core:'))return json({error:error.message},400);console.error(JSON.stringify({event:'seasonal_package_failed',type:error.name}));return json({error:t("worker-seasonal-api:seasonal_data_could_not_load_please_retry_later_903f6286")},503);}
}
