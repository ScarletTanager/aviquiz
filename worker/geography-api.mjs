import {t} from '../dist/i18n.mjs';
import {createEbirdLocations} from '../server/ebird-locations.mjs';
import {locationCache} from '../server/location-cache.mjs';
import ncLocations from '../dist/nc-locations.json' with {type:'json'};
import seed from '../dist/geography-seed.json' with {type:'json'};
import {seasonalPackages} from './seasonal-api.mjs';
import {packageCoverage} from '../dist/coverage-core.mjs';
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
registry.set('continent:Other areas',{id:'continent:Other areas',name:t("common:otherAreas"),kind:'continent',parent:'world'});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function geographyApi(request,env,{verifyIdentity}={}){
 const url=new URL(request.url),refresh=url.pathname.endsWith('/refresh');
 if(request.method!==(refresh?'POST':'GET'))return json({error:t("worker-geography-api:method_not_allowed_5765cf56")},405);
 const id=url.searchParams.get('parent')||'world',type=url.searchParams.get('type')||'regions';
 if([...url.searchParams.keys()].some(k=>!['parent','type'].includes(k))||!['regions','hotspots'].includes(type))return json({error:t("worker-geography-api:invalid_location_lookup_68b674f5")},400);
 const directory=directoryFor(env);
 const parent=registry.get(id);if(!parent)return json({error:t("worker-geography-api:select_a_location_from_the_directory_first_1fa01f5a")},400);
 let actor;
 if(refresh){
  if(request.headers.get('origin')!==url.origin||request.headers.get('content-type')!=='application/json')return json({error:t("worker-geography-api:use_the_location_controls_on_this_site_d259f342")},403);
  try{actor=await resolvePrincipal(request,{db:databaseForEnvironment(env),verifyIdentity:verifyIdentity||verifierForEnvironment(env)});}catch{return json({error:t("worker-geography-api:sign_in_again_to_verify_your_account_18e5667f")},401);}
  if(!hasPermission(actor,'system.admin'))return json({error:t("worker-geography-api:administrator_permission_is_required_to_refresh_metadat_d5f72892")},403);
  if(!directory)return json({error:t("worker-geography-api:ebird_metadata_access_is_not_configured_393a3dc6")},503);
 }
 let fetchedAt=null,source='pilot',notice=t("worker-geography-api:limited_location_directory_ebird_api_access_has_not_bee_41ab1bfa");
 if(directory&&(parent.kind==='continent'||parent.kind==='world')){
  try{
   const result=await directory.read('countries',registry.get('world'),{refresh});fetchedAt=result.fetchedAt;
   for(const row of result.rows){const prior=registry.get(row.id);registry.set(row.id,{...prior,...row,parent:prior?.parent||'continent:Other areas'});}
   source='ebird-cache';notice=t("worker-geography-api:country_metadata_from_ebird_grouped_using_un_geographic_6ccea96d");
  }catch(error){console.error(JSON.stringify({event:'location_directory_failed',stage:error.locationStage||'directory',status:error.locationStatus||null,errorType:['TypeError','SyntaxError','Error','AbortError','TimeoutError'].includes(error.name)?error.name:'Other'}));if(refresh)return json({error:t("worker-geography-api:refresh_failed_the_previous_directory_has_been_retained_a2798353")},503);notice=t("worker-geography-api:country_lookup_unavailable_showing_the_bundled_country_ba29d284");}
 }
 const local=[...registry.values()].filter(n=>n.parent===id&&(type==='hotspots'?['hotspot','site'].includes(n.kind):!['hotspot','site'].includes(n.kind)));
 let children=local;
 if(!directory&&['world','continent'].includes(parent.kind)){source='navigation';notice=t("worker-geography-api:bundled_country_directory_grouped_using_un_geographic_r_8f9d3cf1");}
 if(directory&&['country','subnational1','subnational2'].includes(parent.kind)){
  try{
   const result=await directory.read(type,parent,{refresh});fetchedAt=result.fetchedAt;const merged=new Map(local.map(n=>[n.id,n]));
   for(const row of result.rows){const prior=registry.get(row.id);const n={...prior,...row,pilotIds:prior?.pilotIds};merged.set(n.id,n);if(registry.size>=60000&&!registry.has(n.id))throw Error(t("worker-geography-api:directory_capacity_reached_16dbc270"));registry.set(n.id,n);}
   children=[...merged.values()];source='ebird-cache';notice=type==='hotspots'?t("worker-geography-api:public_ebird_hotspots_and_existing_pilot_sites_location_687eccd9"):t("worker-geography-api:ebird_subregions_some_countries_do_not_have_both_admini_04ab6bfb");
  }catch(error){console.error(JSON.stringify({event:'location_directory_failed',stage:error.locationStage||'directory',status:error.locationStatus||null,errorType:['TypeError','SyntaxError','Error','AbortError','TimeoutError'].includes(error.name)?error.name:'Other'}));if(refresh)return json({error:t("worker-geography-api:refresh_failed_the_previous_directory_has_been_retained_a2798353")},503);notice=t("worker-geography-api:ebird_lookup_unavailable_showing_any_previously_loaded_867b914e");}
 }
 if(refresh){
  const db=databaseForEnvironment(env);
  await db.prepare("INSERT INTO audit_events (id,actor_user_id,action,resource_type,resource_id,details_json,created_at) VALUES (?,?,'geography.refresh','user',?,?,?)").bind(crypto.randomUUID(),actor.userId,actor.userId,JSON.stringify({parent:id,type}),new Date().toISOString()).run();
 }
 const ancestors=[];let n=parent;const seen=new Set();while(n&&!seen.has(n.id)){ancestors.unshift(n);seen.add(n.id);n=registry.get(n.parent);}
 const coverage=packageCoverage(env.SEASONAL_PACKAGES||seasonalPackages,[...registry.values()]);
 const describe=node=>({...node,supported:coverage.navigable.has(node.id),quizSupported:coverage.places.has(node.id)});
 return json({parent:describe(parent),ancestors:ancestors.map(describe),children:children.sort((a,b)=>a.name.localeCompare(b.name)).map(describe),source,notice,fetchedAt});
}
