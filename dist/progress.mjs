import {eligibleBirds} from './quiz.mjs';

export const PROGRESS_KEY='colombia-field-quiz:progress:v1';
export const AUDIO_PROGRESS_KEY='colombia-field-quiz:audio-progress:v1';
export const progressKey=medium=>medium==='audio'?AUDIO_PROGRESS_KEY:PROGRESS_KEY;
export const RECENT_ATTEMPTS=20;
export const emptyProgress=()=>({version:1,species:{}});
const validId=id=>typeof id==='string'&&/^[a-z0-9]+$/i.test(id);
function parseRecords(source){
  const records={};
  if(!source||typeof source!=='object'||Array.isArray(source))return records;
  for(const [id,value] of Object.entries(source)){
    if(!validId(id)||!Array.isArray(value?.attempts))continue;
    const attempts=value.attempts.filter(x=>typeof x==='boolean').slice(-RECENT_ATTEMPTS);
    if(attempts.length)records[id]={attempts};
  }
  return records;
}
export function parseProgress(serialized){
  if(!serialized)return emptyProgress();
  const source=JSON.parse(serialized),result=emptyProgress();
  if(source?.version!==1||!source.species||typeof source.species!=='object')return result;
  result.species=parseRecords(source.species);
  if(source.siteSpecies&&typeof source.siteSpecies==='object'&&!Array.isArray(source.siteSpecies)){
    result.siteSpecies={};
    for(const [site,records] of Object.entries(source.siteSpecies)){
      if(validId(site)&&site!=='all')result.siteSpecies[site]=parseRecords(records);
    }
  }
  return result;
}
export function recordAttempt(progress,speciesId,correct,context={}){
  if(context.experimentalTips||context.mode==='annotations')return progress;
  const attempts=[...(progress.species[speciesId]?.attempts||[]),Boolean(correct)].slice(-RECENT_ATTEMPTS);
  const result={...progress,version:1,species:{...progress.species,[speciesId]:{attempts}}};
  if(validId(context.site)&&context.site!=='all'&&context.family==='all'&&['regular','review'].includes(context.mode||'regular')&&!context.pilotTips){
    const records=progress.siteSpecies?.[context.site]||{};
    result.siteSpecies={...progress.siteSpecies,[context.site]:{...records,[speciesId]:{
      attempts:[...(records[speciesId]?.attempts||[]),Boolean(correct)].slice(-RECENT_ATTEMPTS)
    }}};
  }
  return result;
}
export function mistakeRate(record){
  const attempts=record?.attempts||[];
  return attempts.length?attempts.filter(correct=>!correct).length/attempts.length:0;
}
export function recentMistakeIds(progress){
  return Object.keys(progress.species).filter(id=>mistakeRate(progress.species[id])>0.25);
}
export function sessionMistakeIds(answers){
  return [...new Set(answers.filter(a=>!a.unavailable&&!a.correct).map(a=>a.bird.id))];
}
export function reviewBirds(birds,progress,site='all',family='all',specificIds=null){
  const ids=new Set(specificIds??recentMistakeIds(progress));
  return eligibleBirds(birds,site,'none',family).filter(b=>ids.has(b.id));
}
export function withFreshPhotos(birds,avoidIds=[]){
  const avoid=new Set(avoidIds);
  return birds.map(b=>{const fresh=b.photos.filter(p=>!avoid.has(p.id));return {...b,photos:fresh.length?fresh:b.photos};});
}
