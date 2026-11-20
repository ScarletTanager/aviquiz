import {routeCandidates} from './routes.mjs';
const dateValue=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function seasonRange(start,end){
 if(!dateValue(start)||!dateValue(end)||start>end)throw Error('Choose valid start and end dates, with the end on or after the start.');
 const days=(Date.parse(end)-Date.parse(start))/86400000+1;if(days>366)throw Error('Choose a seasonal range of no more than 366 days.');
 return Array.from({length:days},(_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(5,10));
}
export function monthRange(year,month){
 if(!Number.isInteger(year)||year<1900||year>9999||!Number.isInteger(month)||month<1||month>12)throw Error('Choose a valid year and month.');
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
 if(!id||id.length>100)throw Error('Select a location.');seasonRange(start,end);
 const count=Number(params.get('questions')||20);if(!Number.isInteger(count)||count<1||count>10000)throw Error('Choose 1–10,000 questions.');
 return {id,start,end,count,family:params.get('family')||'all',single:params.get('single')==='true'};
}
