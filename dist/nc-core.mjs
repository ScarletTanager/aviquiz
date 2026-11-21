import {seasonRange} from './geography-core.mjs';
export function seasonalSpecies(facts,start,end,single=false){
 const days=new Set(seasonRange(start,end));
 const wrapped=start.slice(0,4)!==end.slice(0,4)&&start.slice(5)>end.slice(5);
 const maskFor=(md,mask)=>wrapped?(md>=start.slice(5)?mask&255:(mask>>1)&255):mask;
 const combine=rows=>rows.reduce((mask,[md,years])=>days.has(md)?mask|maskFor(md,years):mask,0);
 const count=mask=>mask.toString(2).replaceAll('0','').length;
 const seasons=count(combine(facts.e));
 const rows=Object.entries(facts.b).map(([bird,records])=>({bird:Number(bird),seasons:count(combine(records))})).filter(r=>r.seasons&&(single||seasons<2||r.seasons>=2));
 return {seasons,rows};
}
