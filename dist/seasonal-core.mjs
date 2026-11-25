import {seasonRange} from './geography-core.mjs';
export function seasonalSpecies(facts,start,end,single=false,years){
 seasonRange(start,end);
 const [first,last]=years;
 if(!Number.isInteger(first)||!Number.isInteger(last)||last<first||last-first>1000)throw Error('Invalid historical years');
 const offsets=new Map(),base=Number(start.slice(0,4));
 for(let t=Date.parse(start);t<=Date.parse(end);t+=86400000){const d=new Date(t).toISOString().slice(0,10),md=d.slice(5),offset=Number(d.slice(0,4))-base;const set=offsets.get(md)||new Set();set.add(offset);offsets.set(md,set);}
 const span=Number(end.slice(0,4))-base,limit=(1n<<BigInt(Math.max(0,last-first+1-span)))-1n;
 const decode=value=>{if(typeof value!=='string'||! /^[0-9a-f]+$/.test(value))throw Error('Invalid year mask');const mask=BigInt('0x'+value);if(mask>>BigInt(last-first+1))throw Error('Year mask outside declared range');return mask;};
 const combine=records=>records.reduce((result,[md,value])=>{const mask=decode(value);for(const offset of offsets.get(md)||[])result|=mask>>BigInt(offset);return result;},0n)&limit;
 const count=mask=>mask.toString(2).replaceAll('0','').length;
 const effort=combine(facts.e),seasons=count(effort);
 const rows=Object.entries(facts.b).map(([bird,records])=>({bird:Number(bird),seasons:count(combine(records)&effort)})).filter(r=>r.seasons&&(single||seasons<2||r.seasons>=2));
 return {seasons,rows};
}
export function seasonalPhotos(photos,start,end){
 const quarters=new Set(seasonRange(start,end).map(md=>Math.floor((Number(md.slice(0,2))-1)/3)+1));
 const dated=photos.filter(p=>/^\d{4}-\d\d-\d\d$/.test(p.observationDate||'')&&quarters.has(Math.floor((Number(p.observationDate.slice(5,7))-1)/3)+1));
 return {photos:dated.length?dated:photos,photoSeasonFallback:!dated.length&&photos.length>0};
}
