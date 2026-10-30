import {familyName} from './quiz.mjs';

export function accuracyStatistics(birds,sites,progress){
  const siteRows=sites.map((site,order)=>({id:site.code,name:site.name,order,correct:0,total:0}));
  const sitesById=new Map(siteRows.map(row=>[row.id,row]));
  const familiesById=new Map();
  for(const bird of birds){
    const family=familyName(bird.family);
    if(!familiesById.has(family))familiesById.set(family,{id:family,name:family,order:familiesById.size,correct:0,total:0});
    const attempts=progress.species[bird.id]?.attempts||[];
    const correct=attempts.filter(Boolean).length;
    const groups=[familiesById.get(family),...new Set(bird.sites).values()].map(group=>typeof group==='string'?sitesById.get(group):group);
    for(const row of groups){if(!row)continue;row.correct+=correct;row.total+=attempts.length;}
  }
  const finish=rows=>rows.map(row=>({...row,rate:row.total?row.correct/row.total:null}));
  return {sites:finish(siteRows),families:finish([...familiesById.values()])};
}

export function sortAccuracy(rows,by='taxonomy',direction='asc'){
  const sign=direction==='desc'?-1:1;
  return [...rows].sort((a,b)=>{
    // Missing history is not a zero score, and stays last in either rate direction.
    if(by==='rate'&&(a.rate===null||b.rate===null))return a.rate===b.rate?a.order-b.order:a.rate===null?1:-1;
    const difference=by==='name'?a.name.localeCompare(b.name,'en',{sensitivity:'base'}):by==='rate'?a.rate-b.rate:a.order-b.order;
    return difference*sign||a.order-b.order;
  });
}
