// Share links contain only a small, versioned itinerary; the catalog is trusted app data.
export const MAX_ROUTE_STOPS=24;
export const DEFAULT_ROUTE={v:1,title:'Late September at Jordan Lake',stops:[{place:'jordan-dam',date:'2027-09-27'}],single:false,extras:[]};
export const CURATED_TARGETS=new Map([
  ['Cathartes aura','Turkey Vulture'], ['Ardea alba','Great Egret'], ['Columba livia','Rock Pigeon']
]);
const extraPhotos=[
  ['kirwar',"Kirtland's Warbler",'Setophaga kirtlandii','Parulidae','659807372','County Lister Brendan'],
  ['carwre','Carolina Wren','Thryothorus ludovicianus','Troglodytidae','210392161','Don Danko'],
  ["bratan1","Brazilian Tanager","Ramphocelus bresilius","Thraupidae","613763563","Charles Davies"],
  ["mawtyr1","Masked Water-Tyrant","Fluvicola nengeta","Tyrannidae","660281936","Elizabeth Lyons"],
  ["rercac1","Red-rumped Cacique","Cacicus haemorrhous","Icteridae","517721961","Guillermo Andreo"],
  ["swthum1","Swallow-tailed Hummingbird","Eupetomena macroura","Trochilidae","630741495","Daniel Esser"],
  ["whbpic1","White-barred Piculet","Picumnus cirratus","Picidae","617919771","Tomáš Grim"],
  ["bratea1","Brazilian Teal","Amazonetta brasiliensis","Anatidae","637043060","David Massie"],
  ["chvcon1","Chestnut-vented Conebill","Conirostrum speciosum","Thraupidae","356762201","Vitor Rolf Laubé"],
  ["wibhor1","Wing-banded Hornero","Furnarius figulus","Furnariidae","653490157","Shraddha Pandya"]
];
export function routePhotoBirds(birds){
  return [...birds,...extraPhotos.map(([id,name,scientificName,family,asset,photographer])=>({
    id,name,acceptedName:name,scientificName,family,sites:[],photos:[{id:asset,photographer,
      source:`https://macaulaylibrary.org/asset/${asset}`,url:`https://cdn.download.ams.birds.cornell.edu/api/v2/asset/${asset}/1200`}]
  }))];
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
    throw Error(`Choose a route name, one to ${MAX_ROUTE_STOPS} supported stops, and available practice targets.`);
  const stops=value.stops.map(stop=>{
    const place=catalog.places.find(p=>p.id===stop?.place);
    if(!place||!validDate(stop.date))throw Error('Choose a supported place and a valid visit date for each stop.');
    const md=stop.date.slice(5);
    if(md<place.start||md>place.end)throw Error(`${place.name}: choose a visit within the available ${place.start} to ${place.end} study window.`);
    return {place:place.id,date:stop.date};
  });
  return {v:1,title:value.title.trim(),stops,single:value.single,extras:[...new Set(value.extras)]};
}
export function encodeRoute(value,catalog){return '#route='+encodeURIComponent(JSON.stringify(validateRoute(value,catalog)));}
export function decodeRoute(hash,catalog){
  if(!hash.startsWith('#route=')||hash.length>6000)throw Error('This route link is invalid.');
  return validateRoute(JSON.parse(decodeURIComponent(hash.slice(7))),catalog);
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
    .sort((a,b)=>Number(b.recurring)-Number(a.recurring)||Number(b.curated)-Number(a.curated)||Number(Boolean(b.fromTrip))-Number(Boolean(a.fromTrip))||a.rank-b.rank||a.name.localeCompare(b.name));
}
