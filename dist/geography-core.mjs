import {messageError} from './i18n.mjs';
import {routeCandidates} from './routes.mjs';
const dateValue=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function seasonRange(start,end){
 if(!dateValue(start)||!dateValue(end)||start>end)throw messageError("geography-core:choose_valid_start_and_end_dates_with_the_end_on_or_aft_e3a4a0c2");
 const days=(Date.parse(end)-Date.parse(start))/86400000+1;if(days>366)throw messageError("geography-core:choose_a_seasonal_range_of_no_more_than_366_days_6bad84cb");
 return Array.from({length:days},(_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(5,10));
}
export function monthRange(year,month){
 if(!Number.isInteger(year)||year<1900||year>9999||!Number.isInteger(month)||month<1||month>12)throw messageError("geography-core:choose_a_valid_year_and_month_9dbc8897");
 const start=`${year}-${String(month).padStart(2,'0')}-01`,end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);return {start,end};
}
export function scopedPilotPlaces(scope,nodes,catalog,start,end){
 const days=seasonRange(start,end),byId=new Map(nodes.map(n=>[n.id,n]));
 function inside(n){const seen=new Set();while(n&&!seen.has(n.id)){if(n.id===scope.id)return true;seen.add(n.id);n=byId.get(n.parent);}return false;}
 const ids=new Set(nodes.filter(inside).flatMap(n=>n.pilotIds||[]));
 return catalog.places.filter(p=>ids.has(p.id)&&days.every(d=>p.start<=p.end?d>=p.start&&d<=p.end:d>=p.start||d<=p.end));
}
export function geographyPool({scope,nodes,catalog,birds,start,end,single=false}){
 const places=scopedPilotPlaces(scope,nodes,catalog,start,end),rows=new Map();
 // Use each place independently: a country/range must not hit the itinerary's stop limit.
 for(const p of places){
  const monthDay=start.slice(5),year=start.slice(0,4);
  const date=monthDay>=p.start&&monthDay<=p.end?start:`${year}-${p.start}`;
  for(const row of routeCandidates({v:1,title:scope.name,stops:[{place:p.id,date}],single,extras:[]},catalog,birds))if(row.bird&&!rows.has(row.bird.id))rows.set(row.bird.id,row.bird);
 }
 return {places,pool:[...rows.values()]};
}
export function geographySelection(params){
 const id=params.get('geo'),start=params.get('from'),end=params.get('to');
 if(!id||id.length>100)throw messageError("geography-core:select_a_location_5079fb02");seasonRange(start,end);
 const count=Number(params.get('questions')||20);if(!Number.isInteger(count)||count<1||count>10000)throw messageError("geography-core:choose_1_10_000_questions_3d12c404");
 return {id,start,end,count,allSpecies:params.get('allSpecies')==='true',family:params.get('family')||'all',single:params.get('single')==='true'};
}
