import {t,locale} from './i18n.mjs';
import domainData from './route-extra-data.mjs';
export const CURATED_TARGETS = new Map(domainData.CURATED_TARGETS);
const extraPhotos = domainData.extraPhotos;
import {ROUTE_PHOTO_REFERENCES} from './route-photo-references.mjs';

// Share links contain only a small, versioned itinerary; the catalog is trusted app data.
export const MAX_ROUTE_STOPS=24;
export const DEFAULT_ROUTE={v:1,title:'',stops:[],single:false,extras:[]};


const supplementalBirds=[...extraPhotos,...ROUTE_PHOTO_REFERENCES].map(([id,name,scientificName,family,asset,photographer])=>({
  id,name,acceptedName:name,scientificName,family,sites:[],photos:[{id:asset,photographer,
    source:`https://macaulaylibrary.org/asset/${asset}`,url:`https://cdn.download.ams.birds.cornell.edu/api/v2/asset/${asset}/1200`}]
}));
export function routePhotoBirds(birds){
  return [...birds,...supplementalBirds];
}
const validDate=date=>typeof date==='string'&&/^\d{4}-\d\d-\d\d$/.test(date)&&date.slice(0,4)>='1900'&&
  Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
export function nextVisitDate(date){
  if(!validDate(date))return '';
  return new Date(Date.parse(date)+86400000).toISOString().split('T')[0];
}
export function validateRoute(value,catalog){
  if(value?.v!==1||typeof value.title!=='string'||!value.title.trim()||value.title.length>60||/[\u0000-\u001f\u007f]/.test(value.title)||
     !Array.isArray(value.stops)||value.stops.length<1||value.stops.length>MAX_ROUTE_STOPS||typeof value.single!=='boolean'||
     !Array.isArray(value.extras)||value.extras.length>CURATED_TARGETS.size||value.extras.some(key=>!CURATED_TARGETS.has(key)))
    throw Error(t("routes:choose_a_trip_name_one_to_supported_stops_and_available_fec46d9e", {v0:(MAX_ROUTE_STOPS)}));
  const stops=value.stops.map(stop=>{
    const place=catalog.places.find(p=>p.id===stop?.place);
    if(!place||!validDate(stop.date))throw Error(t("routes:choose_a_supported_place_and_a_valid_visit_date_for_eac_4c39078e"));
    const md=stop.date.slice(5);
    if(md<place.start||md>place.end)throw Error(t("routes:choose_a_visit_within_the_available_to_study_window_21341895", {v0:(place.name),v1:(place.start),v2:(place.end)}));
    return {place:place.id,date:stop.date};
  });
  return {v:1,title:value.title.trim(),stops,single:value.single,extras:[...new Set(value.extras)]};
}
export function encodeRoute(value,catalog){return '#trip='+encodeURIComponent(JSON.stringify(validateRoute(value,catalog)));}
export function decodeRoute(hash,catalog){
  const prefix=/^#(?:trip|route)=/.exec(hash);
  if(!prefix||hash.length>6000)throw Error(t("routes:this_trip_link_is_invalid_7b6a4c99"));
  return validateRoute(JSON.parse(decodeURIComponent(hash.slice(prefix[0].length))),catalog);
}
export function routeCandidates(value,catalog,birds){
  const route=validateRoute(value,catalog);
  const byName=new Map(routePhotoBirds(birds).filter(b=>b.photos.length).map(b=>[b.scientificName.toLowerCase(),b]));
  const rows=new Map();
  for(const stop of route.stops){
    const {species,source}=catalog.places.find(p=>p.id===stop.place);
    const fromTrip=source==='trip-checklists';
    species.forEach(([scientific,name,seasons,sampled],rank)=>{
      const key=scientific.toLowerCase();
      const current=rows.get(key)||{key,name,bird:byName.get(key),recurring:false,curated:false,rank:Infinity};
      const recurring=!fromTrip&&seasons>=2;
      current.fromTrip||=fromTrip;
      if(recurring&&!current.recurring)current.rank=rank;
      else if(recurring===current.recurring)current.rank=Math.min(current.rank,rank);
      current.recurring||=recurring;
      current.evidence??=[];
      if(!current.evidence.some(e=>e.place===stop.place))current.evidence.push(fromTrip?{place:stop.place,checklists:seasons,totalChecklists:sampled}:{place:stop.place,seasons,sampled});
      rows.set(key,current);
    });
  }
  for(const key of route.extras){
    const normalized=key.toLowerCase();
    const current=rows.get(normalized)||{key:normalized,name:CURATED_TARGETS.get(key),bird:byName.get(normalized),recurring:false,rank:Infinity,evidence:[]};
    rows.set(normalized,{...current,curated:true});
  }
  return [...rows.values()].filter(r=>r.recurring||r.curated||r.fromTrip||route.single)
    .sort((a,b)=>Number(b.recurring)-Number(a.recurring)||Number(b.curated)-Number(a.curated)||Number(Boolean(b.fromTrip))-Number(Boolean(a.fromTrip))||a.rank-b.rank||a.name.localeCompare(b.name,locale));
}
