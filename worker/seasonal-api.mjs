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
  if(request.method!=='POST')return json({error:'Method not allowed.'},405);
  const chunk=packages.flatMap(p=>p.index.chunks).find(c=>c.sha256===url.searchParams.get('sha'));
  if(!chunk||[...url.searchParams.keys()].some(k=>k!=='sha'))return json({error:'Unknown artifact.'},400);
  if(!env.EBD_BUCKET?.put)return json({error:'Storage unavailable.'},503);
  if(await env.EBD_BUCKET.head(chunk.sha256))return json({stored:true,unchanged:true});
  const reader=request.body?.getReader();if(!reader)return json({error:'Body required.'},400);
  let size=0;const parts=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>chunk.bytes){await reader.cancel();return json({error:'Size mismatch.'},400);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  if(size!==chunk.bytes||await digest(bytes)!==chunk.sha256)return json({error:'Artifact verification failed.'},400);
  try{await env.EBD_BUCKET.put(chunk.sha256,bytes);return json({stored:true});}catch{return json({error:'Storage is read-only or unavailable.'},503);}
 }
 if(request.method!=='GET')return json({error:'Method not allowed.'},405);
 if(url.pathname==='/api/geography/catalog'){
  const families=new Map();for(const p of packages)for(const b of p.catalog.birds){const name=familyName(b.family),order=Math.min(families.get(name)?.order??Infinity,b.taxonOrder);families.set(name,{name,order});}
  return json({families:[...families.values()].sort((a,b)=>a.order-b.order),geographies:packages.map(p=>({id:p.package.geography,years:p.index.years,revision:p.package.revision}))});
 }
 if([...url.searchParams.keys()].some(k=>!['place','from','to','single','family'].includes(k)))return json({error:'Invalid query.'},400);
 const place=url.searchParams.get('place'),pkg=packages.filter(p=>Object.hasOwn(p.index.places,place)).sort((a,b)=>b.package.geography.length-a.package.geography.length||a.package.geography.localeCompare(b.package.geography))[0];
 if(!pkg)return json({error:'No seasonal data for this place.'},404);
 try{
  const start=url.searchParams.get('from'),end=url.searchParams.get('to');seasonRange(start,end);
  const entry=pkg.index.places[place],chunk=pkg.index.chunks[entry.chunk];
  if(!env.EBD_BUCKET)return json({error:'Seasonal data is not loaded yet.'},503);
  const object=await env.EBD_BUCKET.get(chunk.sha256,{range:{offset:entry.offset,length:entry.length}});if(!object)throw Error('Missing package object');
  const bytes=await object.arrayBuffer();if(bytes.byteLength!==entry.length||await digest(bytes)!==entry.sha256)throw Error('Invalid compressed record');
  if(!Number.isSafeInteger(entry.rawBytes)||entry.rawBytes<1||entry.rawBytes>32*1024*1024)throw Error('Invalid record size');
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();let size=0;const parts=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>entry.rawBytes){await reader.cancel();throw Error('Oversized record');}parts.push(value);}
  if(size!==entry.rawBytes)throw Error('Incomplete record');const raw=new Uint8Array(size);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.length;}
  const result=seasonalSpecies(JSON.parse(new TextDecoder().decode(raw)),start,end,url.searchParams.get('single')==='true',pkg.index.years),family=url.searchParams.get('family')||'all';
  const species=result.rows.map(r=>{const bird=pkg.catalog.birds[r.bird];if(!bird)throw Error('Invalid species reference');return {...bird,...seasonalPhotos(bird.photos,start,end),reportingSeasons:r.seasons};}).filter(b=>family==='all'||familyName(b.family)===family).sort((a,b)=>a.taxonOrder-b.taxonOrder);
  return json({place,placeName:pkg.nodes.find(n=>n.id===place)?.name||place,years:pkg.index.years,revision:pkg.package.revision,sampledSeasons:result.seasons,species,pool:species.filter(b=>b.photos.length),notice:`Complete eligible checklists grouped into independent outings; historical coverage ${pkg.index.years.join('–')}. Single-season species are excluded by default when multiple seasons were sampled. Historical coverage can include partial years and does not guarantee occurrence. Photos from the selected quarter(s) are preferred; other dates are used when matching coverage is unavailable. Geography quizzes do not change saved statistics.`});
 }catch(error){if(/Choose/.test(error.message))return json({error:error.message},400);console.error(JSON.stringify({event:'seasonal_package_failed',type:error.name}));return json({error:'Seasonal data could not load. Please retry later.'},503);}
}
