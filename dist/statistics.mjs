import {familyName} from './quiz.mjs';

export function accuracyStatistics(birds,sites,progress,{siteOnly=false}={}){
  const siteRows=sites.map((site,order)=>({id:site.code,name:site.name,order,correct:0,total:0}));
  const sitesById=new Map(siteRows.map(row=>[row.id,row]));
  const familiesById=new Map();
  for(const bird of birds){
    const family=familyName(bird.family);
    if(!familiesById.has(family))familiesById.set(family,{id:family,name:family,order:familiesById.size,correct:0,total:0});
    const attempts=progress.species[bird.id]?.attempts||[];
    const correct=attempts.filter(Boolean).length;
    const familyRow=familiesById.get(family);familyRow.correct+=correct;familyRow.total+=attempts.length;
    for(const site of new Set(bird.sites)){
      const row=sitesById.get(site);if(!row)continue;
      const siteAttempts=siteOnly?progress.siteSpecies?.[site]?.[bird.id]?.attempts||[]:attempts;
      row.correct+=siteAttempts.filter(Boolean).length;row.total+=siteAttempts.length;
    }
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

export function speciesAccuracy(birds,progress,kind,id,{siteOnly=false}={}){
  if(!['site','family'].includes(kind))return [];
  return birds.map((bird,order)=>({bird,order})).filter(({bird})=>kind==='site'?bird.sites.includes(id):familyName(bird.family)===id).map(({bird,order})=>{
    const attempts=siteOnly&&kind==='site'?progress.siteSpecies?.[id]?.[bird.id]?.attempts||[]:progress.species[bird.id]?.attempts||[];
    const correct=attempts.filter(Boolean).length;
    return {id:bird.id,name:bird.name,scientificName:bird.scientificName,order,correct,total:attempts.length,rate:attempts.length?correct/attempts.length:null};
  });
}

export function listQuizSettings(kind,id,count=20){
  return {mode:'regular',site:kind==='site'?id:'all',family:kind==='family'?id:'all',count,filter:'none'};
}
