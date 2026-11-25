import {t} from '../dist/i18n.mjs';
// Server-only, fixed eBird metadata endpoints. No arbitrary URL/observation proxy.
export function createEbirdLocations({apiKey,fetcher=fetch,now=Date.now,store}={}){
  if(!apiKey)return null;
  const cache=new Map(),pending=new Map();let hour=0,requests=0,cooldown=0;
  async function read(kind,parent,{refresh=false}={}){
    let stage='cache-read',httpStatus=null;
    try{
    const countries=kind==='countries'&&parent.id==='world';
    if(!countries&&!/^[A-Z]{2}(?:-[A-Za-z0-9]+){0,2}$/.test(parent.id))throw Error(t("server-ebird-locations:unsupported_region_7c4ff281"));
    const type=parent.kind==='country'?'subnational1':parent.kind==='subnational1'?'subnational2':null;
    if(kind==='regions'&&!type)return {rows:[],fetchedAt:null,fromCache:true};
    if(!['regions','hotspots','countries'].includes(kind))throw Error(t("server-ebird-locations:unsupported_lookup_b87c9ea8"));
    const key=kind+':'+parent.id;
    const cached=cache.get(key)||await store?.get(key);
    if(cached&&!refresh){cache.set(key,cached);return {...cached,fromCache:true};}
    if(pending.has(key))return pending.get(key);
    if(now()<cooldown)throw Error(t("server-ebird-locations:location_service_is_resting_try_again_later_d0daac49"));
    const bucket=Math.floor(now()/3600000);if(bucket!==hour){hour=bucket;requests=0;}
    if(requests>=60)throw Error(t("server-ebird-locations:location_lookup_limit_reached_try_again_later_05a3c248"));requests++;
    const promise=(async()=>{
      const path=countries?'ref/region/list/country/world':kind==='regions'?`ref/region/list/${type}/${parent.id}`:`ref/hotspot/${parent.id}`;
      stage='upstream-fetch';
      // Workers does not implement redirect:'error'. Manual mode also keeps the
      // API key on this fixed host; non-2xx responses below are never followed.
      const response=await fetcher('https://api.ebird.org/v2/'+path+'?fmt=json',{headers:{'x-ebirdapitoken':apiKey},redirect:'manual',signal:AbortSignal.timeout(8000)});
      httpStatus=response.status;stage='upstream-response';
      if(response.status===429){const header=response.headers.get('retry-after');const retry=header?Number(header):NaN;const delay=Number.isFinite(retry)?retry*1000:Number.isFinite(Date.parse(header))?Date.parse(header)-now():60000;cooldown=now()+Math.max(30000,delay);throw Error(t("server-ebird-locations:location_service_is_resting_try_again_later_d0daac49"));}
      if(!response.ok)throw Error(t("server-ebird-locations:location_directory_unavailable_121b001e"));
      const reader=response.body.getReader();let size=0,parts=[];
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>3*1024*1024){await reader.cancel();throw Error(t("server-ebird-locations:too_many_locations_choose_a_smaller_region_7355f2a5"));}parts.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
      const values=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(values)||values.length>25000)throw Error(t("server-ebird-locations:invalid_location_directory_7c42fb58"));
      stage='response-validation';
      const rows=values.map(value=>kind!=='hotspots'?{id:value.code,name:value.name,kind:countries?'country':type,parent:parent.id}:{id:value.locId,name:value.locName,kind:'hotspot',parent:parent.id,country:value.countryCode,subnational1:value.subnational1Code,subnational2:value.subnational2Code});
      if(rows.some(v=>typeof v.name!=='string'||v.name.length>400||!v.name.trim()||!(kind!=='hotspots'?(countries?/^[A-Z]{2}$/.test(v.id):new RegExp('^'+parent.id+'-[A-Za-z0-9]+$').test(v.id)):/^L\d+$/.test(v.id))))throw Error(t("server-ebird-locations:invalid_location_directory_7c42fb58"));
      if(cache.size>=200)cache.delete(cache.keys().next().value);
      const value={rows,fetchedAt:new Date(now()).toISOString()};stage='cache-write';await store?.put(key,value);cache.set(key,value);return {...value,fromCache:false};
    })();pending.set(key,promise);try{return await promise;}finally{pending.delete(key);}
    }catch(error){error.locationStage=stage;error.locationStatus=httpStatus;throw error;}
  }
  return {read};
}
