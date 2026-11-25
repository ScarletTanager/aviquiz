import {createEbirdLocations} from '../server/ebird-locations.mjs';
import {locationCache} from '../server/location-cache.mjs';
import ncLocations from '../dist/nc-locations.json' with {type:'json'};
import seed from '../dist/geography-seed.json' with {type:'json'};
import {seasonalPackages} from './seasonal-api.mjs';
import {resolvePrincipal} from './identity.mjs';
import {hasPermission} from './permissions.mjs';
import {verifierForEnvironment} from './cognito.mjs';
import {databaseForEnvironment} from './database.mjs';
const workerDirectories=new WeakMap();
function directoryFor(env){
 if(env.LOCATION_DIRECTORY)return env.LOCATION_DIRECTORY;
 if(!env.EBIRD_API_KEY)return null;
 if(!workerDirectories.has(env.DB))workerDirectories.set(env.DB,createEbirdLocations({apiKey:env.EBIRD_API_KEY,store:locationCache(databaseForEnvironment(env))}));
 return workerDirectories.get(env.DB);
}
const registry=new Map([...seed.nodes,...ncLocations.nodes].map(n=>[n.id,n]));
for(const pkg of seasonalPackages)for(const node of pkg.nodes){const previous=registry.get(node.id);registry.set(node.id,{...node,...previous});}
registry.set('continent:Other areas',{id:'continent:Other areas',name:'Other countries / areas',kind:'continent',parent:'world'});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function geographyApi(request,env,{verifyIdentity}={}){
 const url=new URL(request.url),refresh=url.pathname.endsWith('/refresh');
 if(request.method!==(refresh?'POST':'GET'))return json({error:'Method not allowed.'},405);
 const id=url.searchParams.get('parent')||'world',type=url.searchParams.get('type')||'regions';
 if([...url.searchParams.keys()].some(k=>!['parent','type'].includes(k))||!['regions','hotspots'].includes(type))return json({error:'Invalid location lookup.'},400);
 const directory=directoryFor(env);
 const parent=registry.get(id);if(!parent)return json({error:'Select a location from the directory first.'},400);
 let actor;
 if(refresh){
  if(request.headers.get('origin')!==url.origin||request.headers.get('content-type')!=='application/json')return json({error:'Use the location controls on this site.'},403);
  try{actor=await resolvePrincipal(request,{db:databaseForEnvironment(env),verifyIdentity:verifyIdentity||verifierForEnvironment(env)});}catch{return json({error:'Sign in again to verify your account.'},401);}
  if(!hasPermission(actor,'system.admin'))return json({error:'Administrator permission is required to refresh metadata.'},403);
  if(!directory)return json({error:'eBird metadata access is not configured.'},503);
 }
 let fetchedAt=null,source='pilot',notice='Limited location directory: eBird API access has not been configured.';
 if(directory&&(parent.kind==='continent'||parent.kind==='world')){
  try{
   const result=await directory.read('countries',registry.get('world'),{refresh});fetchedAt=result.fetchedAt;
   for(const row of result.rows){const prior=registry.get(row.id);registry.set(row.id,{...prior,...row,parent:prior?.parent||'continent:Other areas'});}
   source='ebird-cache';notice='Country metadata from eBird, grouped using UN geographic regions. These groups differ from eBird listing continents.';
  }catch(error){console.error(JSON.stringify({event:'location_directory_failed',stage:error.locationStage||'directory',status:error.locationStatus||null,errorType:['TypeError','SyntaxError','Error','AbortError','TimeoutError'].includes(error.name)?error.name:'Other'}));if(refresh)return json({error:'Refresh failed. The previous directory has been retained.'},503);notice='Country lookup unavailable; showing the bundled country directory.';}
 }
 const local=[...registry.values()].filter(n=>n.parent===id&&(type==='hotspots'?['hotspot','site'].includes(n.kind):!['hotspot','site'].includes(n.kind)));
 let children=local;
 if(!directory&&['world','continent'].includes(parent.kind)){source='navigation';notice='Bundled country directory grouped using UN geographic regions; these are not eBird listing continents.';}
 if(directory&&['country','subnational1','subnational2'].includes(parent.kind)){
  try{
   const result=await directory.read(type,parent,{refresh});fetchedAt=result.fetchedAt;const merged=new Map(local.map(n=>[n.id,n]));
   for(const row of result.rows){const prior=registry.get(row.id);const n={...prior,...row,pilotIds:prior?.pilotIds};merged.set(n.id,n);if(registry.size>=60000&&!registry.has(n.id))throw Error('Directory capacity reached.');registry.set(n.id,n);}
   children=[...merged.values()];source='ebird-cache';notice=type==='hotspots'?'Public eBird hotspots and existing pilot sites. Location metadata does not imply seasonal species coverage.':'eBird subregions. Some countries do not have both administrative levels.';
  }catch(error){console.error(JSON.stringify({event:'location_directory_failed',stage:error.locationStage||'directory',status:error.locationStatus||null,errorType:['TypeError','SyntaxError','Error','AbortError','TimeoutError'].includes(error.name)?error.name:'Other'}));if(refresh)return json({error:'Refresh failed. The previous directory has been retained.'},503);notice='eBird lookup unavailable. Showing any previously loaded locations and existing pilot sites.';}
 }
 if(refresh){
  const db=databaseForEnvironment(env);
  await db.prepare("INSERT INTO audit_events (id,actor_user_id,action,resource_type,resource_id,details_json,created_at) VALUES (?,?,'geography.refresh','user',?,?,?)").bind(crypto.randomUUID(),actor.userId,actor.userId,JSON.stringify({parent:id,type}),new Date().toISOString()).run();
 }
 const ancestors=[];let n=parent;const seen=new Set();while(n&&!seen.has(n.id)){ancestors.unshift(n);seen.add(n.id);n=registry.get(n.parent);}
 return json({parent,ancestors,children:children.sort((a,b)=>a.name.localeCompare(b.name)),source,notice,fetchedAt});
}
